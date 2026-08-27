/**
 * Cloud-Desk detection: a Desk fronted by deskd answers /deskd/status. On such
 * a Desk the customer never picks folders — the box IS the computer — so the
 * workspace controls are hidden and Files/Sign out appear in the sidebar foot.
 */
let probe: Promise<boolean> | undefined
export function isCloudDesk(): Promise<boolean> {
  probe ??= fetch('/deskd/status', { credentials: 'same-origin' }).then(r => r.ok).catch(() => false)
  return probe
}
const LOCK_CSS = `
[data-desk-cloud] button[aria-label="Add workspace"],
[data-desk-cloud] button[aria-label^="Workspace actions"],
[data-desk-cloud] [aria-label="Choose workspace"] + * { display: none !important; }
`
export async function applyCloudMode(): Promise<void> {
  if (!(await isCloudDesk())) return
  document.documentElement.setAttribute('data-desk-cloud', '1')
  if (!document.getElementById('desk-cloud-css')) {
    const s = document.createElement('style'); s.id = 'desk-cloud-css'; s.textContent = LOCK_CSS; document.head.appendChild(s)
  }
}
