/**
 * @webface/dsh-desk-notify — forwards "the owner is needed" moments to deskd.
 * Watches every session's event stream; on an approval request, a question to
 * the owner, or a hand-over cue, POSTs a small notice to `url` (deskd on
 * loopback), which pushes it to the owner's phone. Best-effort: a failed
 * POST is logged and never touches the session.
 * @module @webface/dsh-desk-notify
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

export const name = 'desk-notify'
export const inject: string[] = []

export interface Config {
  /** deskd notify endpoint. */
  url: string
  /** Minimum ms between notices for the same session and kind. */
  cooldownMs: number
}
export const Config: z<Config> = z.object({
  url: z.string().default('http://127.0.0.1:8090/deskd/notify'),
  cooldownMs: z.number().default(20_000),
})

interface Notice { kind: 'approval' | 'question' | 'handover' | 'deliverable'; sessionId: string; title: string; body: string; url?: string | undefined }

/** Classify an event into a notice, or undefined when the owner is not needed. */
// Payload fields are model/tool data: only strings are used as text; anything else is not a notice body.
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
export function noticeFor(session: Session, event: SessionEvent): Notice | undefined {
  // Events from other plugins (approval, ask-user) are not in this package's view of the map; compare as plain strings.
  const type: string = event.type
  const payload = (event as { data?: Record<string, unknown> }).data ?? {}
  const sessionId = str((session as { id?: unknown }).id)
  if (type === 'approval/asked') {
    const tool = str(payload.toolName) || 'an action'
    return { kind: 'approval', sessionId, title: 'Desk needs your approval', body: `${tool}${str(payload.reason) ? ` — ${str(payload.reason)}` : ''}` }
  }
  if (/question|ask-user|ask_user/.test(type) && !/answer|resolved|decided/.test(type)) {
    const q = str(payload.question) || str(payload.prompt) || str(payload.text)
    return { kind: 'question', sessionId, title: 'Desk has a question for you', body: q.slice(0, 140) }
  }
  if (type === 'assistant/message' || type === 'message/assistant' || /assistant.*(message|text)/.test(type)) {
    const text = str(payload.text) || str(payload.content)
    if (/I need you for a moment/i.test(text)) return { kind: 'handover', sessionId, title: 'Desk needs you at the browser', body: text.slice(0, 140) }
  }
  if (type === 'tool/result') {
    // A kit tool finished with a file: tell the phone where it is.
    const name = str(payload.toolName) || str(payload.name)
    const body = str(payload.result) || str(payload.content) || str(payload.text) || JSON.stringify(payload).slice(0, 2000)
    const m = /mcp__kit__make_|mcp__kit__brand_image/.test(name) ? /\[([^\]]+)\]\((\/files\/dl\/[^)]+)\)/.exec(body) : null
    if (m && m[1] !== undefined && m[2] !== undefined) return { kind: 'deliverable', sessionId, title: 'Your file is ready', body: m[1], url: m[2] }
  }
  return undefined
}

export function apply(ctx: Context, config: Config): void {
  const last = new Map<string, number>()
  // Bounded: drop the oldest cooldown marks so the map cannot grow for the life of the box.
  const mark = (key: string, at: number): void => {
    last.delete(key); last.set(key, at)
    if (last.size > 500) { const oldest = last.keys().next().value; if (oldest !== undefined) last.delete(oldest) }
  }
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    const notice = noticeFor(session, event)
    if (notice === undefined) return
    const key = `${notice.sessionId}:${notice.kind}`
    const now = Date.now()
    if (now - (last.get(key) ?? 0) < config.cooldownMs) return
    mark(key, now)
    void fetch(config.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notice), signal: AbortSignal.timeout(5000) })
      .catch((error: unknown) => { ctx.logger.warn(`desk-notify: ${error instanceof Error ? error.message : String(error)}`) })
  })
}
