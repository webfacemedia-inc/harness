# webfaCe Desk — desktop app

A small Wails (Go + WebView) window onto a Desk. It asks for the Desk address once, probes `/healthz`
on it, and then shows the Desk in a frame. Nothing runs locally; the Desk stays on its own server.

- `main.go` — window, menu (Desk → Change Desk…, ⌘⇧D / Ctrl+Shift+D), build-time `version`.
- `app.go` — bound methods (`Version`) and startup (quarantine clearing, translocation notice).
- `quarantine_darwin.go` — clears `com.apple.quarantine` from the bundle after the first right-click → Open.
- `frontend/` — the address screen and frame; `build.mjs` copies it to `frontend/dist`.

Releases are built by `.github/workflows/desktop.yml` on a `desktop-v*` tag (macOS universal, Windows, Linux) and
served from https://webfacedesk.app/download.
