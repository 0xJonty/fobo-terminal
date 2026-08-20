/**
 * fomo's alert ding, replicated from its own bundle (side panel chunk): the same asset
 * (/sounds/alert-ding.mp3, same-origin, allowed by fomo's connect-src), the same 2-second
 * throttle between plays, and the same 10-second freshness window — only an alert that just
 * happened dings; backfill and stale reconnect frames stay silent.
 *
 * AudioContext construction and resume are gated behind a user gesture by the browser, so
 * unlockAudio() is called from a pointerdown; until then dings are silently skipped, exactly
 * as fomo behaves before its first interaction.
 */

const SOUND_URL = 'https://fomo.family/sounds/alert-ding.mp3'
const THROTTLE_MS = 2_000
const FRESH_MS = 10_000

let context: AudioContext | null = null
let buffer: AudioBuffer | null = null
let loading: Promise<void> | null = null
let lastPlayedAt = 0

function load(ctx: AudioContext): void {
  if (buffer || loading) return
  loading = fetch(SOUND_URL, { credentials: 'omit' })
    .then((response) => {
      if (!response.ok) throw new Error(`alert sound ${response.status}`)
      return response.arrayBuffer()
    })
    .then((bytes) => ctx.decodeAudioData(bytes))
    .then((decoded) => {
      buffer = decoded
    })
    .catch(() => {
      // The ding is decoration; a missing asset just means silence.
      loading = null
    })
}

/** Call from a user gesture. Safe to call repeatedly; later calls just resume the context. */
export function unlockAudio(): void {
  if (typeof AudioContext === 'undefined') return
  if (!context) {
    try {
      context = new AudioContext()
    } catch {
      return
    }
  }
  load(context)
  if (context.state !== 'running') context.resume().catch(() => {})
}

/**
 * Ding for one live alert. Silent when the alert is not fresh, the tab is hidden, the
 * terminal is not on screen (fomo's own page owns the audible experience then), audio is
 * still locked, or a ding played within the throttle window.
 */
export function dingForAlert(createdAtMs: number): void {
  if (Math.abs(Date.now() - createdAtMs) > FRESH_MS) return
  if (document.hidden) return
  const host = document.getElementById('fobo-terminal-root')
  if (!host || host.dataset.foboHidden !== undefined) return
  if (Date.now() - lastPlayedAt < THROTTLE_MS) return
  if (!context || context.state !== 'running') return
  if (!buffer) {
    load(context)
    return
  }
  lastPlayedAt = Date.now()
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  source.start()
}
