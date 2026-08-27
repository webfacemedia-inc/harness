#!/usr/bin/env node
import { authorize } from './auth.js'
import { listAccounts, HOME, CLIENT_SECRET } from './config.js'
const [cmd] = process.argv.slice(2)
if (cmd === 'auth') {
  authorize().then(email => { console.log(`Connected ${email}`); process.exit(0) }).catch(e => { console.error(e.message); process.exit(1) })
} else if (cmd === 'accounts') {
  const a = listAccounts(); console.log(a.length ? a.join('\n') : '(none connected)')
} else {
  console.log(`google-mcp — webfaCe Desk Google connector\n\n  google-mcp auth       connect a Google account (opens the browser)\n  google-mcp accounts   list connected accounts\n\nconfig: ${HOME}\nclient: ${CLIENT_SECRET}`)
}
