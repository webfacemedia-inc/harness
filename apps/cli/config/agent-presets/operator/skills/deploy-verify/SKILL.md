---
name: deploy-verify
description: Use after any deploy — how to prove the new build is what is being served before telling anyone it is done.
---

# Verify a deploy

- Wait for the build to finish (READY state), not for the command to return.
- Pick a marker only the NEW build can emit (a commit stamp, a new string, a new asset hash) and fetch it from the live URL.
- A visual change is verified by rendering and looking, not by grepping data.
- Report what you checked and the exact URL; if a check was skipped, say so.
