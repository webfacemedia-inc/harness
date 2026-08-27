// Where the connector keeps the customer's OAuth client and per-account tokens.
// Nothing here is ever sent anywhere except Google.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync } from 'node:fs'

export const HOME = process.env.GOOGLE_MCP_HOME ?? join(homedir(), '.config', 'webface-desk', 'google')
export const CLIENT_SECRET = join(HOME, 'client_secret.json')
export const TOKENS_DIR = join(HOME, 'tokens')

/** Scopes Desk asks for. Gmail modify = read, draft, label, send (send still gated in-tool). */
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
]

export function ensureDirs() {
  mkdirSync(TOKENS_DIR, { recursive: true, mode: 0o700 })
}

export function readClient() {
  if (!existsSync(CLIENT_SECRET)) {
    throw new Error(`No Google OAuth client at ${CLIENT_SECRET}. Create a Desktop-app OAuth client in your own Google Cloud project and save its JSON there (Desk's Connections page walks you through it).`)
  }
  const raw = JSON.parse(readFileSync(CLIENT_SECRET, 'utf8'))
  const c = raw.installed ?? raw.web
  if (!c?.client_id || !c?.client_secret) throw new Error(`${CLIENT_SECRET} is not a Google OAuth client JSON`)
  return { clientId: c.client_id, clientSecret: c.client_secret, projectId: c.project_id }
}

export function listAccounts() {
  ensureDirs()
  return readdirSync(TOKENS_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort()
}

export function tokenPath(account) { return join(TOKENS_DIR, `${account}.json`) }

export function readToken(account) {
  const p = tokenPath(account)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8'))
}

export function writeToken(account, token) {
  ensureDirs()
  const p = tokenPath(account)
  writeFileSync(p, JSON.stringify(token, null, 2), { mode: 0o600 })
  chmodSync(p, 0o600)
}

/** Resolve a bare prefix ("tommy@" / "tommy") to exactly one connected account. */
export function resolveAccount(hint) {
  const accounts = listAccounts()
  if (accounts.length === 0) throw new Error('No Google account connected yet. Run: google-mcp auth')
  if (!hint) {
    if (accounts.length === 1) return accounts[0]
    throw new Error(`Several accounts are connected (${accounts.join(', ')}); pass account=`)
  }
  const exact = accounts.find(a => a === hint)
  if (exact) return exact
  const matches = accounts.filter(a => a.startsWith(hint))
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) throw new Error(`No connected account matches "${hint}" (have: ${accounts.join(', ')})`)
  throw new Error(`"${hint}" matches ${matches.join(' and ')} — name it fully`)
}
