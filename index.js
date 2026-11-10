/**
 * dsh-voice-polish — 语音输入（口语整理）宿主半。
 *
 * 职责：
 *  1. 在环回地址上暴露三个只给本机浏览器用的 HTTP 路由：
 *     GET  {route}/status   识别器就绪状态与录音上限
 *     POST {route}/prepare  触发（或加入）本地模型下载与准备
 *     POST {route}/dictate  一段录音 WAV(base64) → 本地转写 → DeepSeek 整理 → {原文, 整理稿}
 *     POST {route}/polish   只对已有文字重新整理（“重新整理”按钮用，不重跑转写）
 *  2. 转写走 ctx.speechToText（sensevoice-local，本地 CPU，音频不出本机）；
 *     整理走 ctx.llm（用 profile 里已配置的 DeepSeek 适配器，无需另配 key）。
 *  3. 整理失败绝不丢字：客户端会拿到 raw 并展示“整理失败”说明。
 */
export const inject = ['webServer', 'speechToText', 'llm']

const DEFAULTS = {
  enabled: true,
  routePath: '/api/voice-polish',
  language: 'auto', // auto / zh / en / yue / ja / ko
  style: 'standard', // light / standard / strict
  polishProvider: 'deepseek-official',
  polishModel: 'deepseek-chat',
  polishMaxTokens: 2048,
  polishTimeoutMs: 45000,
  maxDurationSeconds: 180,
  transcribeTimeoutMs: 300000,
  maxBodyBytes: 32 * 1024 * 1024,
}

const STYLE_RULES = {
  light: [
    '整理力度：轻。只删除明显的口头语气词（嗯、啊、呃、就是说、然后然后这类）并修正标点，',
    '尽量逐句保留用户原本的说法和语序，不做其他改写。',
  ].join(''),
  standard: [
    '整理力度：标准（类似飞书语音转文字的“智能整理”）。删除语气词、重复和自我修正的残句，',
    '把口语表达理成通顺的书面句子，可以调整语序和连接词，让读起来自然流畅。',
  ].join(''),
  strict: [
    '整理力度：强。在标准力度之上进一步书面化：去除口语化句式、规范用词与数字写法，',
    '把整段话整理成规范书面语，但仍然不得改变原意或增删信息。',
  ].join(''),
}

function systemPrompt(style) {
  const rules = STYLE_RULES[style] || STYLE_RULES.standard
  return [
    '你是一名“语音转写整理器”。用户对着麦克风说话，系统已把录音转成了文字。',
    '这段转写可能夹杂口语、语气词、重复、半截句、同音错别字和中英混排。',
    '请把它整理成一段通顺、可直接作为聊天消息发送的文字。',
    '',
    '规则：',
    `- ${rules}`,
    '- 严格保留原意与原有信息量：不扩写、不缩写、不总结、不添加任何建议或解释',
    '- 修正同音/近音错别字与标点；一句话过长时合理断句，长内容按语义分段',
    '- 专有名词、人名、命令、路径、代码、英文术语一律原样保留，不要翻译或改写',
    '- 保留用户明确表达的语气（疑问、否定、不确定等），不确定的内容不要自行补全',
    '- 只输出整理后的文字本身：不要解释、不要前后缀、不要 markdown 代码块',
  ].join('\n')
}

