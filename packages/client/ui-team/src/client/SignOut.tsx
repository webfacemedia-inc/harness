/**
 * Sidebar foot links for a cloud Desk (behind deskd): Files and Sign out.
 * Hidden on a Desk with no deskd (the Mac ones).
 */
import { useEffect, useState } from 'react'
import css from './SignOut.module.css'
import { isCloudDesk } from './cloud.ts'

interface DeskStatus { billing?: { state?: string; portalUrl?: string } }

const FILES = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
const BIZ = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" /></svg>
const PLUG = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 2v6M15 2v6M7 8h10l-1 6a4 4 0 0 1-8 0z" /><path d="M12 18v4" /></svg>
const BROWSER = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 9h20M7 6.5h.01M10 6.5h.01" /></svg>
const OUT = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>

export function CloudLinks({ wide }: { wide: boolean }) {
  const [shown, setShown] = useState(false)
  const [billing, setBilling] = useState<DeskStatus['billing']>()
  useEffect(() => {
    let live = true
    isCloudDesk().then(async (ok) => {
      if (!live || !ok) return
      setShown(true)
      try { const st = await (await fetch('/deskd/status', { credentials: 'same-origin' })).json() as DeskStatus; if (live) setBilling(st.billing) } catch { /* status is best-effort; the links still render */ }
    })
    return () => { live = false }
  }, [])
  if (!shown) return null
  return (
    <div className={css.stack}>
      {billing?.state === 'past_due' ? <a className={css.warn} href={billing.portalUrl || 'mailto:tommy@webfacemedia.com'} target="_blank" rel="noreferrer">{wide ? <span>Payment failed — update your card. Desk is in Guided mode until then.</span> : <span>!</span>}</a> : null}
      <a className={css.link} href="/profile" title="Business" aria-label="Business">{BIZ}{wide ? <span>Business</span> : null}</a>
      <a className={css.link} href="/connections" title="Connections" aria-label="Connections">{PLUG}{wide ? <span>Connections</span> : null}</a>
      <a className={css.link} href="/vnc/vnc.html?autoconnect=1&resize=scale" title="Browser — watch Desk or take the mouse" aria-label="Browser">{BROWSER}{wide ? <span>Browser</span> : null}</a>
      <a className={css.link} href="/files" title="Files" aria-label="Files">{FILES}{wide ? <span>Files</span> : null}</a>
      <a className={css.link} href="/logout" title="Sign out" aria-label="Sign out">{OUT}{wide ? <span>Sign out</span> : null}</a>
    </div>
  )
}
