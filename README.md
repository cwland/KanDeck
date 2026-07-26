# 🗂️ KanDeck

A flat-file, Trello-style Kanban app — bright, high-contrast, drag-and-drop —
with a REST API for automation (n8n / webhooks), notifications, theming, and a
Docker path to production. **No database**: all state lives in local JSON files.

## Features
- Multi-board **tab** navigation, per-board settings, live clock.
- **Drag-and-drop** cards within/between columns; add/rename/reorder/delete columns.
- Cards with subject, Markdown description, due date/time, **alarm**, priority,
  color tags, archive.
- **Auto-sort** columns by priority or due date.
- **Themes:** system/light/dark + **20 vibrant palettes**, all WCAG 2.1 AA
  (text contrast is computed per color, so every pairing stays legible).
- Persistent per-board **zoom**. Mobile-responsive columns.
- **Search** bar to filter cards by title, description, or tag.
- **Auth:** single-user password login (bcrypt-hashed), JWT cookie sessions.
- **REST API** with Bearer-token auth for external tools.
- **Notifications:** SMTP email + Discord webhooks — alarms, daily digest,
  webhook-on-card-move.
- **AI Chat:** an optional floating chat bubble that talks to an n8n Chat
  Webhook. Enable it in App Settings → AI Chat. A ready-to-import n8n workflow
  ships at [`templates/n8n/kandeck-chat-sample.json`](templates/n8n/kandeck-chat-sample.json);
  full setup, security, and the webhook contract are in
  [`docs/AI-CHAT-SETUP.md`](docs/AI-CHAT-SETUP.md).
- **Backups:** scheduled (cron) + manual create/restore from the UI.

## Quick start
```bash
npm install
cp .env.example .env      # then edit JWT_SECRET / API_KEY / notification creds
npm run dev               # http://localhost:8080
```
On first visit you'll set the application password.

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
