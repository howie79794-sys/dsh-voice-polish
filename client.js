/**
 * dsh-voice-polish — 输入框上的“语音输入（口语整理）”客户端。
 *
 * 交互流程：点麦克风 → 录音（音量条/计时/停止/取消）→ 停止后转写并整理 →
 * 弹出对照面板（整理稿可编辑，可看原文/重润/插原文）→ 插入输入框草稿。
 * 模型未就绪时点击麦克风进入“准备”面板：下载本地 SenseVoice 模型（首次约 239MB）。
 *
 * 录音管线（getUserMedia + MediaRecorder + Web Audio 重采样到 16kHz PCM16 WAV）
 * 改编自 @deepseek-ai/dsh-experimental-client-ui-voice-input（MIT，DeepSeek）。
 * 数据全部来自本包宿主半的环回路由；浏览器不直连任何外部服务。
 */
window.__ModuleLoader__.load({
  id: 'dsh-voice-polish',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    let ReactDOM = null
    try {
      ReactDOM = require('react-dom')
    } catch {
      ReactDOM = null
    }
    const portal = (node, host) => (ReactDOM && typeof ReactDOM.createPortal === 'function' ? ReactDOM.createPortal(node, host) : node)

    const NAMESPACE = 'voice-polish'
    const ROUTE = '/api/voice-polish'

    // ── 词典 ────────────────────────────────────────────────
    const DICTS = {
      zh: {
        'btn.label': '语音',
        'aria.mic': '语音输入（说完自动整理成文字）',
        'aria.stop': '停止并整理',
        'aria.cancel': '取消录音',
        'rec.timer': '录音中',
        'phase.processing': '转写并整理中…',
        'review.title': '整理稿',
        'review.raw': '原文',
        'review.style': '模式',
        'review.editHint': '可直接编辑，插入的是编辑后的内容',
        'review.insert': '插入到输入框',
        'review.insertRaw': '用原文',
        'review.repolish': '重新整理',
        'review.repolishing': '整理中…',
        'review.discard': '丢弃',
        'review.polishFailed': '整理失败（{message}）。上面是原始转写，可直接编辑或插入。',
        'review.conflict': '输入框内容已变化，请再点一次「插入到输入框」。',
        'review.empty': '没有识别到内容，再试一次？',
        'prep.title': '语音模型还没准备好',
        'prep.desc': '首次使用需要下载本地识别模型 SenseVoice（约 239MB，仅此一次，之后离线可用、音频不出本机）。',
        'prep.start': '下载并准备',
        'prep.preparing': '准备中…',
        'prep.ready': '已就绪，点击麦克风开始说话',
        'prep.failed': '准备失败：{message}',
        'prep.retry': '重试',
        'prep.close': '稍后再说',
        'prep.noService': '语音服务未启用：请在插件管理页确认“语音输入（口语整理）”已开启。',
        'style.light': '轻度',
        'style.standard': '标准',
        'style.strict': '严格',
        'phase.unprepared': '未开始',
        'phase.checking': '检查资源',
        'phase.downloading': '下载模型',
        'phase.verifying': '校验文件',
        'phase.loading': '加载模型',
        'phase.canceling': '正在取消',
        'phase.ready': '已就绪',
        'phase.failed': '失败',
        'err.permission': '麦克风权限被拒绝：请在浏览器地址栏授权，或检查系统隐私设置。',
        'err.deviceMissing': '找不到可用的麦克风设备。',
        'err.unavailable': '当前浏览器不支持录音（需要 HTTPS 或本机地址）。',
        'err.interrupted': '录音被打断（设备断开或窗口切走）。',
        'err.empty': '没有录到声音。',
        'err.cancelled': '已取消。',
        'err.network': '服务暂时不可用（{message}）',
        'err.failed': '出错了：{message}',
      },
      en: {
        'btn.label': 'Voice',
        'aria.mic': 'Voice input (speech is tidied into text)',
        'aria.stop': 'Stop and tidy',
        'aria.cancel': 'Cancel recording',
        'rec.timer': 'Recording',
        'phase.processing': 'Transcribing and tidying…',
        'review.title': 'Tidied text',
        'review.raw': 'Raw transcript',
        'review.style': 'Mode',
        'review.editHint': 'Editable — what gets inserted is what you see',
        'review.insert': 'Insert into composer',
        'review.insertRaw': 'Use raw',
        'review.repolish': 'Re-tidy',
        'review.repolishing': 'Tidying…',
        'review.discard': 'Discard',
        'review.polishFailed': 'Tidying failed ({message}). The raw transcript is shown and editable.',
        'review.conflict': 'The composer draft changed. Click “Insert into composer” again.',
        'review.empty': 'Nothing was recognized. Try again?',
        'prep.title': 'Speech model is not ready',
        'prep.desc': 'First use downloads the local SenseVoice model (about 239 MB, once only; afterwards it works offline and audio never leaves this machine).',
        'prep.start': 'Download and prepare',
        'prep.preparing': 'Preparing…',
        'prep.ready': 'Ready — click the mic and speak',
        'prep.failed': 'Preparation failed: {message}',
        'prep.retry': 'Retry',
        'prep.close': 'Later',
        'prep.noService': 'Speech service unavailable: check that this plugin is enabled on the Plugins page.',
        'style.light': 'Light',
        'style.standard': 'Standard',
        'style.strict': 'Strict',
        'phase.unprepared': 'Not started',
        'phase.checking': 'Checking assets',
        'phase.downloading': 'Downloading model',
        'phase.verifying': 'Verifying files',
        'phase.loading': 'Loading model',
        'phase.canceling': 'Canceling',
        'phase.ready': 'Ready',
        'phase.failed': 'Failed',
        'err.permission': 'Microphone permission denied: allow it from the browser address bar or system privacy settings.',
        'err.deviceMissing': 'No microphone device found.',
        'err.unavailable': 'Recording is not supported here (HTTPS or loopback required).',
        'err.interrupted': 'Recording interrupted (device detached or window hidden).',
        'err.empty': 'Nothing was recorded.',
        'err.cancelled': 'Cancelled.',
        'err.network': 'Service unavailable ({message})',
        'err.failed': 'Error: {message}',
      },
    }

    let t = (key, params) => interpolate(DICTS.en[key] !== undefined ? DICTS.en[key] : key, params)

    function pickLang() {
      const tags = []
      if (typeof navigator !== 'undefined') {
        if (Array.isArray(navigator.languages)) tags.push(...navigator.languages)
        if (navigator.language) tags.push(...[navigator.language])
      }
      for (const tag of tags) {
        const lower = String(tag || '').toLowerCase()
        if (lower.startsWith('zh')) return 'zh'
        if (lower.startsWith('en')) return 'en'
      }
      return 'en'
    }

    function interpolate(value, params) {
      if (typeof value !== 'string') return value
      return value.replace(/\{(\w+)\}/g, (all, name) => (params && params[name] !== undefined ? String(params[name]) : all))
    }

    function makeTranslator(locale, lang) {
      const dict = DICTS[lang] || DICTS.en
      const fallback = (key, params) => interpolate(dict[key] !== undefined ? dict[key] : DICTS.en[key] !== undefined ? DICTS.en[key] : key, params)
      if (!locale || typeof locale.bind !== 'function') return fallback
      let translate
      try {
        if (typeof locale.register === 'function') locale.register(NAMESPACE, lang, dict)
        translate = locale.bind(NAMESPACE)
      } catch {
        return fallback
      }
      if (typeof translate !== 'function') return fallback
      return (key, params) => {
        try {
          const value = translate(key, params)
          if (typeof value === 'string' && value.length > 0 && value !== key) return value
        } catch {
          // 宿主 locale 服务改版时退回自带词典
        }
        return fallback(key, params)
      }
    }

    // ── 录音管线（改编自官方 voice-input 客户端，MIT）──────────
    class RecordingError extends Error {
      constructor(kind) {
        super(kind)
        this.kind = kind
        this.name = 'RecordingError'
      }
    }

    function encodeWave(samples) {
      const bytes = new Uint8Array(44 + samples.length * 2)
      const view = new DataView(bytes.buffer)
      const write = (at, value) => {
        for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i)
      }
      write(0, 'RIFF')
      view.setUint32(4, bytes.length - 8, true)
      write(8, 'WAVE')
      write(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, 16000, true)
      view.setUint32(28, 32000, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      write(36, 'data')
      view.setUint32(40, samples.length * 2, true)
      for (const [i, sample] of samples.entries()) {
        const value = Math.max(-1, Math.min(1, sample))
        view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
      }
      return bytes
    }

    function audioBase64(bytes) {
      let text = ''
      for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
      return btoa(text)
    }

    const recordings = new Set()

    class Recording {
      constructor(onDispose) {
        this.onDispose = onDispose
        this.stream = null
        this.recorder = null
        this.context = null
        this.analyser = null
        this.samples = new Float32Array(256)
        this.chunks = []
        this.lifetime = new AbortController()
        this.disposal = null
      }

      async start(onError) {
        if (typeof MediaRecorder === 'undefined') throw new RecordingError('unavailable')
        const devices = navigator.mediaDevices
        if (!devices) throw new RecordingError('unavailable')
        let stream
        try {
          stream = await devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
        } catch (error) {
          if (error instanceof DOMException) {
            if (error.name === 'NotAllowedError') throw new RecordingError('permission')
            if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') throw new RecordingError('deviceMissing')
          }
          throw error
        }
        if (this.lifetime.signal.aborted) {
          for (const track of stream.getTracks()) track.stop()
          throw new RecordingError('cancelled')
        }
        this.stream = stream
        try {
          this.context = new AudioContext()
          this.analyser = this.context.createAnalyser()
          this.analyser.fftSize = this.samples.length
          this.context.createMediaStreamSource(stream).connect(this.analyser)
          for (const track of stream.getTracks()) {
            track.addEventListener('ended', () => this.interrupted(onError), { signal: this.lifetime.signal })
          }
          this.recorder = new MediaRecorder(this.stream)
          this.recorder.ondataavailable = (event) => {
            if (!this.lifetime.signal.aborted && event.data.size > 0) this.chunks.push(event.data)
          }
          this.recorder.onerror = () => this.interrupted(onError)
          this.recorder.start()
        } catch (error) {
          await this.dispose()
          throw error
        }
      }

      interrupted(onError) {
        if (this.lifetime.signal.aborted) return
        this.dispose().catch(() => undefined)
        try {
          if (onError) onError(new RecordingError('interrupted'))
        } catch (error) {
          console.error('[voice-polish] recording error handler failed', error)
        }
      }

      amplitude() {
        if (!this.analyser) return 0
        this.analyser.getFloatTimeDomainData(this.samples)
        let sum = 0
        for (const sample of this.samples) sum += sample * sample
        return Math.sqrt(sum / this.samples.length)
      }

      async stop(maxDurationSeconds) {
        const recorder = this.recorder
        const context = this.context
        if (!recorder || !context || recorder.state !== 'recording') {
          await this.dispose()
          throw new RecordingError('empty')
        }
        try {
          await new Promise((resolve, reject) => {
            recorder.onstop = () => resolve()
            recorder.onerror = () => reject(new RecordingError('empty'))
            recorder.stop()
          })
          for (const track of this.stream ? this.stream.getTracks() : []) track.stop()
          this.lifetime.signal.throwIfAborted()
          const blob = new Blob(this.chunks, { type: recorder.mimeType })
          if (blob.size === 0) throw new RecordingError('empty')
          const decoded = await context.decodeAudioData(await blob.arrayBuffer())
          this.lifetime.signal.throwIfAborted()
          const offline = new OfflineAudioContext(1, Math.max(1, Math.floor(Math.min(decoded.duration, maxDurationSeconds) * 16000)), 16000)
          const source = offline.createBufferSource()
          source.buffer = decoded
          source.connect(offline.destination)
          source.start()
          const resampled = await offline.startRendering()
          this.lifetime.signal.throwIfAborted()
          return encodeWave(resampled.getChannelData(0))
        } finally {
          await this.dispose()
        }
      }

      dispose() {
        if (!this.disposal) {
          const closing = Promise.withResolvers()
          this.disposal = closing.promise
          this.release().then(closing.resolve, closing.reject)
        }
        return this.disposal
      }

      async release() {
        this.lifetime.abort(new RecordingError('cancelled'))
        if (this.recorder && this.recorder.state === 'recording') this.recorder.stop()
        for (const track of this.stream ? this.stream.getTracks() : []) track.stop()
        this.stream = undefined
        const context = this.context
        this.context = undefined
        this.analyser = undefined
        this.chunks = []
        try {
          if (context && context.state !== 'closed') await context.close()
        } finally {
          this.onDispose()
        }
      }
    }

    function createRecording() {
      const recording = new Recording(() => recordings.delete(recording))
      recordings.add(recording)
      return recording
    }

    // ── 状态源 ──────────────────────────────────────────────
    const store = {
      data: null,
      loading: false,
      error: null,
      fetchedAt: 0,
      listeners: new Set(),
      request: null,
      emit() {
        for (const listener of this.listeners) {
          try {
            listener()
          } catch (error) {
            console.error('[voice-polish]', error)
          }
        }
      },
      subscribe(listener) {
        this.listeners.add(listener)
        if (this.listeners.size === 1) void this.refresh()
        return () => {
          this.listeners.delete(listener)
        }
      },
      async refresh() {
        if (this.request) return this.request
        this.loading = true
        this.emit()
        const run = fetch(`${ROUTE}/status`)
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then((payload) => {
            this.data = payload
            this.error = null
            this.fetchedAt = Date.now()
          })
          .catch((error) => {
            this.error = error && error.message ? error.message : String(error)
          })
          .finally(() => {
            this.request = null
            this.loading = false
            this.emit()
          })
        this.request = run
        return run
      },
    }

    function useStatus() {
      const [, bump] = React.useState(0)
      React.useEffect(() => store.subscribe(() => bump((value) => value + 1)), [])
      return store
    }

    function selectedProvider(data) {
      if (!data || !Array.isArray(data.providers) || data.providers.length === 0) return null
      const wanted = data.selection && data.selection.providerId
      return data.providers.find((provider) => provider.id === wanted) || data.providers[0]
    }

    function providerReady(provider) {
      // standby = 模型已就绪但 worker 未唤醒（首次录音时才加载），同样可以直接录。
      if (!provider || !provider.preparation) return false
      return provider.preparation.phase === 'ready' || provider.preparation.phase === 'standby'
    }

    function fmtMB(bytes) {
      const mb = Number(bytes) / (1024 * 1024)
      if (!Number.isFinite(mb)) return ''
      return mb >= 100 ? Math.round(mb).toString() : mb.toFixed(1)
    }

    function preparationProgress(preparation) {
      if (!preparation) return null
      const received = firstNumber(preparation, ['completedBytes', 'receivedBytes', 'received', 'downloadedBytes', 'downloaded', 'bytes'])
      const total = firstNumber(preparation, ['totalBytes', 'total', 'sizeBytes', 'size'])
      if (received === null || total === null || total <= 0) return null
      return { received, total, percent: Math.min(100, Math.round((received / total) * 100)) }
    }

    function firstNumber(object, keys) {
      for (const key of keys) {
        const value = Number(object[key])
        if (Number.isFinite(value) && value >= 0) return value
      }
      return null
    }

    function failureText(failure) {
      if (failure instanceof RecordingError) {
        const map = { permission: 'err.permission', deviceMissing: 'err.deviceMissing', unavailable: 'err.unavailable', interrupted: 'err.interrupted', empty: 'err.empty', cancelled: 'err.cancelled' }
        return t(map[failure.kind] || 'err.failed', { message: failure.message })
      }
      const message = failure && failure.message ? failure.message : String(failure)
      return t('err.failed', { message })
    }

    // ── 样式 ────────────────────────────────────────────────
    const STYLE = `
.vp-mic{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px 0 9px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);
  cursor:pointer;flex:none;font-size:12px;line-height:1;font-weight:500;white-space:nowrap;
  transition:border-color .12s ease,color .12s ease,background .12s ease}
.vp-mic:hover:not(:disabled),.vp-mic:focus-visible{border-color:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);outline:none}
.vp-mic:disabled{opacity:.5;cursor:default}
.vp-mic .vp-mic-icon{color:var(--dsw-alias-brand-primary);display:inline-flex;flex:none}
.vp-inline{display:inline-flex;align-items:center;gap:8px;height:26px;padding:0 4px;color:var(--dsw-alias-label-secondary);font-size:11px}
.vp-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-error-primary);flex:none;animation:vppulse 1.2s ease-in-out infinite}
@keyframes vppulse{0%,100%{opacity:1}50%{opacity:.35}}
.vp-bars{display:inline-flex;align-items:flex-end;gap:2px;height:14px}
.vp-bars span{width:3px;border-radius:1px;background:var(--dsw-alias-label-primary);opacity:.85;transition:height .08s linear}
.vp-time{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.vp-btn{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);
  font-size:11px;cursor:pointer;white-space:nowrap}
.vp-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.vp-btn:disabled{opacity:.55;cursor:default}
.vp-btn-primary{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary);font-weight:600}
.vp-btn-primary:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.vp-spin{width:12px;height:12px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);
  border-top-color:var(--dsw-alias-label-primary);animation:vpturn .8s linear infinite;flex:none}
@keyframes vpturn{to{transform:rotate(360deg)}}
.vp-pop{position:fixed;z-index:2147483000;width:440px;max-width:calc(100vw - 24px);
  background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;
  box-shadow:0 12px 32px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary);font-size:12px;padding:12px}
.vp-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.vp-head .vp-title{font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px}
.vp-tag{font-size:10px;font-weight:500;padding:1px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.vp-note{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.vp-note-bad{color:var(--dsw-alias-state-error-primary)}
.vp-textarea{width:100%;box-sizing:border-box;margin:8px 0;min-height:88px;max-height:240px;padding:8px 10px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  font-size:12px;line-height:1.55;resize:vertical;font-family:inherit}
.vp-textarea:focus{outline:none;border-color:var(--dsw-alias-border-l2)}
.vp-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.vp-foot .vp-grow{flex:1}
.vp-progress{height:4px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin:10px 0 4px}
.vp-progress span{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary)}
.vp-raw{margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);
  border:1px dashed var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.55;
  max-height:120px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.vp-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
`

    function MicIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': true },
        h('rect', { x: 9, y: 2.5, width: 6, height: 11, rx: 3, fill: 'currentColor' }),
        h('path', { d: 'M5.5 11a6.5 6.5 0 0 0 13 0', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
        h('line', { x1: 12, y1: 17.5, x2: 12, y2: 20.5, stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
        h('line', { x1: 8.5, y1: 20.5, x2: 15.5, y2: 20.5, stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
      )
    }

    function StopIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 14, height: 14, 'aria-hidden': true, fill: 'currentColor' }, h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }))
    }

    function XIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 12, height: 12, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' },
        h('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
        h('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
      )
    }

    /** 渲染期错误兜底：绝不弄崩整个 slot 条目。 */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error, info) {
        try {
          console.error('[voice-polish] render error:', error, info)
        } catch {
          // 忽略
        }
      }
      render() {
        if (this.state.error) return h('span', { className: 'vp-inline', title: String(this.state.error.message || this.state.error) }, '语音输入出错')
        return this.props.children
      }
    }

    function phaseText(phase) {
      const key = `phase.${phase}`
      const translated = t(key)
      return translated !== key ? translated : String(phase || '')
    }

    // ── 准备面板 ────────────────────────────────────────────
    function PrepPanel(props) {
      const status = props.status
      const provider = selectedProvider(status.data)
      const preparation = (provider && provider.preparation) || { phase: 'unprepared' }
      const phase = preparation.phase || 'unprepared'
      const readyish = phase === 'ready' || phase === 'standby'
      const progress = preparationProgress(preparation)
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        if (readyish || phase === 'failed') return undefined
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.hidden) return
          void status.refresh()
        }, 2500)
        return () => clearInterval(timer)
      }, [phase, readyish])

      React.useEffect(() => {
        if (readyish) {
          const timer = setTimeout(() => props.onDone(), 1200)
          return () => clearTimeout(timer)
        }
        return undefined
      }, [readyish])

      const start = async () => {
        setBusy(true)
        try {
          const response = await fetch(`${ROUTE}/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          await status.refresh()
        } catch (error) {
          status.error = error && error.message ? error.message : String(error)
          status.emit()
        } finally {
          setBusy(false)
        }
      }

      const failed = String(preparation.error || preparation.message || preparation.reason || '')
      return h(
        'div',
        { className: 'vp-pop', style: props.style, role: 'dialog', 'aria-label': t('prep.title') },
        h('div', { className: 'vp-head' }, h('span', { className: 'vp-title' }, t('prep.title')), h('button', { type: 'button', className: 'vp-btn', onClick: props.onClose }, t('prep.close'))),
        !provider ? h('div', { className: 'vp-note vp-note-bad' }, t('prep.noService')) : h('div', { className: 'vp-note' }, t('prep.desc')),
        provider && phase === 'failed'
          ? h('div', { className: 'vp-note vp-note-bad', style: { marginTop: 8 } }, t('prep.failed', { message: failed || phaseText('failed') }))
          : null,
        provider && phase !== 'ready' && phase !== 'failed' && progress
          ? h('div', { className: 'vp-progress' }, h('span', { style: { width: `${progress.percent}%` } }))
          : null,
        provider && readyish
          ? h(
              'div',
              { className: 'vp-foot', style: { marginTop: 10 } },
              h('span', { className: 'vp-note' }, `✓ ${t('prep.ready')}`),
            )
          : provider
            ? h(
                'div',
                { className: 'vp-foot', style: { marginTop: 10 } },
                phase === 'failed'
                  ? h('button', { type: 'button', className: 'vp-btn', onClick: start, disabled: busy }, t('prep.retry'))
                  : h(
                      'button',
                      { type: 'button', className: 'vp-btn vp-btn-primary', onClick: start, disabled: busy },
                      busy || progress || (phase !== 'unprepared' && phase !== 'checking') ? t('prep.preparing') : t('prep.start'),
                    ),
                progress ? h('span', { className: 'vp-note' }, `${fmtMB(progress.received)} / ${fmtMB(progress.total)} MB · ${progress.percent}%`) : h('span', { className: 'vp-note' }, phaseText(phase)),
              )
            : null,
      )
    }

    // ── 主组件 ──────────────────────────────────────────────
    function VoicePolish(props) {
      const inputActions = props.inputActions
      const locked = Boolean(props.locked)
      const status = useStatus()
      const [phase, setPhase] = React.useState('idle') // idle | prep | recording | processing | review
      const [level, setLevel] = React.useState(0)
      const [elapsed, setElapsed] = React.useState(0)
      const [message, setMessage] = React.useState('')
      const [review, setReview] = React.useState(null) // {raw, text, polishError, style}
      const [showRaw, setShowRaw] = React.useState(false)
      const [conflict, setConflict] = React.useState(false)
      const [repolishing, setRepolishing] = React.useState(false)
      const [rect, setRect] = React.useState(null)
      const anchorRef = React.useRef(null)
      const recordingRef = React.useRef(null)
      const generationRef = React.useRef(0)
      const rafRef = React.useRef(null)
      const tickRef = React.useRef(null)
      const autoStopRef = React.useRef(null)
      const abortRef = React.useRef(null)

      const maxDuration = status.data && status.data.limits ? Number(status.data.limits.maxDurationSeconds) || 180 : 180
      const provider = selectedProvider(status.data)
      const ready = providerReady(provider)
      const usable = !locked && Boolean(inputActions) && Boolean(inputActions.insertText)

      const setActive = React.useCallback((active) => {
        try {
          if (props.onActiveChange) props.onActiveChange(active)
        } catch {
          // 槽位所有者的回调失败不影响录音
        }
      }, [props])

      const stopLoops = React.useCallback(() => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        if (tickRef.current !== null) {
          clearInterval(tickRef.current)
          tickRef.current = null
        }
        if (autoStopRef.current !== null) {
          clearTimeout(autoStopRef.current)
          autoStopRef.current = null
        }
      }, [])

      React.useEffect(
        () => () => {
          stopLoops()
          const recording = recordingRef.current
          if (recording) void recording.dispose()
          if (abortRef.current) abortRef.current.abort()
        },
        [stopLoops],
      )

      // Esc：录音/处理中取消（并中断请求）；准备/结果面板直接关闭。
      React.useEffect(() => {
        if (phase === 'idle' || typeof document === 'undefined') return undefined
        const onKey = (event) => {
          if (event && event.key === 'Escape') {
            event.stopPropagation()
            if (phase === 'recording' || phase === 'processing') cancel()
            else reset('idle')
          }
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [phase])

      // 页面隐藏时中断录音（与官方语音输入一致，避免后台产生无头录音）。
      React.useEffect(() => {
        if (phase !== 'recording' || typeof document === 'undefined') return undefined
        const onVisibility = () => {
          if (document.hidden) cancel()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => document.removeEventListener('visibilitychange', onVisibility)
      }, [phase])

      function reset(next) {
        stopLoops()
        setLevel(0)
        setElapsed(0)
        setMessage('')
        setReview(null)
        setShowRaw(false)
        setConflict(false)
        setRepolishing(false)
        setPhase(next)
        setActive(false)
      }

      async function beginRecording() {
        const run = ++generationRef.current
        setMessage('')
        setConflict(false)
        setShowRaw(false)
        try {
          const recording = createRecording()
          recordingRef.current = recording
          setPhase('recording')
          setActive(true)
          const startedAt = Date.now()
          await recording.start((failure) => {
            if (run !== generationRef.current) return
            reset('idle')
            setMessage(failureText(failure))
          })
          if (run !== generationRef.current) return
          const bumpElapsed = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000))
          bumpElapsed()
          tickRef.current = setInterval(bumpElapsed, 1000)
          const loop = () => {
            const current = recordingRef.current
            if (run !== generationRef.current || !current) return
            setLevel(Math.min(1, current.amplitude() * 6))
            rafRef.current = requestAnimationFrame(loop)
          }
          rafRef.current = requestAnimationFrame(loop)
          // 到达上限前 0.5s 自动停止，避免宿主拒绝超长录音。
          autoStopRef.current = setTimeout(() => {
            autoStopRef.current = null
            if (run === generationRef.current) void finish()
          }, Math.max(1000, (maxDuration - 0.5) * 1000))
        } catch (failure) {
          if (run !== generationRef.current) return
          reset('idle')
          setMessage(failureText(failure))
        }
      }

      async function finish() {
        const run = generationRef.current
        const recording = recordingRef.current
        if (!recording) return
        stopLoops()
        setPhase('processing')
        try {
          const wav = await recording.stop(maxDuration)
          if (run !== generationRef.current) return
          const controller = new AbortController()
          abortRef.current = controller
          const response = await fetch(`${ROUTE}/dictate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ audioBase64: audioBase64(wav) }),
            signal: controller.signal,
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          if (run !== generationRef.current) return
          if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || 'dictate failed')
          if (payload.empty || !String(payload.raw || '').trim()) {
            reset('idle')
            setMessage(t('review.empty'))
            return
          }
          const polished = String(payload.polished || '').trim()
          setReview({
            raw: String(payload.raw || ''),
            text: polished || String(payload.raw || ''),
            polishError: polished ? '' : payload.polishError || 'unknown',
            style: payload.style || '',
          })
          setShowRaw(false)
          const node = anchorRef.current
          if (node && typeof node.getBoundingClientRect === 'function') setRect(node.getBoundingClientRect())
          setPhase('review')
          // 保持 onActiveChange(true)：面板还开着
        } catch (failure) {
          if (run !== generationRef.current) return
          reset('idle')
          if (failure && failure.name === 'AbortError') return
          setMessage(t('err.network', { message: failure && failure.message ? failure.message : String(failure) }))
        } finally {
          recordingRef.current = null
          abortRef.current = null
        }
      }

      function cancel() {
        generationRef.current++
        const recording = recordingRef.current
        recordingRef.current = null
        if (recording) void recording.dispose().catch(() => undefined)
        if (abortRef.current) {
          abortRef.current.abort()
          abortRef.current = null
        }
        reset('idle')
      }

      function insert(text) {
        if (!inputActions || typeof inputActions.insertText !== 'function') return
        // 每次插入都取当前插入锚点：录音期间草稿可能已经变了。
        const inserted = inputActions.insertText(text, inputActions.captureInsertion())
        if (inserted) {
          reset('idle')
        } else {
          setConflict(true)
        }
      }

      async function repolish() {
        if (!review || repolishing) return
        setRepolishing(true)
        setConflict(false)
        try {
          const response = await fetch(`${ROUTE}/polish`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: review.raw }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          const polished = payload && payload.polished ? String(payload.polished).trim() : ''
          setReview({ ...review, text: polished || review.text, polishError: polished ? '' : (payload && payload.polishError) || review.polishError })
        } catch (error) {
          setReview({ ...review, polishError: error && error.message ? error.message : String(error) })
        } finally {
          setRepolishing(false)
        }
      }

      function onMicClick() {
        if (!usable) return
        if (message) setMessage('')
        if (!ready) {
          const node = anchorRef.current
          if (node && typeof node.getBoundingClientRect === 'function') setRect(node.getBoundingClientRect())
          setPhase('prep')
          setActive(true)
          void status.refresh()
          return
        }
        void beginRecording()
      }

      const popPosition = React.useMemo(() => {
        if (!rect) return { right: 16, bottom: 76 }
        const width = typeof window !== 'undefined' ? window.innerWidth : 1280
        const height = typeof window !== 'undefined' ? window.innerHeight : 800
        const left = Math.min(Math.max(12, rect.left - 160), Math.max(12, width - 460))
        if (rect.top > 320) return { left, bottom: height - rect.top + 10 }
        return { left, top: rect.bottom + 10 }
      }, [rect])

      // ── 渲染 ──────────────────────────────────────────────
      let inline
      if (phase === 'recording') {
        const bars = [0.55, 0.85, 1, 0.85, 0.55].map((factor, index) =>
          h('span', { key: index, style: { height: `${Math.max(3, Math.round(14 * factor * (0.25 + level * 0.75)))}px` } }),
        )
        inline = h(
          'span',
          { className: 'vp-inline' },
          h('span', { className: 'vp-dot', 'aria-hidden': true }),
          h('span', { className: 'vp-bars', 'aria-hidden': true }, bars),
          h('span', { className: 'vp-time' }, `${t('rec.timer')} ${fmtClock(elapsed)}`),
          h('button', { type: 'button', className: 'vp-btn vp-btn-primary', 'aria-label': t('aria.stop'), onClick: () => void finish() }, h(StopIcon, null), t('aria.stop')),
          h('button', { type: 'button', className: 'vp-btn', 'aria-label': t('aria.cancel'), onClick: cancel }, t('aria.cancel')),
        )
      } else if (phase === 'processing') {
        inline = h('span', { className: 'vp-inline' }, h('span', { className: 'vp-spin', 'aria-hidden': true }), t('phase.processing'), h('button', { type: 'button', className: 'vp-btn', onClick: cancel }, t('review.discard')))
      } else {
        inline = h(
          'button',
          {
            ref: anchorRef,
            type: 'button',
            className: 'vp-mic',
            disabled: !usable,
            'aria-label': t('aria.mic'),
            title: message || t('aria.mic'),
            onClick: onMicClick,
          },
          h('span', { className: 'vp-mic-icon' }, h(MicIcon, null)),
          h('span', null, t('btn.label')),
        )
      }

      const base = h(React.Fragment, null, h('style', null, STYLE), message && phase === 'idle' ? h('span', { className: 'vp-inline vp-note' }, message) : null, inline)

      if (phase !== 'prep' && phase !== 'review') return base
      if (typeof document === 'undefined' || !document.body) return base

      const popover =
        phase === 'prep'
          ? h(PrepPanel, { status, style: popPosition, onClose: () => reset('idle'), onDone: () => reset('idle') })
          : h(
              'div',
              { className: 'vp-pop', style: popPosition, role: 'dialog', 'aria-label': t('review.title') },
              h(
                'div',
                { className: 'vp-head' },
                h('span', { className: 'vp-title' }, t('review.title'), review && review.style ? h('span', { className: 'vp-tag' }, t(`style.${review.style}`) !== `style.${review.style}` ? t(`style.${review.style}`) : review.style) : null),
                h('button', { type: 'button', className: 'vp-btn', 'aria-label': t('review.discard'), onClick: () => reset('idle') }, h(XIcon, null)),
              ),
              review && review.polishError ? h('div', { className: 'vp-note vp-note-bad' }, t('review.polishFailed', { message: review.polishError })) : null,
              review
                ? h('textarea', {
                    className: 'vp-textarea',
                    value: review.text,
                    onChange: (event) => {
                      setReview({ ...review, text: event.target.value })
                      setConflict(false)
                    },
                    placeholder: t('review.editHint'),
                    spellCheck: false,
                  })
                : null,
              conflict ? h('div', { className: 'vp-note vp-note-bad' }, t('review.conflict')) : h('div', { className: 'vp-note' }, t('review.editHint')),
              h(
                'div',
                { className: 'vp-foot' },
                h('button', { type: 'button', className: 'vp-btn vp-btn-primary', disabled: !review || !review.text.trim(), onClick: () => review && insert(review.text) }, t('review.insert')),
                h('button', { type: 'button', className: 'vp-btn', disabled: !review || !review.raw, onClick: () => review && insert(review.raw) }, t('review.insertRaw')),
                h('button', { type: 'button', className: 'vp-btn', disabled: !review || repolishing, onClick: () => void repolish() }, repolishing ? t('review.repolishing') : t('review.repolish')),
                h('span', { className: 'vp-grow' }),
                h('button', { type: 'button', className: 'vp-btn', onClick: () => setShowRaw(!showRaw) }, t('review.raw')),
                h('button', { type: 'button', className: 'vp-btn', onClick: () => reset('idle') }, t('review.discard')),
              ),
              showRaw && review ? h('div', { className: 'vp-raw' }, review.raw) : null,
            )

      return h(React.Fragment, null, base, portal(popover, document.body))
    }

    function fmtClock(seconds) {
      const total = Math.max(0, Math.floor(seconds))
      const minutes = Math.floor(total / 60)
      const rest = total % 60
      return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        t = makeTranslator(ctx.get('locale'), pickLang())
        ctx.effect(() => async () => {
          await Promise.all([...recordings].map((recording) => recording.dispose()))
        }, 'voice-polish-recordings')
        return ctx.slots.inject('conversation.input.activity', () =>
          ctx.slots.register(
            { name: 'conversation.input.activity', locale: NAMESPACE },
            (slotProps) => h(Boundary, null, h(VoicePolish, slotProps || {})),
          ),
        )
      },
    }
  },
})
