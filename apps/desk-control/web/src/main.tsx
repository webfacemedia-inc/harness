// webfaCe Desk Control — the operator console. Clerk signs Tommy in; Convex
// authorises through the operators allow-list and streams the fleet live.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider, useAuth } from '@clerk/clerk-react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { ConvexReactClient } from 'convex/react'
import { App } from './App'
import './ui.css'

const convexUrl = import.meta.env.VITE_CONVEX_URL as string
const clerkKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string) ?? 'pk_live_Y2xlcmsud2ViZmFjZW1lZGlhLmNvbSQ'
const convex = new ConvexReactClient(convexUrl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={clerkKey}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <App />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </StrictMode>,
)
