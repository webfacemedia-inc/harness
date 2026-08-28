#!/usr/bin/env node
// Mint / list / revoke webfaCeMEdia service tokens (`wfs_…`) for a Desk.
//   node scripts/wfs-token.mjs mint <clerkOrgId> <createdByUserId> [--client <slug>] [--label "Desk for X"]
//   node scripts/wfs-token.mjs list <clerkOrgId>
//   node scripts/wfs-token.mjs revoke <prefix>
// Auth: AGENT_API_SECRET env, or ~/.webface-mcp/config.json agentApiSecret.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
const site = process.env.PLATFORM_CONVEX_SITE_URL ?? 'https://qualified-clownfish-173.convex.site'
let secret = process.env.AGENT_API_SECRET
if (!secret) { try { secret = JSON.parse(readFileSync(`${homedir()}/.webface-mcp/config.json`, 'utf8')).agentApiSecret } catch {} }
if (!secret) { console.error('no AGENT_API_SECRET'); process.exit(2) }
const [cmd, a, b, ...rest] = process.argv.slice(2)
const opt = k => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined }
const call = async (path, body) => { const r = await fetch(`${site}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-secret': secret }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j)}`); return j }
if (cmd === 'mint' && a && b) console.log(JSON.stringify(await call('/serviceTokens/mint', { clerkOrgId: a, createdBy: b, clientSlug: opt('client'), label: opt('label') ?? 'desk' })))
else if (cmd === 'list' && a) console.log(JSON.stringify(await call('/serviceTokens/list', { clerkOrgId: a }), null, 1))
else if (cmd === 'revoke' && a) console.log(JSON.stringify(await call('/serviceTokens/revoke', { prefix: a })))
else { console.error('usage: mint <orgId> <userId> [--client slug] | list <orgId> | revoke <prefix>'); process.exit(2) }
