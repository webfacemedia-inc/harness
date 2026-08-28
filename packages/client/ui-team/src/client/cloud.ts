/**
 * Cloud-Desk detection: a Desk fronted by deskd answers /deskd/status. On such
 * a Desk the customer never picks folders — the box IS the computer — so the
 * workspace controls are hidden and Files/Sign out appear in the sidebar foot.
 * A failed probe is not cached: deskd may simply not be up yet.
 */
export interface DeskStatus {
  /** Plan the box was provisioned for; gates operator-only modes. */
  plan: string
}
let probe: Promise<DeskStatus | null> | undefined
/**
 * Read the box status once per page load; a miss is retried on the next call.
 * @returns the status, or null when this is not a cloud Desk (or deskd is down).
 */
export function deskStatus(): Promise<DeskStatus | null> {
  probe ??= fetch('/deskd/status', { credentials: 'same-origin' })
    .then(async r => (r.ok ? { plan: (await r.json() as { plan?: string }).plan ?? 'business' } : null))
    .catch(() => null)
    .then((v) => { if (v === null) probe = undefined; return v })
  return probe
}
/**
 * Whether this Desk is fronted by deskd.
 * @returns true on a cloud Desk.
 */
export async function isCloudDesk(): Promise<boolean> { return (await deskStatus()) !== null }
// Workspace controls carry only localised aria-labels; both shipped locales are listed.
const LABELS = {
  add: ['Add workspace', '添加工作区'],
  actions: ['Workspace actions', '工作区操作'],
  choose: ['Choose workspace', '选择工作区'],
}
const LOCK_CSS = [
  ...LABELS.add.map(l => `[data-desk-cloud] button[aria-label="${l}"]`),
  ...LABELS.actions.map(l => `[data-desk-cloud] button[aria-label^="${l}"]`),
  ...LABELS.choose.map(l => `[data-desk-cloud] [aria-label="${l}"] + *`),
].join(',\n') + ' { display: none !important; }'
/**
 * Mark the document as a cloud Desk and hide the workspace controls.
 * @returns a disposer that removes the mark and the stylesheet.
 */
export async function applyCloudMode(): Promise<() => void> {
  if (!(await isCloudDesk())) return () => {}
  const root = document.documentElement
  root.setAttribute('data-desk-cloud', '1')
  const style = document.createElement('style'); style.id = 'desk-cloud-css'; style.textContent = LOCK_CSS
  document.head.append(style)
  return () => { style.remove(); root.removeAttribute('data-desk-cloud') }
}
