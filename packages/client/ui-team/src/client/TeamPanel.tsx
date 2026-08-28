/**
 * The teammates list: every agent preset the Desk composes, as people you
 * message. Choosing one makes it the default for new sessions and starts a
 * session with it — the Grok-Bot-shaped "message a teammate" move built on
 * dsh's own preset roster and settings.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './TeamPanel.module.css'

/** One teammate as the host reports it. */
export interface Teammate {
  id: string
  name: string
  description: string
  isDefault: boolean
  broken?: string
}

/** Registration-side business face. */
export interface TeamPanelInjected {
  /** Read the roster. */
  load: () => Promise<{ ok: true; bots: Teammate[] } | { ok: false; error: string }>
  /** Make this teammate the default and start a session with it. */
  message: (id: string) => Promise<void>
  /** Re-read when the roster or the default changes elsewhere. */
  subscribe: (read: () => void) => () => void
  /** The preset the conversation chip shows right now (staged or current session). */
  current: () => string | undefined
  /** Translate one key of this surface's copy. */
  t: (key: 'title' | 'active' | 'message', params?: Record<string, string>) => string
}

/** Full component props. */
export type TeamPanelProps = PropsRuntime<'sidebar.team'> & InjectFace<TeamPanelInjected>

/** dsh's own engineering presets are not teammates; Desk lists the Bots it ships or the customer authored. */
const STOCK_PRESETS = new Set(['standard', 'code', 'minimal', 'cordis'])

const initials = (name: string): string =>
  name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'

/**
 * Render the teammates list.
 * @param props - composed slot props.
 * @returns the list, or nothing when the deployment composes no presets.
 */
export function TeamPanel({ wide, load, message, subscribe, current, t }: TeamPanelProps) {
  const [bots, setBots] = useState<Teammate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // The seat's pick is an external store: read it through React's subscription so a render never tears.
  const picked = useSyncExternalStore(subscribe, current, current)
  useEffect(() => {
    let live = true
    const read = (): void => {
      void load().then((result) => {
        if (!live) return
        if (result.ok) { setBots(result.bots); setError(null) } else { setError(result.error) }
      })
    }
    read()
    const unsubscribe = subscribe(read)
    return () => { live = false; unsubscribe() }
  }, [load, subscribe])
  if (bots === null && error === null) return null
  if (error !== null) return <div className={css.empty} role="alert">{error}</div>
  const list = (bots ?? []).filter(b => b.broken === undefined && !STOCK_PRESETS.has(b.id))
  if (list.length === 0) return null
  const onPick = (id: string): void => {
    setBusy(id)
    void message(id)
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setBusy(null) })
  }
  if (!wide) {
    return (
      <div className={css.rail} aria-label={t('title')}>
        {list.map(b => (
          <button key={b.id} type="button" className={clsx(css.bot, (picked ? picked === b.id : b.isDefault) && css.active)} title={b.name} aria-label={t('message', { name: b.name })} disabled={busy === b.id} onClick={() => { onPick(b.id) }}>
            <span className={css.avatar}>{initials(b.name)}</span>
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className={css.root}>
      <div className={css.header}><span>{t('title')}</span></div>
      <div className={css.list}>
        {list.map(b => (
          <button key={b.id} type="button" className={clsx(css.bot, (picked ? picked === b.id : b.isDefault) && css.active)} aria-label={t('message', { name: b.name })} disabled={busy === b.id} onClick={() => { onPick(b.id) }}>
            <span className={css.avatar} aria-hidden="true">{initials(b.name)}</span>
            <span className={css.text}>
              <span className={css.name}>{b.name}</span>
              {b.description !== '' && <span className={css.desc}>{b.description}</span>}
            </span>
            {b.isDefault && <span className={css.status}>{t('active')}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
