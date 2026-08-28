/**
 * @webface/dsh-desk-routines — the Routines page's data. Follows every
 * session's `schedule/change` events to keep the live routine set, writes it
 * to `file` for deskd to render, and applies delete requests deskd drops in
 * `actionsFile` by appending the same `schedule/change` delete the
 * schedule tool would — the schedule runtime honours it like any other.
 * @module @webface/dsh-desk-routines
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

export const name = 'desk-routines'
export const inject: string[] = []

export interface Config {
  /** Where the live routine set is written (JSON). */
  file: string
  /** Where deskd leaves delete requests: `[{ sessionId, id }]`. */
  actionsFile: string
  /** How often to look for requests, ms. */
  pollMs?: number
}
export const Config: z<Config> = z.object({
  file: z.string().default('/srv/desk/routines.json'),
  actionsFile: z.string().default('/srv/desk/routines-actions.json'),
  pollMs: z.number().default(3000),
})

interface Routine {
  id: string
  sessionId: string
  kind: string
  prompt: string
  everySeconds?: number | undefined
  scheduledAt: string
  lastRunAt?: string | undefined
}

export function apply(ctx: Context, config: Config): void {
  const live = new Map<string, Routine>()
  const sessions = new Map<string, Session>()
  const persist = (): void => {
    try {
      const snapshot = { updatedAt: new Date().toISOString(), routines: [...live.values()] }
      writeFileSync(config.file, JSON.stringify(snapshot, null, 2), { mode: 0o600 })
    } catch (error: unknown) {
      ctx.logger?.warn?.(`desk-routines: write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (String(event.type) !== 'schedule/change') return
    const sessionId = String((session as { id?: unknown }).id ?? '')
    sessions.set(sessionId, session)
    const p = (event as { payload?: Record<string, unknown> }).payload ?? {}
    const op = String(p.operation ?? '')
    if (op === 'create') {
      const s = p.schedule as Record<string, unknown>
      live.set(`${sessionId}:${String(s.id)}`, {
        id: String(s.id),
        sessionId,
        kind: String(s.kind),
        prompt: String(s.prompt),
        everySeconds: typeof s.everySeconds === 'number' ? s.everySeconds : undefined,
        scheduledAt: String(s.scheduledAt),
      })
    } else if (op === 'delete') {
      live.delete(`${sessionId}:${String(p.id)}`)
    } else if (op === 'dispatch') {
      const key = `${sessionId}:${String(p.id)}`; const r = live.get(key)
      if (r !== undefined) {
        if (r.kind === 'every') r.lastRunAt = String(p.acceptedAt ?? new Date().toISOString())
        else live.delete(key)
      }
    }
    persist()
  })
  const timer = setInterval(() => {
    if (!existsSync(config.actionsFile)) return
    let actions: Array<{ sessionId: string; id: string }> = []
    try { actions = JSON.parse(readFileSync(config.actionsFile, 'utf8')) as typeof actions; unlinkSync(config.actionsFile) } catch { return }
    for (const a of actions) {
      const session = sessions.get(a.sessionId)
      if (session === undefined) {
        ctx.logger?.warn?.(`desk-routines: no live session ${a.sessionId} for delete of ${a.id}`)
        continue
      }
      try {
        const appender = session as unknown as { append: (type: string, payload: unknown) => void }
        appender.append('schedule/change', { version: 1, operation: 'delete', id: a.id })
      } catch (error: unknown) {
        ctx.logger?.warn?.(`desk-routines: delete failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }, config.pollMs ?? 3000)
  timer.unref()
  ctx.effect(() => () => { clearInterval(timer) })
}
