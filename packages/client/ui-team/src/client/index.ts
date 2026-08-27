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
import { SignOut } from './SignOut.tsx'

const LOCALE_NS = 'team'
const SETTINGS_NS = 'agent-presets'

export type { Teammate, TeamPanelInjected } from './TeamPanel.tsx'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote', 'sessions', 'agentPresetSeat']

/**
 * Client plugin body: dictionaries, then the sidebar occupant.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, {
    zh: { 'title': '团队', 'active': '默认', 'message': '与 {name} 开始对话' },
    en: { 'title': 'Team', 'active': 'default', 'message': 'Message {name}' },
  }), 'ui-team: dictionaries')

  const { api } = ctx.get('connection') as ConnectionHandle
  const readers = new Set<() => void>()
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns: string) => { if (ns === SETTINGS_NS) for (const read of readers) read() }),
      ctx.on('connection/reset', () => { for (const read of readers) read() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-team: roster refresh')

  const injected = (): TeamPanelInjected => ({
    load: async () => {
      try {
        const response = await api.agentPresets.list({})
        if (!response.result.ok) return { ok: false, error: response.result.error.message }
        const bots: Teammate[] = response.result.value.presets.map(p => ({
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
      await api.settings.update({ ns: SETTINGS_NS, patch: { default: id } })
      const state = ctx.sessions.list.getSnapshot()
      const current = state.current === undefined ? undefined : state.byId[state.current]
      if (current !== undefined && current.blank) await ctx.agentPresetSeat.select(id)
      else ctx.agentPresetSeat.stageAndStart(id)
    },
    subscribe: (read) => { readers.add(read); return () => { readers.delete(read) } },
    t: ctx.locale.bind(LOCALE_NS) as unknown as TeamPanelInjected['t'],
  })

  ctx.slots.inject('sidebar.team', () =>
    ctx.slots.register({ name: 'sidebar.team', inject: injected }, TeamPanel))
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({ name: 'sidebar.footer.action', id: 'desk-sign-out', inject: () => ({}) }, SignOut))
}


declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Teammates list copy. */
    'team': 'title' | 'active' | 'message'
  }
}
