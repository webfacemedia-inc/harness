# @webface/dsh-desk-app

The webfaCe Desk composition as a profile bundle: the Desk persona, the
teammates default, the in-app workspace picker (both halves), the Team panel,
routines (`dsh-time-context` + `dsh-schedule`), and the Google connector row.

## Profile

```json
{ "dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
  "@webface/dsh-desk-models", "@webface/dsh-desk-app" ] } } }
```

Environment the Google row reads: `DESK_HARNESS_DIR` (the fork checkout; the
process cwd when unset) and `DESK_GOOGLE_HOME` (default
`~/.config/webface-desk/google`). Per-Desk overrides — the customer's persona,
extra connectors — go in the profile's own `cordis.patch.yml`, applied after
this bundle.

## Limitations

- `@webface/*` packages are not in the dsh installation's dependency closure,
  so a profile must symlink them under `$DSH_HOME/profiles/node_modules/@webface/`
  until the Desk installer owns that step.
