# The reel — one prospect, one working demo, one video that sells it

The marketing rig: qualify a prospect, let the planner design their site, spin
up a **real demo Desk seeded as their business**, film it working, and put the
film on a tracked page with a countdown. Runs from this Mac; only the demo Desk
itself lives in the cloud. Never name this rig in anything a prospect can see —
the public path is only ever `webfacedesk.app/for/<slug>-<token>`.

## Setup (once)

```sh
cd tools/reel && npm install && npx playwright install chromium
cp .env.example .env   # fill DESKAPI_OPS_KEY (prod control plane)
brew install ffmpeg    # if missing
```

## Per prospect (a Claude session drives this)

1. **Qualify** — Qualifier MCP: `get_hot_prospects` / `qualify_search`, then
   `generate_brief(placeId)` → save as `work/brief-<name>.json`. The brief has
   no email: enrich via Apollo MCP (`apollo_people_match` on their domain) or
   ask Tommy.
2. **Design** — Qualifier `queue_redesign(placeId)`, poll
   `get_redesign_status` until `previewUrl` (the planner's 3-variant set).
3. **Create** — `node reel.mjs create --brief work/brief-x.json
   --email <prospect-or-ours> --preview <previewUrl> [--days 7]`
   → provisions a demo Desk (~25 min), template generated from the brief
   (profile, memory notes citing their real findings, seeded enquiry, DRAFT
   price list — guessed numbers are always labelled draft).
4. **Scenes** — `node reel.mjs scenes --slug <slug>` → before/after stills,
   the preview scroll, the Desk answering the enquiry (local Playwright as
   owner), and the assistant working their site in its own browser (box
   recorder). `--skip-agent` drops the last one.
5. **Render** — `node reel.mjs render --slug <slug>` first writes
   `work/<slug>/reel.json`; **rewrite the beat copy per prospect** (the hook
   line comes from their sharpest finding — this is where the video stops
   being generic), then run render again → mp4 + poster. `--music track.mp3`
   mixes a supplied track; otherwise it ships silent-with-captions.
   **Watch the mp4.** If it wouldn't make you click, fix the beat sheet and
   re-render before anything ships.
6. **Publish** — `node reel.mjs publish --slug <slug>` → page + video + poster
   to `https://webfacedesk.app/for/<pageName>`. The page carries the demo's
   owner sign-in (that's why the path has a random token) and is
   Insights-tracked (siteId `webface`).
7. **The email** — a Gmail **draft** for Tommy to send himself. `htmlBody`
   ONLY, links on descriptive text, never a raw URL, never invented effort
   claims. The core of it is the video card:

   ```html
   <a href="https://webfacedesk.app/for/<pageName>">
     <img src="https://webfacedesk.app/for/<pageName>-poster.jpg"
          width="560" style="max-width:100%;border-radius:12px" alt="See it working">
   </a>
   ```

   plus one short personal paragraph (reference their actual finding), the
   expiry line ("live until <date>"), and a sign-off. Tommy reviews and sends.
8. **Track & follow up** — `node reel.mjs status --slug <slug>` (activity =
   they opened their Desk); page views land in Insights (site `webface`,
   path `/for/…`). Teardown is automatic at expiry, final snapshot kept;
   `destroy --slug <slug>` ends it early. A prospect who buys: convert from
   the console demo board — same box, billing flips.

## What talks to what

- `lib/api.mjs` → control plane: `POST /api/ops/demos`, `GET
  /api/ops/demos/<id>`, `POST /api/ops/boxes/<id>/credentials` (demo/internal
  only, audited), `POST /api/ops/action`.
- `lib/scenes.mjs` → the box directly: `/deskd/record` (`open-desk {url}` nets
  out to one tab), `/deskd/record/dl` (10-min signed link — download promptly).
- `video/` → Remotion; assets staged into `video/public/<slug>/` by render.
- Secrets: ops key in `.env`; the demo's password/boxToken in
  `work/<slug>/state.json` (0600) and on the tokened page. All gitignored.
