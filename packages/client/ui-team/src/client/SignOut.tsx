/**
 * "Sign out" for a Desk that runs behind deskd (cloud box). Hidden on a Desk
 * with no sign-in (the Mac ones): it shows only once /deskd/status answers.
 */
import { useEffect, useState } from 'react'
import css from './SignOut.module.css'

export function SignOut({ wide }: { wide: boolean }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    let live = true
    fetch('/deskd/status', { credentials: 'same-origin' }).then((r) => { if (live && r.ok) setShown(true) }).catch(() => {})
    return () => { live = false }
  }, [])
  if (!shown) return null
  return (
    <a className={css.link} href="/logout" title="Sign out" aria-label="Sign out">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      {wide ? <span>Sign out</span> : null}
    </a>
  )
}
