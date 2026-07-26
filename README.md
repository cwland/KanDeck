# 🗂️ KanDeck

A dead-simple, **self-hosted, single-user** Kanban board — no accounts, no cloud,
no clutter. All of your data lives in plain JSON files on your own machine.

KanDeck started as a search for a genuinely simple kanban board that I could
self-host and actually own. It's a single-user app: you set one password and
your boards are yours. Beyond the board itself it can plug an **AI chat
assistant** into your workflow via [n8n](https://n8n.io), and it exposes a
**REST API** so other apps and automations can create and review the tasks on
your board.

![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Self-hosted](https://img.shields.io/badge/self--hosted-single--user-blue)
![No database](https://img.shields.io/badge/storage-flat--file%20JSON-orange)

![KanDeck board](docs/img/board-light.png)

---

## Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Quick start (local)](#quick-start-local)
- [Docker](#docker)
- [Configuration & secrets](#configuration--secrets)
- [Reset a forgotten password](#reset-a-forgotten-password)
- [Using KanDeck](#using-kandeck)
- [REST API](#rest-api)
- [AI Chat (n8n)](#ai-chat-n8n)
- [Notifications](#notifications)
- [Backups](#backups)
- [Building the Docker image (CI)](#building-the-docker-image-ci)
- [Privacy & License](#privacy--license)

---

## Features

- **Boards, columns, cards** with drag-and-drop (within and between columns);
  add / rename / reorder / delete columns per board.
- **Cards** with subject, Markdown description, due date, priority, tags, a
  per-board **complete** lane, and archive.
- **App-level categories** (priorities) with editable, high-contrast colors that
  apply across every board.
- **Inbox** — a capture area fed by the REST API / webhooks. Drag items onto a
  board, or use each card's **⋮ "send to board"** menu.
- **Search-as-you-type** across all boards; jumps straight to the card.
- **Themes** — 20 presets (10 light + 10 dark) with a vertical gradient wash;
  category and badge colors are user-editable with automatically-readable text.
- **AI Chat** — an optional floating chat bubble backed by an n8n workflow, so
  you can ask "what's due today?" or "add buy dog food due Friday."
- **REST API** with a date-filtered task-query endpoint built for assistants.
- **Notifications** — scheduled email + Discord task summaries plus card-moved
  Discord pings.
- **Backups** — manual and automatic (daily / weekly / monthly with retention);
  a full snapshot of boards **and** settings, with one-click restore.
- **Security** — single password (bcrypt), JWT cookie sessions, login
  rate-limiting, API-key auth, and secrets encrypted at rest.
- **No database.** Everything is flat-file JSON. Runs offline. Mobile-responsive.

---

## Screenshots

A board with the inbox open — priority categories, due dates, tags, and a
complete lane with check-off:

![Board — light theme](docs/img/board-light.png)

The same board in a dark theme (light and dark presets share an accent, so the
🌓 button flips between them):

![Board — dark theme](docs/img/board-dark.png)

<table>
  <tr>
    <td width="50%"><img src="docs/img/card-modal.png" alt="Card detail modal"><br><sub>Card details — description (Markdown), category, due date, and tags.</sub></td>
    <td width="50%"><img src="docs/img/themes.png" alt="Theme picker"><br><sub>App Settings — 20 theme presets plus Categories, Lane colors, AI Chat, Notifications, API, and Backups.</sub></td>
  </tr>
</table>

---

## Quick start (local)

Requires **Node.js ≥ 18**.

```bash
git clone https://github.com/cwland/KanDeck.git
cd KanDeck
npm install
cp .env.example .env          # then edit — at minimum set a strong JWT_SECRET
npm run dev                   # http://localhost:8080  (auto-reload via nodemon)
```

On first visit you'll be asked to **create the application password**. That's it —
there's no signup, no external service.

For a plain (non-reloading) run: `npm start`.

---

## Docker

The published image is multi-arch (amd64 + arm64). Use it directly, or build
from source.

### docker-compose (recommended)

Create a `.env` next to your `docker-compose.yml` with your secrets (see
[Configuration](#configuration--secrets)), then:

```yaml
services:
  kandeck:
    image: ghcr.io/cwland/kandeck:latest   # or: build: .
    container_name: kandeck
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      NODE_ENV: production
      PORT: "8080"
      DATA_DIR: /app/data
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}   # required, >= 32 chars
      SECRETS_KEY: ${SECRETS_KEY:-}                        # recommended
      SESSION_TTL: ${SESSION_TTL:-7d}
      API_KEY: ${API_KEY:-}                               # optional; you can also make one in the UI
    volumes:
      - ./data:/app/data                                  # your data lives here
```

```bash
docker compose up -d
```

> Email/Discord notifications, backup schedule, and the API key are configured
> **in the app** (App Settings), not via environment variables.

Your boards, settings, and backups persist in the bind-mounted `./data` directory
and survive container rebuilds.

### Behind a reverse proxy

KanDeck speaks plain HTTP; terminate TLS at a reverse proxy (Caddy, Nginx Proxy
Manager, Traefik, …). Use a **trusted certificate** — the AI chat widget calls
your n8n webhook directly from the browser and a self-signed cert will block it.

---

## Configuration & secrets

All configuration is via environment variables (or a `.env` file). The full list
is in [`.env.example`](.env.example). The ones that matter:

| Variable | Required | Purpose |
|----------|----------|---------|
| `JWT_SECRET` | **Yes (production)** | Signs session cookies. The server **refuses to start** in production if this is unset, the default, or shorter than 32 characters. Generate with `openssl rand -base64 32`. |
| `SECRETS_KEY` | Recommended | Encrypts secrets at rest (SMTP password, AI token). Decoupled from `JWT_SECRET` so you can rotate the session secret independently. If blank, `JWT_SECRET` is used. Generate with `openssl rand -base64 32`. |
| `API_KEY` | Optional | A static API key for external tools. You can also generate/rotate one in **App Settings → API**. |
| `DATA_DIR` | Optional | Where the JSON store lives (default `./data`). |
| `SESSION_TTL` | Optional | Session lifetime (default `7d`). |
| `BACKUP_CRON`, `BACKUP_RETENTION` | Optional | Pre-UI fallbacks; the real schedule/retention are set in **App Settings → Backups**. |

Keep your `.env` **out of source control** (it's already gitignored).

---

## Reset a forgotten password

KanDeck is single-user and offline, so there's no email-based "forgot password"
flow — but because you host it yourself, resetting takes one command. The
password is only ever stored as a **bcrypt hash** in `config.json`, so this
doesn't recover the old password; it clears or replaces it. Your boards,
settings, and backups are left untouched.

**Local / bare-metal:**

```bash
npm run reset-password                  # clears it → the app asks you to set a new one on next load
npm run reset-password -- "new-pass"    # …or set a new password directly (min 6 chars)
```

**Docker** — run it inside the running container:

```bash
docker compose exec kandeck npm run reset-password
# or set one directly:
docker compose exec kandeck npm run reset-password -- "new-pass"
```

(Not using compose? `docker exec -it kandeck npm run reset-password`.)

**If the container won't start** (so you can't exec into it), edit the file
directly on the host — it lives in your bind-mounted data dir at
`./data/config.json`. Set `"passwordHash": null` (or delete the file) and
reload; the app returns to the first-run "create password" screen.

> Passing a password as an argument leaves it in your shell history. The
> no-argument form (clear, then set a new one in the UI) avoids that.

---

## Using KanDeck

- **Switch boards** from the bottom bar → *Switch board*. Create a new board with
  the **＋** next to the search.
- **App Settings** (⚙️, top-right) is tabbed: Theme, Categories, Lane colors,
  AI Chat, Notifications, API, Backups. A single **Save** applies everything
  (the API tab acts immediately).
- **Board Settings** (⚙️, board area) manages that board's lanes, the complete
  lane, card display fields, and per-board options.
- **Inbox**: items arriving via the API land here for triage — drag them onto a
  board or use the card's **⋮** menu to send it to a board's first column.

---

## REST API

All endpoints are under `/api` and require auth: either an active browser session
or an API key sent as `Authorization: Bearer <key>` or `X-API-Key: <key>`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/boards` | List boards + summary meta |
| `GET` | `/api/boards/:id` | Full board (columns + cards) |
| `POST` | `/api/tasks` | Create a task (no `boardId` → Inbox; with `boardId` → that board) |
| `PUT` | `/api/tasks/:id` | Update or move a task |
| `GET` | `/api/tasks/query` | **Date-filtered task query** (see below) |
| `GET` | `/api/search?q=` | Search cards across all boards |
| `GET` | `/api/inbox` · `POST` `/api/inbox` · `POST` `/api/inbox/:id/move` | Inbox |

### Create a task

```bash
curl -X POST https://kandeck.example.com/api/tasks \
  -H "X-API-Key: $KANDECK_API_KEY" -H "content-type: application/json" \
  -d '{"subject":"Buy milk","priority":"high","dueDate":"2026-08-01"}'
```

### Query tasks (built for assistants)

`GET /api/tasks/query` returns a flat, **date-filtered** list of cards across all
boards, with the date math done server-side:

| Param | Values |
|-------|--------|
| `due` | `today` · `tomorrow` · `week` (next 7 days) · `overdue` · `none` · `any` |
| `status` | `open` · `complete` · `all` (defaults to `open`, or `complete` when `completedWithin` is set) |
| `completedWithin` | integer N — completed within the last N days |
| `board` · `priority` · `q` · `limit` | optional filters |

```bash
curl "https://kandeck.example.com/api/tasks/query?due=today" -H "X-API-Key: $KANDECK_API_KEY"
curl "https://kandeck.example.com/api/tasks/query?status=complete&completedWithin=7" -H "X-API-Key: $KANDECK_API_KEY"
```

Each task carries `boardName`, `columnName`, `subject`, `dueDate`, `dueInDays`,
`overdue`, `priority`/`priorityName`, `complete`, `completedDaysAgo`, plus a
top-level `summary` and `today`.

---

## AI Chat (n8n)

KanDeck ships an optional floating chat widget that talks to an
[n8n](https://n8n.io) workflow — enable it in **App Settings → AI Chat**. Give the
n8n agent KanDeck's API and it can answer real questions about your board and even
add tasks:

> *"What's due today?"* · *"Anything overdue?"* · *"What did I finish this week?"*
> · *"Add buy dog food due Friday."*

A ready-to-import workflow is at
[`templates/n8n/kandeck-chat-sample.json`](templates/n8n/kandeck-chat-sample.json)
— it includes the webhook + auth gate, the AI agent, **both** KanDeck task tools
(read + create), and the system prompt that makes the agent map questions to the
right query. Full walkthrough (security, the two tokens, the recommended prompt)
is in **[`docs/AI-CHAT-SETUP.md`](docs/AI-CHAT-SETUP.md)**.

The chat widget stores its conversation locally in your browser; only your typed
messages are sent to the webhook URL you configure.

---

## Notifications

Configured in **App Settings → Notifications** (no env vars):

- **Scheduled summaries** — an email and/or Discord digest of your tasks
  (upcoming N days · due today · past due) on a time + weekday schedule you pick.
- **Card-moved** Discord pings when a card lands in a board's notify lane.

Email uses SMTP you provide (the password is encrypted at rest); Discord uses a
webhook URL. Each has a **Test** button that validates the connection before you
rely on it.

---

## Backups

In **App Settings → Backups**:

- **Backup now** / **Restore** at any time.
- **Automatic backups** — daily / weekly / monthly, with a "keep last N" retention.
- Each backup is a full snapshot of **boards *and* settings** (secrets stay
  encrypted). Restore takes a safety backup first, and older backups are pruned to
  your retention count. Backups are labeled Automated vs Manual in the list.

CLI: `npm run backup` makes a one-off snapshot.

---

## Building the Docker image (CI)

A GitHub Actions workflow
([`.github/workflows/docker-build.yml`](.github/workflows/docker-build.yml))
builds a **multi-arch image (linux/amd64 + linux/arm64)** and publishes it to the
GitHub Container Registry on every push to `main` and on version tags:

- `ghcr.io/<owner>/kandeck:latest` — default branch
- `ghcr.io/<owner>/kandeck:vX.Y.Z` and `:X.Y` — when you push a `vX.Y.Z` tag
- `ghcr.io/<owner>/kandeck:sha-<commit>` — always

It authenticates with the built-in `GITHUB_TOKEN` (no secrets to configure).
After the first run, set the package to **Public** in your repo's Packages
settings if you want anyone to pull it. To cut a release:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

To cross-build locally from an Apple-Silicon Mac for an Intel/AMD server without
CI, use [`scripts/build-amd64.sh`](scripts/build-amd64.sh).

---

## Privacy & License

- **Privacy:** KanDeck has no telemetry and never phones home; your data stays in
  local files and it only contacts services **you** configure (n8n / SMTP /
  Discord). See [`PRIVACY.md`](PRIVACY.md).
- **License:** [MIT](LICENSE) — do essentially anything you want with it.

Contributions and forks welcome. KanDeck is single-user by design.
