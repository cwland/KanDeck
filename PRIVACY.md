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
- **Passkeys** (optional) — only each passkey's **public** key, ID, name,
  hostname and usage counter are kept in `data/config.json`. The private key
  never leaves your password manager or device.
- **OAuth sign-in** (optional) — your identity provider's settings (the client
  secret **encrypted**), plus the linked account's subject ID and email. KanDeck
  talks only to the provider you configure, and only while you sign in.
- **Sessions** — for each signed-in browser: a random session ID, its IP
  address, browser/OS (user-agent), how it signed in, and when it signed in and
  was last active, so you can review and sign out sessions (App Settings →
  Account). Entries are removed when you sign out, when they expire, or with
  **Sign out everywhere** / a password change.
- **API key** — used to authenticate external apps to the REST API.
- **Settings** — theme, categories, notification and backup configuration.
- **Secrets at rest** — the SMTP password is **encrypted**
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
| **Email notifications** | The server connects to the **SMTP server** you configure to send task summaries. | App Settings → Notifications |
| **Discord notifications** | The server POSTs task summaries / pings to the **Discord webhook URL** you configure. | App Settings → Notifications |
| **Text messages** | The server POSTs alarm reminders and/or task summaries (card titles, board names, due dates) to the **iMessage Gateway URL** you configure, which sends them through Apple's Messages service on your Mac. | App Settings → Notifications → Text |

If you enable none of these, KanDeck makes no outbound requests at all beyond
serving the app to your own browser.

## Authentication and access

- Access requires a username and password you set on first run (password
  bcrypt‑hashed; revocable JWT httpOnly cookie session), or optionally a
  passkey you add under App Settings → Account, or OAuth / OpenID Connect
  through an identity provider you configure (App Settings → Sign-in).
- The REST API additionally accepts an API key you generate.
- **Calendar feeds** (optional, per board and one app-wide, all off by
  default) are the one exception to login: calendar apps can't sign in, so
  anyone holding a feed link can read the card titles, due dates, lane,
  category and tags it covers — for the app-wide feed that's every active board
  and, if enabled, your Inbox — plus descriptions and done tasks if you enable
  those options. Share
  the link only with calendars you trust; turning the feed off or generating a
  new link revokes the old one immediately. Feeds are inbound only — KanDeck
  sends nothing to calendar providers; they fetch the feed from you.
- If you expose KanDeck to the public internet (e.g. behind a reverse proxy),
  **you** are responsible for securing it — use HTTPS, a strong `JWT_SECRET`,
  and consider restricting access at the network level. See the README's
  security notes.

## Third‑party services

When you use the email or Discord features, your data is handled by those
third parties (your email provider, Discord) under **their** privacy policies,
not this one. Review and
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
