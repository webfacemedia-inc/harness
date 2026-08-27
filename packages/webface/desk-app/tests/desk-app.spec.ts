/**
 * The bundle's substance is its patch file: it must parse, mount both halves
 * of the browse picker, the Team panel, routines, and the Google connector
 * row, and set the teammates default.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

type Row = { id?: string; name?: string; config?: Record<string, unknown>; disabled?: unknown; insert?: Row[] }

function loadPatch(): Row[] {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
  expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  const parsed = yaml.load(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'), { schema: entryListSchema })
  expect(Array.isArray(parsed)).toBe(true)
  return parsed as Row[]
}

describe('@webface/dsh-desk-app bundle', () => {
  it('composes the Desk surface rows', () => {
    const rows = loadPatch()
    const inserted = rows.flatMap(row => row.insert ?? [])
    const names = inserted.map(row => row.name)
    for (const name of [
      '@deepseek-ai/dsh-host-directory-picker-browse',
      '@deepseek-ai/dsh-client-ui-directory-picker-browse',
      '@webface/dsh-client-ui-team',
      '@deepseek-ai/dsh-time-context',
      '@deepseek-ai/dsh-schedule',
      '@deepseek-ai/dsh-mcp-client',
    ]) expect(names, name).toContain(name)
    expect(rows.find(row => row.id === 'directory-picker')?.disabled).toBe(true)
    expect(rows.find(row => row.id === 'agent-presets')?.config).toEqual({ default: 'desk-operator' })
    const persona = String(rows.find(row => row.id === 'system-prompt')?.config?.['persona'])
    expect(persona).toContain('You are Desk')
    expect(persona).not.toMatch(/DeepSeek/)
    const presets = rows.find(row => row.id === 'permission')?.config?.['presets'] as Record<string, { sandbox: string; approval: string }>
    expect(presets['guided']).toEqual({ sandbox: 'read-only', approval: 'ask' })
    expect(presets['full']).toEqual({ sandbox: 'workspace-write', approval: 'ask' })
  })

  it('keeps the Google connector on the customer machine with no literal paths', () => {
    const google = loadPatch().flatMap(row => row.insert ?? []).find(row => row.id === 'mcp-google')
    const config = google?.config as { serverName: string; transport: string; command: unknown; args: unknown }
    expect(config.serverName).toBe('google')
    expect(config.transport).toBe('stdio')
    expect(config.command).toHaveProperty('__jsExpr')
    expect(config.args).toHaveProperty('__jsExpr')
  })
})
