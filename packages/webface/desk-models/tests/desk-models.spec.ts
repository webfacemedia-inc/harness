/**
 * The bundle's substance is its patch file: it must parse, pin the Desk
 * default model to the OpenRouter route, declare every listed model on that
 * route, and disable telemetry as a literal — never behind an env expression.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

type Row = { id?: string; config?: Record<string, unknown> }

function loadRows(): Row[] {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    dsh?: { bundle?: { patch?: string } }
  }
  expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  const parsed = yaml.load(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'), {
    schema: entryListSchema,
  })
  expect(Array.isArray(parsed)).toBe(true)
  return parsed as Row[]
}

describe('@webface/dsh-desk-models bundle', () => {
  it('routes the Desk default model through OpenRouter and declares it', () => {
    const rows = loadRows()
    const defaults = rows.find(row => row.id === 'agent-default-model')?.config as
      | { provider: string; model: string }
      | undefined
    expect(defaults).toEqual({ provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' })
    const providers = rows.find(row => row.id === 'llm-pi-ai')?.config?.['providers'] as Record<
      string,
      { apiKeyEnv: string; baseURL: unknown; models: { id: string }[] }
    >
    const openrouter = providers['openrouter']
    if (openrouter === undefined) throw new Error('the openrouter route must be declared')
    expect(openrouter.apiKeyEnv).toBe('OPENROUTER_API_KEY')
    expect(openrouter.baseURL).toBe('https://openrouter.ai/api/v1')
    const ids = openrouter.models.map(model => model.id)
    expect(ids).toContain(defaults!.model)
    // One id per model; the route serves each vendor Tommy named.
    expect(new Set(ids).size).toBe(ids.length)
    for (const vendor of ['deepseek/', 'z-ai/', 'moonshotai/', 'qwen/', 'anthropic/', 'openai/']) {
      expect(ids.some(id => id.startsWith(vendor)), vendor).toBe(true)
    }
    const sovereign = providers['sovereign']
    if (sovereign === undefined) throw new Error('the sovereign route must be declared')
    expect(sovereign.apiKeyEnv).toBe('SOVEREIGN_GATEWAY_KEY')
  })

  it('disables telemetry as a literal, not an environment expression', () => {
    const rows = loadRows()
    const telemetry = rows.find(row => row.id === 'session-telemetry-otel')?.config as {
      mode: unknown
      exporter: { url: unknown }
    }
    expect(telemetry.mode).toBe('DISABLED')
    expect(String(telemetry.exporter.url)).not.toContain('deepseeksvc')
    expect(telemetry.mode).not.toHaveProperty('__jsExpr')
  })
})
