/**
 * @webface/dsh-desk-routines — the Routines page's data. Follows every
 * session's `schedule/change` events to keep the live routine set, writes it
 * to `file` for deskd to render, and applies delete requests deskd drops in
 * `actionsFile` by appending the same `schedule/change` delete the
 * schedule tool would — the schedule runtime honours it like any other.
 * @module @webface/dsh-desk-routines
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
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
  pollMs: number
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

// Event payloads are untyped session data: only strings become fields; anything else is dropped.
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
export function apply(ctx: Context, config: Config): void {
  const live = new Map<string, Routine>()
  // Sessions that emitted a schedule event, bounded: an always-on box must not pin every session forever.
  const sessions = new Map<string, Session>()
  const remember = (id: string, session: Session): void => {
    sessions.delete(id); sessions.set(id, session)
    if (sessions.size > 200) { const oldest = sessions.keys().next().value; if (oldest !== undefined) sessions.delete(oldest) }
  }
  // Seed from the last snapshot so the Routines page is not empty after a restart.
  try {
    const seed = JSON.parse(readFileSync(config.file, 'utf8')) as { routines?: Routine[] }
    for (const r of seed.routines ?? []) live.set(`${r.sessionId}:${r.id}`, r)
  } catch { /* no snapshot yet, or unreadable: the next schedule event rebuilds it */ }
  const persist = (): void => {
    try {
      const snapshot = { updatedAt: new Date().toISOString(), routines: [...live.values()] }
      writeFileSync(`${config.file}.tmp`, JSON.stringify(snapshot, null, 2), { mode: 0o600 })
      renameSync(`${config.file}.tmp`, config.file)
    } catch (error: unknown) {
      ctx.logger.warn(`desk-routines: write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    // The schedule event is declared by dsh-schedule, not in this package's view of the map.
    if ((event.type as string) !== 'schedule/change') return
    const sessionId = str((session as { id?: unknown }).id)
    remember(sessionId, session)
    const p = (event as { data?: Record<string, unknown> }).data ?? {}
    const op = str(p.operation)
    if (op === 'create') {
      const s = p.schedule as Record<string, unknown>
      live.set(`${sessionId}:${str(s.id)}`, {
        id: str(s.id),
        sessionId,
        kind: str(s.kind),
        prompt: str(s.prompt),
        everySeconds: typeof s.everySeconds === 'number' ? s.everySeconds : undefined,
        scheduledAt: str(s.scheduledAt),
      })
    } else if (op === 'delete') {
      live.delete(`${sessionId}:${str(p.id)}`)
    } else if (op === 'dispatch') {
      const key = `${sessionId}:${str(p.id)}`; const r = live.get(key)
      if (r !== undefined) {
        if (r.kind === 'every') r.lastRunAt = str(p.acceptedAt) || new Date().toISOString()
        else live.delete(key)
      }
    }
    persist()
  })
  const timer = setInterval(() => {
    if (!existsSync(config.actionsFile)) return
    let actions: Array<{ sessionId: string; id: string }> = []
    try {
      // Take the file by rename first so a request written during the read is not lost.
      const taken = `${config.actionsFile}.taking`
      renameSync(config.actionsFile, taken)
      const parsed: unknown = JSON.parse(readFileSync(taken, 'utf8'))
      actions = Array.isArray(parsed) ? parsed.filter((a): a is { sessionId: string; id: string } => typeof a === 'object' && a !== null && typeof (a as { sessionId?: unknown }).sessionId === 'string' && typeof (a as { id?: unknown }).id === 'string') : []
    } catch { return }
    for (const a of actions) {
      const session = sessions.get(a.sessionId)
      if (session === undefined) {
        ctx.logger.warn(`desk-routines: no live session ${a.sessionId} for delete of ${a.id}`)
        continue
      }
      try {
        const appender = session as unknown as { append: (type: string, payload: unknown) => void }
        appender.append('schedule/change', { version: 1, operation: 'delete', id: a.id })
      } catch (error: unknown) {
        ctx.logger.warn(`desk-routines: delete failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }, config.pollMs)
  timer.unref()
  ctx.effect(() => () => { clearInterval(timer) }, 'desk-routines: actions poll')
}
