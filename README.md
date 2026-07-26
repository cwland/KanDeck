# 🗂️ KanDeck

A flat-file, Trello-style Kanban app — bright, high-contrast, drag-and-drop —
with a REST API for automation (n8n / webhooks), notifications, theming, and a
Docker path to production. **No database**: all state lives in local JSON files.

## Features
- Multi-board navigation (switch-board popup), per-board settings.
- **Drag-and-drop** cards within/between columns; add/rename/reorder/delete columns.
- Cards with subject, Markdown description, due date, **alarm**, priority
  (app-level categories with editable colors), tags, complete lane, archive.
- **Inbox** for incoming items (REST/webhook) → drag onto a board, or use each
  card's **⋮ "send to board"** menu.
- **Auto-sort** columns by priority or due date.
- **Themes:** 20 presets (10 light + 10 dark) with a Trello-style gradient;
  category/badge colors are user-editable with computed-contrast text.
- Persistent per-board **zoom**. Mobile-responsive.
- **Search-as-you-type** across all boards.
- **Auth:** single-user password login (bcrypt), JWT cookie sessions, login
  rate-limiting.
- **REST API** with API-key auth (managed in App Settings → API), incl. a
  date-filtered task-query endpoint for assistants.
- **Notifications:** scheduled email + Discord task summaries (upcoming / due
  today / past due, with a weekly schedule), plus per-card alarms and
  card-moved pings — all configured in App Settings → Notifications. Secrets
  (SMTP password) are encrypted at rest.
- **AI Chat:** an optional floating chat bubble that talks to an n8n Chat
  Webhook. Enable it in App Settings → AI Chat. A ready-to-import n8n workflow
  ships at [`templates/n8n/kandeck-chat-sample.json`](templates/n8n/kandeck-chat-sample.json);
  full setup in [`docs/AI-CHAT-SETUP.md`](docs/AI-CHAT-SETUP.md).
- **Backups:** manual + automatic (daily/weekly/monthly, with retention), full
  snapshot of boards **and settings**; create/restore in App Settings → Backups.

## Quick start
```bash
npm install
cp .env.example .env      # set a strong JWT_SECRET (and SECRETS_KEY); see below
npm run dev               # http://localhost:8080
```
On first visit you'll set the application password. Email/Discord notifications,
backup schedule, and the API key are all configured in the app — not via env.

### Secrets
- `JWT_SECRET` — signs session cookies. **Required in production** (the server
  refuses to start with a default/short value). Generate: `openssl rand -base64 32`.
- `SECRETS_KEY` — encrypts secrets at rest (SMTP password, AI token). Optional
  but recommended; decoupled from `JWT_SECRET`. Keep both in a gitignored `.env`.

## Docker
```bash
docker compose up -d      # bind-mounts ./data on the host
```
Cross-build for an Intel/AMD server from an Apple-Silicon Mac:
```bash
./scripts/build-amd64.sh
```

## REST API
`Authorization: Bearer <API_KEY>` (or an active browser session).

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET  | `/api/boards` | list boards + summary meta |
| GET  | `/api/boards/:id` | full board schema |
| POST | `/api/tasks` | create a card |
| PUT  | `/api/tasks/:id` | update / move / clear alarm |

See `BUILD_NOTES.md` for the full endpoint list and architecture notes.

## License
MIT
