# KanDeck — Build Notes & Progress Log

A running log of what's built so you can pick up where we left off.
Last updated: 2026-07-25

## How to run (local dev on your Mac)

```bash
npm install            # first time only
cp .env.example .env   # first time only — then edit secrets
npm run dev            # http://localhost:8080 with auto-reload (nodemon)
```

First visit prompts you to **create an application password** (stored hashed in
`data/config.json`). After that, `/login` gates the app.

**Stack:** Node.js + Express (ESM) · flat-file JSON store (no database) ·
plain HTML/CSS/JS frontend with a locally-vendored SortableJS for drag-and-drop
(no build step, works offline).

---

## Progress — all 6 parts complete ✅

- [x] **Part 1 — Scaffold & storage engine** (atomic writes + file locking)
- [x] **Part 2 — Boards/columns/cards model & REST API**
- [x] **Part 3 — Auth & sessions** (hashed password, JWT cookie, API key)
- [x] **Part 4 — Frontend UI** (tabs, drag-drop, 20 palettes, themes, zoom, clock)
- [x] **Part 5 — Notifications, backups, search, archive**
- [x] **Part 6 — Docker (AMD64 buildx) deployment**

Everything below was tested: REST endpoints via curl, a 40-writer concurrency
stress test (0 corruption), and the UI driven headlessly (setup → card CRUD →
palette/theme → backups/archive) with no console errors.

---

## Update 2026-07-25 — App-level priorities + Inbox

**App-level priorities (separate from board settings).**
Priorities now live in `data/settings.json` (app-wide), each with a default
color, editable in a dedicated **App settings** modal (🎚️ in the top bar —
distinct from the board ⚙️). Selecting a card's priority adopts that priority's
color automatically; the color is still overridable per card (the color picker
now offers priority colors + the board palette). Files: `src/storage/settings.js`.
API: `GET /api/settings`, `PUT /api/settings/priorities`.

**Inbox (new feature, API-driven).**
A holding area at `data/inbox.json`. Routing: `POST /api/tasks` **with** a
`boardId` goes straight to that board; **without** one it lands in the Inbox for
triage. A left **Inbox panel** lists items; drag an item onto any column to file
it (creates the card, removes the inbox item). A **bottom toggle bar** switches
between Inbox and Board views. Files: `src/storage/inbox.js`.
API: `GET /api/inbox`, `POST /api/inbox`, `DELETE /api/inbox/:id`,
`POST /api/inbox/:id/move {boardId, columnId, index}`.
Tested headlessly: API→inbox routing, priority→color coupling, add priority,
and a real drag from inbox into a column — no console errors.

---

## Update 2026-07-25 (later) — color model + theming overhaul

- **Theme moved to App settings** and expanded to **20 presets** (10 light + 10
  dark, paired by accent). `public/themes.js` defines them; the 🌓 top-bar button
  flips a theme to its light/dark twin. Stored as `settings.theme` (a preset id).
- **App settings** now holds three things: theme, **categories** (was
  "priorities" — colored card badges), and a **lane-colors palette**.
- **Board settings** is the lane manager: rename, recolor (from the lane
  palette), delete, drag-reorder, and add lanes. Adding/deleting a lane happens
  **only** here — the board view no longer has ＋Add column or a delete button.
- **Lanes are colored** — the whole swim lane uses the lane color as its
  background (defaults are soft **pastels**; existing boards auto-migrate from
  the old vibrant colors). **Cards are always white** — card color coding removed
  (no card color picker; category is a colored badge). Tags tint from the palette.
- Zoom bubble restyled: smaller **oval, Apple-glass** transparency.
- API: `PUT /api/settings` (merges theme/categories/laneColors); columns carry a
  `color`; `POST /columns` returns the created column. `palettes.js` is unused.

---

## Update 2026-07-26 — completion workflow

- **Complete lane:** one lane per board is the "complete" lane (Board settings →
  ◉ radio; default Done). Cards dragged in are marked `complete`; dragged out are
  un-marked (server-side, `board.settings.completeColumnId`).
- **Hover-to-complete circle:** hovering a card slides in a circle on the left;
  click it to complete — the card animates and moves to the complete lane and the
  circle goes green with a check (Trello-style). Clicking a completed card's check
  moves it back out.
- **Completed date:** cards gain `completedAt` (auto-set on complete, cleared on
  un-complete), shown as a green `✓ <date>` badge and in the card modal.
- **Fall-off window:** Board settings `completeWindowDays` (0 = show all) — the
  complete lane only shows cards completed within N days; older ones hide (never
  deleted) with a "＋N older completed" hint, and **searching reveals them**.
