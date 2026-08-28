// Web Push to the owner's phone. VAPID keys are generated once per box and
// kept in push.json with the subscriptions; deskd itself is the only sender.
import { writeAtomic } from './fsx.js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import webpush from 'web-push'

const FILE = process.env.DESK_PUSH_FILE ?? '/srv/desk/push.json'
const read = () => { try { return JSON.parse(readFileSync(FILE, 'utf8')) } catch { return {} } }
const write = (s) => writeAtomic(FILE, JSON.stringify(s, null, 2))

function keys(host) {
  const s = read()
  if (!s.vapid) { s.vapid = webpush.generateVAPIDKeys(); write(s) }
  webpush.setVapidDetails(`https://${host}`, s.vapid.publicKey, s.vapid.privateKey)
  return s.vapid
}
export const publicKey = (host) => keys(host).publicKey
export function subscribe(sub, label) {
  const s = read(); s.subs = (s.subs ?? []).filter(x => x.sub.endpoint !== sub.endpoint)
  s.subs.push({ sub, label: label ?? '', at: new Date().toISOString() }); write(s); return s.subs.length
}
export function unsubscribe(endpoint) { const s = read(); s.subs = (s.subs ?? []).filter(x => x.sub.endpoint !== endpoint); write(s) }
export const count = () => (read().subs ?? []).length
/** Send to every device; drop subscriptions the push service says are gone. */
export async function send(host, notice) {
  keys(host); const s = read(); const subs = s.subs ?? []
  const url = notice.kind === 'handover' ? '/browser' : '/'
  const payload = JSON.stringify({ title: notice.title, body: notice.body, url, tag: `${notice.kind}:${notice.sessionId}` })
  let ok = 0
  for (const entry of subs) {
    try { await webpush.sendNotification(entry.sub, payload, { TTL: 600, urgency: 'high' }); ok++ }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) unsubscribe(entry.sub.endpoint); else console.error('push failed', e.statusCode ?? e.message) }
  }
  return { sent: ok, of: subs.length }
}
export const SW = `self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {} } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'Desk needs you', { body: d.body || '', tag: d.tag, renotify: true, data: { url: d.url || '/' }, icon: '/favicon.svg', badge: '/favicon.svg' }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || '/'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus() } }
    return self.clients.openWindow(url)
  }))
})
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
`
