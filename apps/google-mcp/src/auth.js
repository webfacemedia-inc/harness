// Loopback OAuth with the customer's OWN Desktop OAuth client. Google refuses
// shared clients for Gmail scopes, so there is no other way — and it means the
// customer, not webfaCeMEdia, owns the consent.
import { createServer } from 'node:http'
import { OAuth2Client } from 'google-auth-library'
import { google } from 'googleapis'
import { SCOPES, readClient, readToken, writeToken } from './config.js'

const PORT = Number(process.env.GOOGLE_MCP_AUTH_PORT ?? 8765)
let tokenWrites = Promise.resolve()

export function clientFor(account) {
  const { clientId, clientSecret } = readClient()
  const oauth = new OAuth2Client(clientId, clientSecret, `http://localhost:${PORT}`)
  const token = readToken(account)
  if (!token) throw new Error(`Account ${account} is not connected. Run: google-mcp auth --account ${account}`)
  oauth.setCredentials(token)
  // Refreshes are serialised per account so two concurrent tool calls cannot interleave read-modify-write.
  oauth.on('tokens', t => { tokenWrites = tokenWrites.then(() => { writeToken(account, { ...readToken(account), ...t }) }).catch(() => {}) })
  return oauth
}

/** Run the browser consent flow once; resolves with the connected address. */
export async function authorize({ openBrowser = true, log = console.error } = {}) {
  const { clientId, clientSecret } = readClient()
  const oauth = new OAuth2Client(clientId, clientSecret, `http://localhost:${PORT}`)
  const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES })
  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${PORT}`)
      const c = u.searchParams.get('code'); const err = u.searchParams.get('error')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(c
        ? '<!doctype html><meta charset="utf-8"><title>webfaCe Desk</title><body style="font-family:-apple-system,Segoe UI,sans-serif;padding:48px"><h2>Connected.</h2><p>You can close this tab and go back to Desk.</p></body>'
        : `<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,Segoe UI,sans-serif;padding:48px"><h2>Not connected</h2><p>${err ?? 'no code'}</p></body>`)
      server.close(); c ? resolve(c) : reject(new Error(err ?? 'no code'))
    })
    server.on('error', reject)
    server.listen(PORT, '127.0.0.1', () => {
      log(`Open this link to connect a Google account:\n${url}\n`)
      if (openBrowser) import('node:child_process').then(({ spawn }) => spawn('open', [url], { stdio: 'ignore', detached: true }).unref()).catch(() => {})
    })
  })
  const { tokens } = await oauth.getToken(code)
  oauth.setCredentials(tokens)
  const me = await google.oauth2({ version: 'v2', auth: oauth }).userinfo.get()
  const email = me.data.email
  if (!email) throw new Error('Google did not return an email for this account')
  writeToken(email, tokens)
  return email
}
