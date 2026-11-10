# Changelog

## 1.0.0

Initial marketplace release.

- Microphone button in the composer toolbar: record → local SenseVoice transcription (zh / en / yue / ja / ko, auto-detect) → DeepSeek tidies the spoken transcript → review panel → insert into the draft.
- Review panel: edited-ready polish output, toggle raw transcript, re-polish, insert raw, never loses text when polishing fails.
- Three polish styles: `light` (filler removal + punctuation only), `standard` (Feishu-like tidy-up), `strict` (further written-form normalization).
- First-run model preparation flow with download progress (SenseVoice int8, ~239 MB, one-time; HuggingFace with automatic HF-Mirror fallback).
- All colors via host theme tokens; light/dark safe.
- Audio stays on the machine; only the text transcript is sent to your configured DeepSeek route for tidying.
