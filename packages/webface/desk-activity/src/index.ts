/**
 * @webface/dsh-desk-activity — the Activity page's record.
 *
 * The harness already writes a complete approval audit trail: `approval/asked`
 * paired with exactly one `approval/decided`. Until now nobody could read it.
 * This follows every session's stream, pairs ask to answer, and keeps the last
 * `keep` of them in a file deskd renders, so the owner can see what Desk asked
 * to do and what they allowed or refused.
 *
 * Read-only: it never appends to a session and never decides anything.
 * @module @webface/dsh-desk-activity
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

export const name = 'desk-activity'
export const inject: string[] = []

export interface Config {
  /** Where the record is written (JSON) for deskd to render. */
  file: string
  /** How many entries to keep. An always-on box must not grow a file for ever. */
  keep: number
}
export const Config: z<Config> = z.object({
  file: z.string().default('/srv/desk/activity.json'),
  keep: z.number().default(500),
})

interface Entry {
  id: string
  sessionId: string
  tool: string
  reason?: string | undefined
  askedAt: string
  outcome?: string | undefined
  decidedAt?: string | undefined
}

// Event payloads are untyped session data here: only strings become fields.
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function apply(ctx: Context, config: Config): void {
  let entries: Entry[] = []
  // Seed from the last snapshot so a deploy does not empty the page.
  try {
    const seed = JSON.parse(readFileSync(config.file, 'utf8')) as { entries?: Entry[] }
    entries = (seed.entries ?? []).slice(-config.keep)
  } catch { /* no snapshot yet, or unreadable: the next approval rebuilds it */ }

  let pending = false
  const persist = (): void => {
    // Approvals arrive in bursts (ask then decide, milliseconds apart); one write per tick is enough.
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      try {
        const snapshot = { updatedAt: new Date().toISOString(), entries }
        writeFileSync(`${config.file}.tmp`, JSON.stringify(snapshot, null, 2), { mode: 0o600 })
        renameSync(`${config.file}.tmp`, config.file)
      } catch (error: unknown) {
        ctx.logger.warn(`desk-activity: write failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }, 250).unref()
  }

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    // Approval events are declared by dsh-user-approval, not in this package's view of the map.
    const type: string = event.type
    if (type !== 'approval/asked' && type !== 'approval/decided') return
    const p = (event as { data?: Record<string, unknown> }).data ?? {}
    const id = str(p.id)
    if (id === '') return
    const now = new Date().toISOString()

    if (type === 'approval/asked') {
      entries.push({
        id,
        sessionId: str((session as { id?: unknown }).id),
        tool: str(p.toolName) || 'an action',
        reason: str(p.reason) || undefined,
        askedAt: now,
      })
      if (entries.length > config.keep) entries = entries.slice(-config.keep)
    } else {
      // The pair can straddle a restart: a decision whose ask was never seen is
      // still worth showing, so record it rather than dropping it.
      const found = entries.find(e => e.id === id)
      if (found === undefined) {
        entries.push({ id, sessionId: str((session as { id?: unknown }).id), tool: 'an action', askedAt: now, outcome: str(p.outcome), decidedAt: now })
        if (entries.length > config.keep) entries = entries.slice(-config.keep)
      } else {
        found.outcome = str(p.outcome)
        found.decidedAt = now
      }
    }
    persist()
  })
}
