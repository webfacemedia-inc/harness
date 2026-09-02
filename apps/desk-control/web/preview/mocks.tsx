// Local preview only (vite.config.preview.ts aliases the real modules here):
// fixture data so the authed views can be looked at without a Clerk session.
// Never part of the shipped build.
import type { ReactNode } from 'react'

const now = Date.now()
const iso = (msAgo: number) => new Date(now - msAgo).toISOString()

const ORDERS = [
  {
    _id: '1', orderId: 'static_demo', kind: 'internal', plan: 'internal', business: 'webfaCeMEdia',
    email: '', slug: 'demo', status: 'ready', host: 'demo.webfacedesk.app', dropletId: 595724007,
    createdAt: iso(86400000 * 5), updatedAt: iso(60000), billing: 'ok', lastSnapshot: iso(3600000 * 9),
    heartbeat: {
      at: iso(42000), ready: true, harness: true, google: 2, push: 1,
      usage: { monthTokens: 1834000, totalTokens: 9200000, sessions: 44, turns: 512 },
    },
  },
  {
    _id: '2', orderId: 'ord_demo1', kind: 'demo', plan: 'business', business: 'Maple & Main Plumbing',
    email: 'dana@example.com', slug: 'demo-maple-main', status: 'ready', host: 'demo-maple-main.webfacedesk.app',
    createdAt: iso(86400000 * 2), updatedAt: iso(120000), billing: 'ok',
    demo: { prospect: 'Dana Okafor', expiresAt: iso(-86400000 * 4.2), extendedCount: 1 },
    heartbeat: {
      at: iso(95000), ready: true, harness: true, google: 0, push: 0,
      usage: { monthTokens: 210000, totalTokens: 210000, sessions: 7, turns: 63 },
    },
  },
  {
    _id: '3', orderId: 'ord_x1', kind: 'paid', plan: 'business', business: 'Reeves Roofing',
    email: 'sam@example.com', slug: 'reeves', status: 'installing', detail: 'setting up your Desk',
    createdAt: iso(600000), updatedAt: iso(20000),
    lastError: { step: 'dns', message: 'cloudflare dns timed out, retrying', at: iso(90000) },
    heartbeat: null,
  },
]

const DETAIL = {
  ...ORDERS[1],
  snapshots: [{ _id: 's1', orderId: 'ord_demo1', name: 'desk-demo-maple-main-2026-09-01', kind: 'nightly', at: iso(3600000 * 9) }],
  usageDaily: [4, 9, 16, 12, 22, 31, 63].map((turns, i) => ({ _id: `u${i}`, orderId: 'ord_demo1', day: iso(86400000 * (6 - i)).slice(0, 10), sessions: Math.ceil(turns / 8), turns, tokens: turns * 3000 })),
}

const TEMPLATES = [
  { _id: 't1', name: 'Plumber demo (Dana story)', profile: { business: 'Maple & Main Plumbing', does: 'Plumbing across the GTA' }, brand: { primary: '1f6f99', tagline: 'Fast, tidy, guaranteed.' }, priceListMd: '# Prices', seedFiles: [], memorySeeds: [{ kind: 'commitment', about: 'Dana Okafor', text: 'Quoted $2,400', pinned: false }], updatedAt: iso(86400000) },
]

const AUDIT = [
  { _id: 'a1', at: iso(120000), actor: 'ops', action: 'config-push', orderId: 'ord_demo1', detail: 'tommy@webfacemedia.com: brand' },
  { _id: 'a2', at: iso(3600000), actor: 'stripe', action: 'billing:ok', orderId: 'ord_x1' },
  { _id: 'a3', at: iso(7200000), actor: 'system', action: 'box-ready', orderId: 'ord_demo1', detail: 'demo-maple-main.webfacedesk.app' },
  { _id: 'a4', at: iso(9000000), actor: 'ops', action: 'demo-created', orderId: 'ord_demo1', detail: 'tommy@: Maple & Main, 7d' },
]

// The generated api is a proxy that refuses stringification; Convex exposes
// getFunctionName for exactly this.
import { getFunctionName } from 'convex/server'
export function useQuery(ref: unknown, _args?: unknown): unknown {
  let name = ''
  try { name = getFunctionName(ref as never) } catch { name = '' }
  if (name.includes('listTemplates')) return TEMPLATES
  if (name.includes('auditFeed')) return AUDIT
  if (name.includes('orders:get')) return DETAIL
  return ORDERS
}
export const useMutation = () => async () => ({ orderId: 'ord_new', slug: 'new-box', welcome: 'https://webfacedesk.app/welcome?order=x' })
export const useAction = (ref: unknown) => async () => {
  let name = ''
  try { name = getFunctionName(ref as never) } catch { name = '' }
  if (name.includes('readBoxConfig')) return {
    profile: { business: 'Maple & Main Plumbing', does: 'Plumbing across the GTA', phone: '416-555-0100', email: 'hello@maplemain.ca' },
    brand: { primary: '#1f6f99', accent: '#3499cc', font: 'classic', tagline: 'Fast, tidy, guaranteed.' },
    priceListMd: '# Prices\n\n| Item | Price |\n|---|---|\n| Growth site | $6,900 |\n| Care plan | $149/mo |',
    memory: [
      { kind: 'commitment', about: 'Dana Okafor', text: 'Quoted $2,400 for the website rebuild', pinned: false },
      { kind: 'decision', text: 'No jobs outside the GTA', pinned: true },
    ],
  }
  return { recording: true, since: iso(83000), recordings: [{ file: '2026-09-01T22-22-45-613Z.mp4', bytes: 14334, at: iso(600000) }] }
}
export const Authenticated = ({ children }: { children: ReactNode }) => <>{children}</>
export const Unauthenticated = () => null
export class ConvexReactClient { constructor(_u: string) {} }
export const ConvexProviderWithClerk = ({ children }: { children: ReactNode }) => <>{children}</>
export const ClerkProvider = ({ children }: { children: ReactNode }) => <>{children}</>
export const useAuth = () => ({})
export const useUser = () => ({ user: { primaryEmailAddress: { emailAddress: 'tommy@webfacemedia.com' } } })
export const UserButton = () => <span style={{ width: 28, height: 28, borderRadius: 999, background: 'var(--tint)', display: 'inline-block' }} />
export const SignInButton = ({ children }: { children: ReactNode }) => <>{children}</>
