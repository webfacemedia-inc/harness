/**
 * Browser half of the webfaCe Desk teammates surface: registers the
 * `sidebar.team` occupant. Reads dsh's agent-preset roster, writes the
 * `agent-presets.default` setting, and starts a session — nothing here is
 * new state; it is a different face on the preset machinery.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the SlotMap merges declaring `sidebar.team` and the workspace service.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { TeamPanel, type Teammate, type TeamPanelInjected } from './TeamPanel.tsx'
import { CloudLinks } from './SignOut.tsx'
import { applyCloudMode, deskStatus } from './cloud.ts'

const LOCALE_NS = 'team'
const SETTINGS_NS = 'agent-presets'

export type { Teammate, TeamPanelInjected } from './TeamPanel.tsx'

/** Required services (cordis fiber inject). */
// `agentPresetSeat` is conversation-scoped; it is resolved at call time so this
// plugin (and the styles it owns) applies before that scope exists.
export const inject = ['slots', 'locale', 'connection', 'remote', 'sessions']

/**
 * Client plugin body: dictionaries, then the sidebar occupant.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, {
    zh: { 'title': '模式', 'active': '默认', 'message': '切换到 {name}' },
    en: { 'title': 'Modes', 'active': 'default', 'message': 'Switch to {name}' },
  }), 'ui-team: dictionaries')

  // Desk hides harness plumbing a business owner never needs: the per-turn
  // context-injection rows (AGENTS.md, system prompt, skill catalog) and the
  // token/TTFT stats line. Recalled-work rows stay visible; usage lives on the
  // Business page.
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = '[data-context-role="injection"]{display:none}[data-stats-line]{display:none}'
    document.head.append(style)
    return () => { style.remove() }
  }, 'ui-team: hide harness chrome')
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    let live = true
    void applyCloudMode().then((d) => { if (live) dispose = d; else d() })
    return () => { live = false; dispose?.() }
  }, 'ui-team: cloud lock')

  const { api } = ctx.get('connection') as ConnectionHandle
  const readers = new Set<() => void>()
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns: string) => { if (ns === SETTINGS_NS) for (const read of readers) read() }),
      ctx.on('connection/reset', () => { for (const read of readers) read() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-team: roster refresh')

  // The seat exists once a conversation scope is up; a pick before that is a real error, not a silent no-op.
  const seatOrThrow = () => { const seat = ctx.get('agentPresetSeat'); if (seat === undefined) throw new Error('Desk is still starting — try again in a moment.'); return seat }
  const injected = (): TeamPanelInjected => ({
    load: async () => {
      try {
        const response = await api.agentPresets.list({})
        if (!response.result.ok) return { ok: false, error: response.result.error.message }
        const plan = (await deskStatus())?.plan ?? 'operators'  // a local Desk is the operator's own
        const bots: Teammate[] = response.result.value.presets.filter(p => p.id !== 'operator' || plan === 'operators').map(p => ({
          id: p.id,
          name: p.name ?? p.id,
          description: p.description ?? '',
          isDefault: p.isDefault,
          ...(p.broken === undefined ? {} : { broken: p.broken }),
        }))
        return { ok: true, bots }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    message: async (id: string) => {
      // The default governs later sessions; the seat (ui-agent-preset) owns
      // which session the pick lands on — blank now, or the one it starts.
      // Stage first, then persist the default: the settings update re-loads the
      // seat, and a load landing after the stage would clobber the pick.
      const seat = seatOrThrow()
      const state = ctx.sessions.list.getSnapshot()
      const current = state.current === undefined ? undefined : state.byId[state.current]
      if (current !== undefined && current.blank) await seat.select(id)
      else seat.stageAndStart(id)
      await api.settings.update({ ns: SETTINGS_NS, patch: { default: id } })
    },
    subscribe: (read) => {
      readers.add(read)
      const off = ctx.get('agentPresetSeat')?.subscribe(read) ?? (() => {})
      return () => { readers.delete(read); off() }
    },
    current: () => ctx.get('agentPresetSeat')?.current(),
    t: ctx.locale.bind(LOCALE_NS),
  })

  ctx.slots.inject('sidebar.team', () =>
    ctx.slots.register({ name: 'sidebar.team', inject: injected }, TeamPanel))
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({ name: 'sidebar.footer.action', id: 'desk-sign-out', inject: () => ({}) }, CloudLinks))
}


declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Teammates list copy. */
    'team': 'title' | 'active' | 'message'
  }
}