export async function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}) }
  cfg.maxDurationSeconds = clampNumber(cfg.maxDurationSeconds, 10, 600, DEFAULTS.maxDurationSeconds)
  cfg.polishTimeoutMs = clampNumber(cfg.polishTimeoutMs, 5000, 180000, DEFAULTS.polishTimeoutMs)
  cfg.transcribeTimeoutMs = clampNumber(cfg.transcribeTimeoutMs, 10000, 900000, DEFAULTS.transcribeTimeoutMs)
  cfg.maxBodyBytes = clampNumber(cfg.maxBodyBytes, 1024 * 1024, 128 * 1024 * 1024, DEFAULTS.maxBodyBytes)
  if (typeof cfg.routePath !== 'string' || !cfg.routePath.startsWith('/')) cfg.routePath = DEFAULTS.routePath
  if (!STYLE_RULES[cfg.style]) cfg.style = 'standard'
  const maxAudioBytes = 44 + cfg.maxDurationSeconds * 32000

  const log = (level, message) => {
    const logger = ctx.logger
    if (logger && typeof logger[level] === 'function') logger[level](message instanceof Error ? message : new Error(String(message)))
  }

  if (!cfg.enabled) {
    log('info', '[voice-polish] 已按配置停用（config.enabled: false）')
    return
  }

  const speechToText = ctx.speechToText
  const llm = ctx.llm
  if (!speechToText || typeof speechToText.transcribe !== 'function') throw new Error('voice-polish 需要 speechToText 服务（检查 voice-polish-speech-to-text 行）')
  if (!llm || typeof llm.prepareCall !== 'function') throw new Error('voice-polish 需要 llm 服务')

  // ── 状态 ──────────────────────────────────────────────────
  function statusPayload() {
    const snapshot = speechToText.snapshot()
    return {
      ok: true,
      style: cfg.style,
      limits: { maxDurationSeconds: cfg.maxDurationSeconds, maxAudioBytes },
      selection: snapshot.selection || null,
      providers: (snapshot.providers || []).map((provider) => ({
        id: provider.id,
        label: provider.label || provider.id,
        location: provider.location,
        languages: provider.languages || [],
        preparation: serializePreparation(provider.preparation),
      })),
    }
  }

  function serializePreparation(preparation) {
    if (!preparation || typeof preparation !== 'object') return { phase: 'ready' }
    // 原样透传 plain 字段；函数、循环引用之类一律丢弃，路由绝不因为快照字段而 500。
    const out = {}
    for (const [key, value] of Object.entries(preparation)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) out[key] = value
    }
    return out
  }

  // ── 转写 + 整理 ───────────────────────────────────────────
  async function dictate(payload) {
    const encoded = typeof payload.audioBase64 === 'string' ? payload.audioBase64 : ''
    if (!encoded) throw badRequest('missing audioBase64')
    if (encoded.length > Math.ceil(maxAudioBytes / 3) * 4) throw badRequest('audio exceeds the configured byte limit')
    const audio = Buffer.from(encoded, 'base64')
    if (audio.toString('base64') !== encoded) throw badRequest('audio must use canonical base64 encoding')
    if (audio.length > maxAudioBytes) throw badRequest('audio exceeds the configured byte limit')
    validateWave(audio, cfg.maxDurationSeconds)

    const language = typeof payload.language === 'string' && payload.language ? payload.language : cfg.language
    const spec = speechToText.resolve({ audio, language })
    const transcript = await speechToText.transcribe(spec, AbortSignal.timeout(cfg.transcribeTimeoutMs))
    const raw = typeof transcript === 'string' ? transcript : String((transcript && transcript.text) || '')
    if (!raw.trim()) return { ok: true, raw: '', polished: '', empty: true }

    try {
      const polished = await polish(raw)
      return { ok: true, raw, polished, style: cfg.style }
    } catch (error) {
      // 整理失败不丢字：把原文交回，前端展示失败说明并允许直接插原文。
      log('warn', error)
      return { ok: true, raw, polished: '', style: cfg.style, polishError: messageOf(error) }
    }
  }

  async function polish(raw) {
    const signal = AbortSignal.timeout(cfg.polishTimeoutMs)
    const route = llmRoute()
    const prepared = await llm.prepareCall(
      { provider: route.provider, model: route.model, maxTokens: cfg.polishMaxTokens },
      signal,
    )
    const messages = [{ role: 'user', content: [{ type: 'text', text: raw }] }]
    const parts = []
    let terminal
    for await (const chunk of prepared.stream({ ...prepared.config, system: systemPrompt(cfg.style), messages, signal })) {
      // 只收集文本增量；reasoning/tool-call 块（可能带空块头）一律忽略，最后判空兜底。
      if (chunk.type === 'text-delta') {
        parts.push(chunk.text)
      } else if (chunk.type === 'finish') {
        terminal = chunk.reason
      }
    }
    signal.throwIfAborted()
    if (terminal && terminal.kind === 'error') throw new Error('整理请求失败')
    const text = parts.join('').trim()
    if (!text) throw new Error('整理结果为空')
    return text
  }

  /**
   * 解析润色用的 provider/model：配置的 provider 存在就用配置；
   * 否则自动挑一个名字带 deepseek 的，再退回第一个（换 profile 也不至于直接报错）。
   */
  function llmRoute() {
    let ids = []
    try {
      const providers = llm.listProviders() || []
      ids = providers
        .map((entry) => (typeof entry === 'string' ? entry : entry && (entry.id || entry.provider || entry.name)))
        .filter((value) => typeof value === 'string' && value)
    } catch {
      ids = []
    }
    if (cfg.polishProvider && ids.includes(cfg.polishProvider)) return { provider: cfg.polishProvider, model: cfg.polishModel }
    const preferred = ids.find((id) => id.toLowerCase().includes('deepseek')) || ids[0]
    if (preferred) return { provider: preferred, model: cfg.polishModel }
    return { provider: cfg.polishProvider, model: cfg.polishModel }
  }

  // ── 环回路由 ──────────────────────────────────────────────
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') {
    log('warn', '[voice-polish] 当前 profile 没有 webServer，语音输入拿不到数据；只在有浏览器 GUI 的 profile 下工作。')
    return
  }
  const disposer = webServer.register({
    kind: 'prefix',
    path: cfg.routePath,
    handler: (request, response) => {
      void handleRoute(request, response)
    },
  })
  ctx.effect(() => disposer, 'voice-polish-route')

  async function handleRoute(request, response) {
    try {
      const peer = request.socket && request.socket.remoteAddress ? String(request.socket.remoteAddress) : ''
      if (!isLoopback(peer)) {
        send(response, 403, { ok: false, error: 'forbidden: loopback-only' })
        return
      }
      const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
      const rest = pathname.slice(cfg.routePath.length).replace(/^\/+/, '')

      if (request.method === 'GET' && (rest === 'status' || rest === '')) {
        send(response, 200, statusPayload())
        return
      }
      if (request.method === 'POST') {
        const body = await readBody(request, cfg.maxBodyBytes)
        let payload = {}
        try {
          payload = body ? JSON.parse(body) : {}
        } catch {
          send(response, 400, { ok: false, error: 'invalid JSON body' })
          return
        }
        if (rest === 'prepare') {
          const id = typeof payload.providerId === 'string' && payload.providerId ? payload.providerId : ((statusPayload().selection || {}).providerId) || 'sensevoice-local'
          speechToText.prepare(id)
          send(response, 200, statusPayload())
          return
        }
        if (rest === 'dictate') {
          const result = await dictate(payload)
          send(response, 200, result)
          return
        }
        if (rest === 'polish') {
          const text = typeof payload.text === 'string' ? payload.text : ''
          if (!text.trim()) {
            send(response, 400, { ok: false, error: 'missing text' })
            return
          }
          try {
            const polished = await polish(text)
            send(response, 200, { ok: true, polished, style: cfg.style })
          } catch (error) {
            log('warn', error)
            send(response, 200, { ok: true, polished: '', polishError: messageOf(error) })
          }
          return
        }
      }
      send(response, 404, { ok: false, error: `unknown route: ${rest || '(root)'}` })
    } catch (error) {
      log('warn', error)
      send(response, 400, { ok: false, error: messageOf(error) })
    }
  }

  log('info', `[voice-polish] 已装载：语言 ${cfg.language}，整理力度 ${cfg.style}，模型 ${cfg.polishProvider}/${cfg.polishModel}`)
}