- **Backups moved to App settings** (they're app-wide, not per-board).
- **Switcher** restyled to a floating Trello-style pill (hovering, rounded,
  active item tinted + underlined).

---

## Update 2026-07-26 (later) — layout reshuffle

- **Board tabs removed** from the top bar. Switch boards via a new **Switch
  board** item in the bottom pill → popup lists all boards (current highlighted).
- **Search** moved to the center of the top bar. **Light/dark toggle removed**
  (theme is set in App settings → Theme tab).
- **Board settings** (⚙️) and **New board** (＋) moved to the top-right of the
  board area. **App settings** (⚙️) sits next to Logout in the top bar.
- App settings modal is **tabbed** (Theme / Categories / Lane colors / Backups).

---

## Update 2026-07-26 (later 2) — search finder + polish

- **Search-as-you-type finder:** the top search now queries all boards
  (`GET /api/search?q=`) and shows a grouped dropdown — **This board** first,
  then **Other boards**. Selecting a result opens that card's modal, switching
  boards first if it lives elsewhere. (Replaces the old in-board filter.)
- **Complete circle** now appears only when hovering the card **text**
  (`card-main`), not the rest of the card; left space is reserved so there's no
  layout jump.
- **Zoom bubble** aligned to the bottom of the screen and made more transparent.
- **Tooltips** (title text) added across buttons.

---

## Update 2026-07-26 (later 3) — card entry + tweaks

- **New-board button** moved to the top bar, next to the search (right side).
- **Inbox footer** now shows the app version (`KanDeck vX.Y.Z`, centered) — the
  version comes from package.json via `GET /api/settings`.
- **Completed date removed** from cards (the green check remains; `completedAt`
  is still stored for the fall-off window).
- **Add a card** now opens the **full card modal** (same as editing) instead of
  a prompt — defaults to **Low** priority; only the **title is required**.

---

## Project layout
```
KanDeck/
├── package.json            # scripts: start, dev (nodemon), backup
├── Dockerfile              # multi-stage, non-root, healthcheck, tini
├── docker-compose.yml      # host bind-mount ./data, env wiring
├── .dockerignore
├── scripts/build-amd64.sh  # buildx cross-build Mac(ARM) → server(AMD64)
├── .env.example            # copy to .env
├── .gitignore
├── BUILD_NOTES.md          # this file
├── data/                   # flat-file store (bind-mounted in Docker)
│   ├── config.json         # hashed password (gitignored; created on setup)
│   ├── boards/             # <id>.json per board + _index.json
│   └── backups/            # kandeck_backup_<stamp>.json
└── src/
    ├── config.js           # env + paths
    ├── util.js             # ids, timestamps, slugify
    ├── events.js           # app-wide event bus (card:moved …)
    ├── auth.js             # bcrypt password, JWT sessions, API-key guard
    ├── server.js           # Express entrypoint (+ schedules services)
    ├── storage/
    │   ├── store.js        # atomic write + per-file async lock
    │   └── boards.js       # board/column/card repository + model
    ├── api/
    │   ├── routes.js       # REST API
    │   └── auth-routes.js  # login / setup / logout
    ├── services/
    │   ├── backup.js       # create/list/restore + cron schedule
    │   └── notify.js       # SMTP + Discord, digest, alarms, webhook-on-move
    └── public/
        ├── index.html      # app shell
        ├── styles.css      # theming (light/dark), responsive, mobile
        ├── palettes.js     # 20 preset palettes
        ├── app.js          # all UI logic
        ├── login.html      # login / first-run setup
        └── vendor/sortable.min.js
```

## Data integrity (spec 2.1)
- Atomic writes: temp file → fsync → `rename` (crash-safe).
- Per-path async mutex serialises concurrent UI + API writes.

## REST API (mounted at `/api`, auth required)
Spec endpoints:
- `GET  /api/boards` — list + summary meta (columns, cardCount)
- `GET  /api/boards/:id` — full schema
- `POST /api/tasks` — create card (`{boardId?, columnId?, subject, priority, dueDate, alarm, tags[]}`)
- `PUT  /api/tasks/:id` — update / move (`toColumnId`,`index`) / clear alarm

Also: board CRUD + reorder, column CRUD + reorder, card create/move/delete,
`GET /boards/:id/archived`, and backups (`GET/POST /backups`, `POST /backups/restore`).

Auth: browser uses a JWT httpOnly cookie; external tools use
`Authorization: Bearer <API_KEY>` (or `X-API-Key`).

### API quick test
```bash
curl -X POST http://localhost:8080/api/tasks \
  -H "Authorization: Bearer $API_KEY" -H "content-type: application/json" \
  -d '{"subject":"Buy milk","priority":"high","alarm":true,"dueDate":"2026-08-01T09:00:00Z"}'
```

## Notifications (spec 2.6) — configure in `.env`
- SMTP email + Discord webhooks. Alarm scan runs every minute; daily digest at
  08:00 (tasks due within the week). Webhook-on-move pings when a card enters a
  board's notify column (default "Done"). All no-ops if channels are blank.

## Backups (spec 2.1)
- Cron schedule via `BACKUP_CRON` (default weekly Sun 03:00), retention via
  `BACKUP_RETENTION`. Manual **Backup now** / **Restore** buttons live in the
  board ⚙️ settings modal. Restore takes a safety backup first.
- Manual CLI: `npm run backup`.

## Deploy to the AMD64 server
```bash
# from your Mac (Apple Silicon) — cross-build for the Intel/AMD server:
IMAGE=kandeck TAG=latest ./scripts/build-amd64.sh          # writes a .tar to load on the server
# or push to a registry:
IMAGE=your-registry/kandeck PUSH=true ./scripts/build-amd64.sh
# on the server:
docker compose up -d      # uses docker-compose.yml, bind-mounts ./data
```

---

## Ideas / polish for later
- Rich-text/Markdown rendering in the card description (currently stored as
  Markdown text; render with a small MD lib when displaying).
- Per-board webhook config UI (currently via env + settings fields).
- Multi-user roles (spec is single-user by design).
- Optimistic drag-and-drop without full board refetch on every move.
