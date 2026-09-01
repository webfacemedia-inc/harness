// Clerk prod instance (webfacemediainc) — the same issuer the Planner and
// Assistant consoles use; the JWT template named "convex" exists there.
// Authentication only: authorisation is the OPERATOR_EMAILS allow-list.
export default {
  providers: [{ domain: 'https://clerk.webfacemedia.com', applicationID: 'convex' }],
}
