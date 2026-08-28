/**
 * Sidebar foot links for a cloud Desk (behind deskd): Files and Sign out.
 * Hidden on a Desk with no deskd (the Mac ones).
 */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import css from './SignOut.module.css'
import { isCloudDesk } from './cloud.ts'

interface DeskStatus { billing?: { state?: string; portalUrl?: string }; push?: { devices?: number } }

const urlBase64ToKey = (b64: string): ArrayBuffer => { const pad = '='.repeat((4 - b64.length % 4) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); const out = new ArrayBuffer(raw.length); const view = new Uint8Array(out); for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i); return out }

/** Ask for permission (needs a tap), subscribe this device, tell deskd. */
async function enableNotifications(): Promise<string> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'This browser cannot receive notifications. On iPhone, add Desk to the Home Screen first (Share → Add to Home Screen), then open it from there.'
  const perm = await Notification.requestPermission(); if (perm !== 'granted') return 'Notifications were not allowed.'
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  const { key } = await (await fetch('/deskd/push/key', { credentials: 'same-origin' })).json() as { key: string }
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToKey(key) })
  await fetch('/deskd/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), label: navigator.userAgent.slice(0, 80) }) })
  await fetch('/deskd/push/test', { method: 'POST', credentials: 'same-origin' })
  return 'On. Desk will notify this device when it needs you.'
}

const FILES = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
const BIZ = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" /></svg>
const PLUG = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 2v6M15 2v6M7 8h10l-1 6a4 4 0 0 1-8 0z" /><path d="M12 18v4" /></svg>
const BELL = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
const CLOCK = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
const BROWSER = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 9h20M7 6.5h.01M10 6.5h.01" /></svg>
const OUT = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>

export function CloudLinks({ wide }: { wide: boolean }) {
  const [shown, setShown] = useState(false)
  const [billing, setBilling] = useState<DeskStatus['billing']>()
  const [notif, setNotif] = useState<string>('')
  const [pushOn, setPushOn] = useState(false)
  useEffect(() => {
    let live = true
    isCloudDesk().then(async (ok) => {
      if (!live || !ok) return
      setShown(true)
      try { const st = await (await fetch('/deskd/status', { credentials: 'same-origin' })).json() as DeskStatus; if (live) { setBilling(st.billing); setPushOn(Boolean(st.push?.devices) && typeof Notification !== 'undefined' && Notification.permission === 'granted') } } catch { /* status is best-effort; the links still render */ }
    })
    return () => { live = false }
  }, [])
  if (!shown) return null
  return (
    <div className={clsx(css.stack, !wide && css.railStack)}>
      {billing?.state === 'past_due' ? <a className={css.warn} href={billing.portalUrl || 'mailto:tommy@webfacemedia.com'} target="_blank" rel="noreferrer">{wide ? <span>Payment failed — update your card. Desk is in Guided mode until then.</span> : <span>!</span>}</a> : null}
      {!pushOn ? <button type="button" className={css.link} title="Get a notification when Desk needs you" aria-label="Turn on notifications" onClick={() => { enableNotifications().then((m) => { setNotif(m); if (m.startsWith('On')) setPushOn(true) }).catch(e => setNotif(String(e?.message ?? e))) }}>{BELL}{wide ? <span>Turn on notifications</span> : null}</button> : null}
      {notif && wide ? <span className={css.note}>{notif}</span> : null}
      <a className={css.link} href="/profile" title="Business" aria-label="Business">{BIZ}{wide ? <span>Business</span> : null}</a>
      <a className={css.link} href="/routines" title="Routines" aria-label="Routines">{CLOCK}{wide ? <span>Routines</span> : null}</a>
      <a className={css.link} href="/connections" title="Connections" aria-label="Connections">{PLUG}{wide ? <span>Connections</span> : null}</a>
      <a className={css.link} href="/browser" title="Browser — watch Desk or take the mouse" aria-label="Browser">{BROWSER}{wide ? <span>Browser</span> : null}</a>
      <a className={css.link} href="/files" title="Files" aria-label="Files">{FILES}{wide ? <span>Files</span> : null}</a>
      <a className={css.link} href="https://webfacedesk.app/download" target="_blank" rel="noreferrer" title="Desktop app for Mac, Windows, Linux" aria-label="Download app">{BROWSER}{wide ? <span>Download app</span> : null}</a>
      <a className={css.link} href="/logout" title="Sign out" aria-label="Sign out">{OUT}{wide ? <span>Sign out</span> : null}</a>
    </div>
  )
}