// ── WAV 校验（对照 @deepseek-ai/dsh-experimental-speech-to-text 的 wave 校验规则内联实现）──
function validateWave(audio, maxDurationSeconds) {
  const data = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength)
  if (
    data.length < 46 ||
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.toString('ascii', 8, 12) !== 'WAVE' ||
    data.toString('ascii', 12, 16) !== 'fmt ' ||
    data.readUInt32LE(16) !== 16 ||
    data.readUInt16LE(20) !== 1 ||
    data.readUInt16LE(22) !== 1 ||
    data.readUInt32LE(24) !== 16000 ||
    data.readUInt32LE(28) !== 32000 ||
    data.readUInt16LE(32) !== 2 ||
    data.readUInt16LE(34) !== 16 ||
    data.toString('ascii', 36, 40) !== 'data' ||
    data.readUInt32LE(4) !== data.length - 8 ||
    data.readUInt32LE(40) !== data.length - 44 ||
    (data.length - 44) % 2 !== 0
  ) {
    throw badRequest('audio must be a canonical 16 kHz mono PCM16 WAV recording')
  }
  const seconds = (data.length - 44) / 32000
  if (seconds > maxDurationSeconds) throw badRequest(`audio exceeds ${maxDurationSeconds} seconds`)
  return seconds
}

// ── 小工具 ────────────────────────────────────────────────
function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function isLoopback(address) {
  if (!address) return false
  const needle = address.replace(/^::ffff:/i, '').toLowerCase()
  return needle === '127.0.0.1' || needle === '::1' || needle.startsWith('127.') || needle === 'localhost'
}

function send(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
  })
  response.end(body)
}

function readBody(request, limit) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        request.destroy()
        resolve('')
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => resolve(''))
  })
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function clampNumber(value, min, max, fallback) {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}
