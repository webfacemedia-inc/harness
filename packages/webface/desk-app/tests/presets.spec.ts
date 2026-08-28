import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

// The generated presets are the product's safety story: a mode without a shell
// must not reach one through delegation. This pins scripts/gen-desk-presets.mjs.
const root = join(import.meta.dirname, '..', '..', '..', '..', 'apps', 'cli', 'config', 'agent-presets')
const spec = yaml.load(readFileSync(join(root, 'desk-team.yml'), 'utf8')) as { teammates: Array<{ id: string; shell: boolean }> }
const SHELL = ['bash', 'pwsh', 'str_replace_editor', 'write', 'edit', 'run_code']

type Row = { id: string; disabled?: unknown; config?: { toolName?: string; agentOptions?: { toolFilter?: { deny?: string[] } } } }
function rows(id: string): Row[] {
  const doc = yaml.load(readFileSync(join(root, id, 'agent.cordis.yml'), 'utf8'), { schema: entryListSchema })
  const out: Row[] = []
  const walk = (list: unknown[]): void => { for (const p of list) { const r = p as { id?: string; config?: unknown }; if (typeof r.id === 'string') out.push(r as Row); if (Array.isArray(r.config)) walk(r.config) } }
  walk(Array.isArray(doc) ? doc : ((doc as { plugins?: unknown[] }).plugins ?? []))
  return out
}

describe('generated Desk presets', () => {
  it('lists every mode from desk-team.yml as a preset directory', () => {
    const dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    for (const t of spec.teammates) expect(dirs).toContain(t.id)
  })
  for (const t of spec.teammates.filter(x => !x.shell)) {
    it(`${t.id} (no shell) denies shell tools on every delegation and has no generic subagent`, () => {
      const all = rows(t.id)
      expect(all.find(r => r.id === 'tool-bash')?.disabled).toBe(true)
      expect(all.find(r => r.id === 'tool-subagent')?.disabled).toBe(true)
      const asks = all.filter(r => r.id.startsWith('tool-ask_'))
      expect(asks.length).toBe(spec.teammates.length - 1)
      for (const a of asks) for (const tool of SHELL) expect(a.config?.agentOptions?.toolFilter?.deny ?? []).toContain(tool)
    })
  }
  for (const t of spec.teammates.filter(x => x.shell)) {
    it(`${t.id} (shell) keeps a shell for shell-bearing delegations only`, () => {
      const asks = rows(t.id).filter(r => r.id.startsWith('tool-ask_'))
      for (const a of asks) {
        const child = spec.teammates.find(x => `tool-ask_${x.id.replace(/-/g, '_')}` === a.id)
        const deny = a.config?.agentOptions?.toolFilter?.deny ?? []
        if (child?.shell) expect(deny).not.toContain('bash'); else expect(deny).toContain('bash')
      }
    })
  }
})
