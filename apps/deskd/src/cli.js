#!/usr/bin/env node
// deskd user tool:  deskd-user set <username> <email> [password]   (prints the password it generated)
import { writeAtomic } from './fsx.js'
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { AUTH_FILE, hashPassword } from './auth.js'
const [cmd, username, email, given] = process.argv.slice(2)
if (cmd !== 'set' || !username) { console.error('usage: deskd-user set <username> <email> [password]'); process.exit(2) }
const users = existsSync(AUTH_FILE) ? JSON.parse(readFileSync(AUTH_FILE, 'utf8')) : []
const password = given ?? randomBytes(12).toString('base64url')
const row = { username, email: email ?? null, scrypt: hashPassword(password) }
const i = users.findIndex(x => x.username === username); i >= 0 ? users[i] = row : users.push(row)
writeAtomic(AUTH_FILE, JSON.stringify(users, null, 2))
console.log(JSON.stringify({ username, email: row.email, password: given ? '(as given)' : password }))
