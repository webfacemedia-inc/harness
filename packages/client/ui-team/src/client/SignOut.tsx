/**
 * Sidebar foot links for a cloud Desk (behind deskd): Files and Sign out.
 * Hidden on a Desk with no deskd (the Mac ones).
 */
import { useEffect, useState } from 'react'
import css from './SignOut.module.css'
import { isCloudDesk } from './cloud.ts'

const FILES = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
const OUT = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>

export function CloudLinks({ wide }: { wide: boolean }) {
  const [shown, setShown] = useState(false)
  useEffect(() => { let live = true; isCloudDesk().then((ok) => { if (live && ok) setShown(true) }); return () => { live = false } }, [])
  if (!shown) return null
  return (
    <div className={css.stack}>
      <a className={css.link} href="/files" title="Files" aria-label="Files">{FILES}{wide ? <span>Files</span> : null}</a>
      <a className={css.link} href="/logout" title="Sign out" aria-label="Sign out">{OUT}{wide ? <span>Sign out</span> : null}</a>
    </div>
  )
}
