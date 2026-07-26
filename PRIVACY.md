# Privacy Statement

KanDeck is a **self-hosted, single-user** application. You run it on your own
machine or server, and your data belongs to you. This statement describes how
KanDeck handles data so you can make informed decisions about how you deploy it.

## The short version

- KanDeck has **no telemetry, no analytics, and no "phone home."** It never
  sends your data to the project authors or any third party on its own.
- All of your data lives in **plain files on disk** in the app's data directory
  (`data/`) — boards, cards, inbox items, settings, and backups.
- KanDeck only talks to an external service when **you configure it to**, and
  only to the endpoint **you** provide.

## What data KanDeck stores, and where

Everything is stored locally as JSON files under the data directory:

- **Boards, columns, cards, and inbox items** — your task content, including
  titles, descriptions, due dates, priorities, and tags.
- **Application password** — stored only as a bcrypt **hash** in
  `data/config.json`. The plaintext password is never stored.
- **API key** — used to authenticate external apps to the REST API.
- **Settings** — theme, categories, notification and backup configuration.
- **Secrets at rest** — the SMTP password and AI‑chat token are **encrypted**
  before being written to disk (AES‑256‑GCM, keyed by `SECRETS_KEY` /
  `JWT_SECRET`).
- **Backups** — full JSON snapshots of the above in `data/backups/`.

No data is stored anywhere else. There is no external database and no cloud
component.

## When KanDeck contacts an external service

KanDeck makes outbound network requests **only** for features you explicitly
enable and configure, to the destinations you specify:

| Feature | Outbound request | Configured by you |
|---------|------------------|-------------------|
| **AI Chat** | Your browser POSTs your chat messages to the **n8n webhook URL** you enter. From there, your n8n workflow may call an LLM provider (e.g. OpenAI) — that is your workflow's behavior, not KanDeck's. | App Settings → AI Chat |
| **Email notifications** | The server connects to the **SMTP server** you configure to send task summaries / alarms. | App Settings → Notifications |
| **Discord notifications** | The server POSTs task summaries / pings to the **Discord webhook URL** you configure. | App Settings → Notifications |

If you enable none of these, KanDeck makes no outbound requests at all beyond
serving the app to your own browser.

## Authentication and access

- Access requires a password you set on first run (bcrypt‑hashed, JWT
  httpOnly cookie session).
- The REST API additionally accepts an API key you generate.
- If you expose KanDeck to the public internet (e.g. behind a reverse proxy),
  **you** are responsible for securing it — use HTTPS, a strong `JWT_SECRET`,
  and consider restricting access at the network level. See the README's
  security notes.

## Third‑party services

When you use the AI Chat, email, or Discord features, your data is handled by
those third parties (your n8n instance and any LLM it calls, your email
provider, Discord) under **their** privacy policies, not this one. Review and
configure those services according to your own requirements.

## Changes

Because KanDeck is self‑hosted and has no server component operated by the
authors, this statement describes the software's behavior as shipped. Newer
versions may add features that make additional outbound requests; those will
likewise be opt‑in and documented.

## Contact

KanDeck is provided as open‑source software under the MIT License with no
warranty. There is no operator to contact regarding your data — you are the
operator. For questions about the software itself, open an issue on the project
repository.
