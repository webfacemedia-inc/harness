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
import { TeamPanel, type Teammate, type TeamPanelInjected } from './TeamPanel.tsx'

const LOCALE_NS = 'team'
const SETTINGS_NS = 'agent-presets'

export type { Teammate, TeamPanelInjected } from './TeamPanel.tsx'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote', 'workspaces', 'sessions']

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
      // The default governs later sessions; the session in front of the user
      // is re-composed only while blank — a started session keeps its own.
      await api.settings.update({ ns: SETTINGS_NS, patch: { default: id } })
      const currentBlank = () => {
        const state = ctx.sessions.list.getSnapshot()
        const summary = state.current === undefined ? undefined : state.byId[state.current]
        return summary !== undefined && summary.blank ? summary : undefined
      }
      const blank = currentBlank()
      if (blank !== undefined) {
        if (blank.agentPreset !== id) await api.agentPresets.select({ sessionId: blank.id, agentPreset: id })
        return
      }
      const before = ctx.sessions.list.getSnapshot().current
      ctx.workspaces.startSession()
      await new Promise<void>((resolve) => {
        const done = () => { stop(); clearTimeout(timer); resolve() }
        const stop = ctx.sessions.list.subscribe(() => {
          const next = currentBlank()
          if (next === undefined || next.id === before) return
          void api.agentPresets.select({ sessionId: next.id, agentPreset: id }).finally(done)
        })
        const timer = setTimeout(done, 5000)
      })
    },
    subscribe: (read) => { readers.add(read); return () => { readers.delete(read) } },
    t: ctx.locale.bind(LOCALE_NS) as unknown as TeamPanelInjected['t'],
  })

  ctx.slots.inject('sidebar.team', () =>
    ctx.slots.register({ name: 'sidebar.team', inject: injected }, TeamPanel))
}


declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Teammates list copy. */
    'team': 'title' | 'active' | 'message'
  }
}
