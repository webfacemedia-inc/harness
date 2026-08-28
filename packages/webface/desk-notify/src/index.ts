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
  cooldownMs?: number
}
export const Config: z<Config> = z.object({
  url: z.string().default('http://127.0.0.1:8090/deskd/notify'),
  cooldownMs: z.number().default(20_000),
})

interface Notice { kind: 'approval' | 'question' | 'handover'; sessionId: string; title: string; body: string }

/** Classify an event into a notice, or undefined when the owner is not needed. */
export function noticeFor(session: Session, event: SessionEvent): Notice | undefined {
  const type = String(event.type)
  const payload = (event as { payload?: Record<string, unknown> }).payload ?? {}
  const sessionId = String((session as { id?: unknown }).id ?? '')
  if (type === 'approval/asked') {
    const tool = String(payload.toolName ?? 'an action')
    return { kind: 'approval', sessionId, title: 'Desk needs your approval', body: `${tool}${payload.reason ? ` — ${String(payload.reason)}` : ''}` }
  }
  if (/question|ask-user|ask_user/.test(type) && !/answer|resolved|decided/.test(type)) {
    const q = String(payload.question ?? payload.prompt ?? payload.text ?? '')
    return { kind: 'question', sessionId, title: 'Desk has a question for you', body: q.slice(0, 140) }
  }
  if (type === 'assistant/message' || type === 'message/assistant' || /assistant.*(message|text)/.test(type)) {
    const text = String(payload.text ?? payload.content ?? '')
    if (/I need you for a moment/i.test(text)) return { kind: 'handover', sessionId, title: 'Desk needs you at the browser', body: text.slice(0, 140) }
  }
  return undefined
}

export function apply(ctx: Context, config: Config): void {
  const last = new Map<string, number>()
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    const notice = noticeFor(session, event)
    if (notice === undefined) return
    const key = `${notice.sessionId}:${notice.kind}`
    const now = Date.now()
    if (now - (last.get(key) ?? 0) < (config.cooldownMs ?? 20_000)) return
    last.set(key, now)
    void fetch(config.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notice), signal: AbortSignal.timeout(5000) })
      .catch((error: unknown) => { ctx.logger?.warn?.(`desk-notify: ${error instanceof Error ? error.message : String(error)}`) })
  })
}
