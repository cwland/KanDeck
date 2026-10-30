# 🗂️ KanDeck

A dead-simple, **self-hosted, single-user** Kanban board — no accounts, no cloud,
no clutter. All of your data lives in plain JSON files on your own machine.

KanDeck started as a search for a genuinely simple kanban board that I could
self-host and actually own. It's a single-user app: you create one login and
your boards are yours. It exposes a **REST API** so other apps and automations
(scripts, [n8n](https://n8n.io), …) can create and review the tasks on your
board.

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
- [Exposing KanDeck publicly](#exposing-kandeck-publicly)
- [Reset a forgotten login](#reset-a-forgotten-login)
- [Sign-in: passwords, passkeys & OAuth](#sign-in-passwords-passkeys--oauth)
- [Using KanDeck](#using-kandeck)
- [Done lane & completed dates](#done-lane--completed-dates)
- [Archiving boards](#archiving-boards)
- [Routing tags](#routing-tags)
- [Calendar feed (.ics)](#calendar-feed-ics)
- [REST API](#rest-api)
- [Notifications](#notifications)
- [Backups](#backups)
- [Building the Docker image (CI)](#building-the-docker-image-ci)
- [Privacy & License](#privacy--license)

---

## Features

- **Boards, columns, cards** with drag-and-drop (within and between columns);
  add / rename / reorder / delete columns per board.
- **Cards** with subject, Markdown description, due date, an optional
  **alarm** (reminder date-time), priority, tags, and archive. The **last lane is always the done lane** — cards get a completed
  date when they land there, and can auto-archive after N days.
- **Archive boards** instead of deleting them; restore or permanently delete
  from **App Settings → Archives**.
- **Calendar feeds** — read-only `.ics` subscription links per board, plus one
  app-wide feed covering every board and the Inbox (dated cards as events,
  undated cards as to-dos).
- **What's new** — after an update, a window shows the new version's changes
  and the 10 releases before it; click the version number to reopen it.
- **App-level categories** (priorities) with editable, high-contrast colors that
  apply across every board.
- **Clean, card-based layout** — an icon rail on the left, board tabs across
  the top, lanes as white cards with each task on its own tile, and rounded
  pills for category, tags, alarm, email and link. A **List** view stacks the
  lanes with every card's details written out.
- **Inbox + Summary side panel** — the Inbox (fed by the REST API / webhooks)
  sits in a panel on the right: drag items onto a lane or use **+ Board**. The
  **Summary** tab shows open cards per lane, what's due this week and your
  other boards.
- **Routing tags** — give a board tags (e.g. `home`, `work`) and tasks pushed
  to KanDeck with a matching tag skip the Inbox and land in that board's first
  lane.
- **Search-as-you-type** across all boards; jumps straight to the card.
- **Themes** — 22 presets (11 light + 11 dark, Navy is the default) in the
  Figtree typeface; category and badge colors are user-editable with
  automatically-readable text.
- **REST API** with a date-filtered task-query endpoint for automations.
- **Notifications** — scheduled email, Discord and text-message task summaries,
  **alarm reminders by text** (iMessage/SMS via the iMessage Gateway Mac app),
  and card-moved Discord pings.
- **Backups** — manual and automatic (daily / weekly / monthly with retention);
  a full snapshot of boards, the Inbox **and** settings, with one-click restore.
- **Passkeys** — sign in with 1Password, iCloud Keychain or a security key;
  the password manager offers it as soon as you click into the login form.
- **OAuth / OpenID Connect** — "Sign in with Authentik" (or Google, Keycloak …),
  with a choice of sign-in modes (e.g. OAuth only, passkeys only) and an
  emergency `npm run auth:reset` if you ever lock yourself out.
- **Security** — single username + password login (bcrypt), revocable JWT
  cookie sessions, spoof-proof login rate-limiting, a locked first-run setup,
  security headers (CSP, anti-framing, HSTS), API-key auth, and secrets
  encrypted at rest.
- **No database.** Everything is flat-file JSON. Runs offline. Mobile-responsive.

---

## Screenshots

A board with the Inbox panel open: categories, due dates, alarm/email/link
pills, and the done lane with check-off:

![Board — light theme](docs/img/board-light.png)

The **List** view in a dark theme (Navy dark), with each card's reminder,
email/link and tags written out:

![Board — dark theme](docs/img/board-dark.png)

<table>
  <tr>
    <td width="50%"><img src="docs/img/card-modal.png" alt="Card details panel"><br><sub>Card details open in a side panel: description (Markdown), email/link, board, category, due date, alarm and tags.</sub></td>
    <td width="50%"><img src="docs/img/themes.png" alt="App Settings page"><br><sub>App Settings is a full page: Theme (22 presets), Account, Sign-in, Board settings, Notifications, API, Calendar, Backups and Archives.</sub></td>
  </tr>
</table>

---

## Quick start (local)

Requires **Node.js ≥ 20**.

```bash
git clone https://github.com/cwland/KanDeck.git
cd KanDeck
npm install
cp .env.example .env          # then edit — at minimum set a strong JWT_SECRET
npm run dev                   # http://localhost:8080  (auto-reload via nodemon)
```

On first visit you'll be asked to **create your login** (username + password, min
12 characters). That's it —
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
Manager, Traefik, Cloudflare Tunnel, …). Use a **trusted certificate** so browsers
and calendar apps (which refuse self-signed certs for subscriptions) can connect,
and set **`TRUST_PROXY=1`** so login rate-limiting sees real client IPs. See
[Exposing KanDeck publicly](#exposing-kandeck-publicly).

---

## Configuration & secrets

All configuration is via environment variables (or a `.env` file). The full list
is in [`.env.example`](.env.example). The ones that matter:

| Variable | Required | Purpose |
|----------|----------|---------|
| `JWT_SECRET` | **Yes (production)** | Signs session cookies. The server **refuses to start** in production if this is unset, the default, or shorter than 32 characters. Generate with `openssl rand -base64 32`. |
| `SECRETS_KEY` | Recommended | Encrypts secrets at rest (the SMTP password). Decoupled from `JWT_SECRET` so you can rotate the session secret independently. If blank, `JWT_SECRET` is used. Generate with `openssl rand -base64 32`. |
| `TRUST_PROXY` | **Yes, behind a proxy** | Set to `1` when KanDeck sits behind one reverse proxy / tunnel, so the real client IP is used for login rate-limiting and HTTPS is detected for HSTS. Leave unset when exposed directly (then `X-Forwarded-For` is ignored and can't be spoofed). Also accepts Express values like `loopback`. |
| `SETUP_TOKEN` | Optional | A one-time secret required to create the first login. Without it, first-run setup only works from a direct local-network request — so a stranger can't claim a fresh install on a public IP. |
| `API_KEY` | Optional | A static API key for external tools. You can also generate/rotate one in **App Settings → API**. |
| `APP_URL` | Recommended behind a proxy | Public base URL (e.g. `https://kandeck.example.com`). Used for links in notifications and for calendar-feed URLs. If blank, feed URLs use whatever address you opened KanDeck on. |
| `DATA_DIR` | Optional | Where the JSON store lives (default `./data`). |
| `SESSION_TTL` | Optional | Session lifetime (default `7d`). |
| `BACKUP_CRON`, `BACKUP_RETENTION` | Optional | Pre-UI fallbacks; the real schedule/retention are set in **App Settings → Backups**. |

Keep your `.env` **out of source control** (it's already gitignored).

---

## Exposing KanDeck publicly

KanDeck is built to be safe to put on the internet (for example so calendar
apps can reach your `.ics` feeds), but check these first:

1. **HTTPS only** — put it behind a reverse proxy or Cloudflare Tunnel with a
   trusted certificate. Never publish plain HTTP on port 8080.
2. **`TRUST_PROXY=1`** behind that proxy, so the login throttle (10 failures per
   IP, 100 overall, per 15 minutes) uses real client IPs.
3. **Strong secrets** — a long random `JWT_SECRET` (the server refuses weak ones
   in production) and a password of at least 12 characters.
4. **Calendar feeds** are the only thing reachable without logging in, and each
   is protected by its own secret link — rotate one if it leaks.
5. **Optional extra layer:** with Cloudflare, put **Cloudflare Access** in front
   of the app and add a *bypass* rule for `/ics/*` (so calendars can fetch
   feeds) and a service token for `/api/*` (n8n / scripts). Add a rate-limit
   rule for `/api/auth/login`, `/api/auth/passkey/*` and `/api/auth/oauth/*` too.
   If Cloudflare Access is your identity provider, you can also point KanDeck's
   OAuth at it and use **OAuth only**.

What KanDeck does on its own: bcrypt-hashed password, optional passkeys
(WebAuthn, bound to each hostname, same login throttle), `httpOnly` + `SameSite`
session cookies that can be revoked one by one (**Account → Show sessions**), password
change), a first-run setup that strangers can't claim (local network or
`SETUP_TOKEN` only), security headers on every response (CSP, `X-Frame-Options`,
`nosniff`, `no-referrer`, and HSTS — sent only over HTTPS for the hostname in
`APP_URL`, so internal/LAN proxy names are never pinned), and no `X-Powered-By`.

---

## Reset a forgotten login

KanDeck is single-user and offline, so there's no email-based "forgot password"
flow — but because you host it yourself, resetting takes one command. The
password is only ever stored as a **bcrypt hash** in `config.json`, so this sets
a new one rather than recovering the old one. Your boards, settings, backups and
API key are left untouched, and every existing session is signed out.

**Docker** — run it inside the running container:

```bash
docker compose exec kandeck npm run reset-password -- <username> <new-password>
```

**Local / bare-metal:**

```bash
npm run reset-password -- <username> <new-password>
```

Running it with **no arguments** clears the login instead; the app then shows
first-run setup, which only works from your local network (or with
`SETUP_TOKEN`).

**If the container won't start** (so you can't exec into it), edit
`./data/config.json` on the host: set `"passwordHash": null` and
`"username": null`, then create a new login from your local network.

> Passing a password as an argument leaves it in your shell history; clear it
> afterwards (e.g. `history -d`) if that matters to you.

**Locked out by OAuth or passkeys** (password sign-in turned off and your
identity provider is down, or a passkey stopped working)? See the
[emergency reset](#emergency-reset-lockout).

---

## Sign-in: passwords, passkeys & OAuth

KanDeck has one account, and you can sign in to it three ways: **password**,
**passkey** (WebAuthn / FIDO2: 1Password, Touch ID / Face ID, YubiKey …) and
**OAuth / OpenID Connect** (Authentik, Authelia, Keycloak, Google, Microsoft …).
**App Settings → Sign-in** picks which ones the sign-in page offers:

| Mode | Password | Passkeys | OAuth |
|------|:---:|:---:|:---:|
| Password, passkeys and OAuth (`ALL_ENABLED`, default) | ✓ | ✓ | ✓ |
| Password and OAuth (`PASSWORDS_AND_OAUTH`) | ✓ | – | ✓ |
| Passkeys and OAuth (`PASSKEYS_AND_OAUTH`) | – | ✓ | ✓ |
| Passkeys only (`PASSKEYS_ONLY`) | – | ✓ | – |
| OAuth only (`OAUTH_ONLY`) | – | – | ✓ |

Each method has its own slider on the Sign-in tab, and its settings only show
while the slider is on. Passkeys also need at least one passkey for that
address; OAuth also needs its slider on and the provider filled in. Methods that are off
are hidden on the sign-in page **and** refused by the server. KanDeck refuses
to save a mode that leaves you no proven way in (e.g. *OAuth only* before
you've linked your account, or *Passkeys only* with no passkeys).

### Setting up OAuth (example: Authentik)

1. In Authentik create an **OAuth2/OpenID Provider** + Application (confidential
   client). Turn on the **OAuth / OpenID Connect** slider on KanDeck's Sign-in
   tab and copy the **callback (redirect) URL** shown there into it
   (`https://<your-kandeck>/api/auth/oauth/callback`). Add one per address you
   use KanDeck on.
2. In KanDeck → **Sign-in**: enter the **Issuer URL** (Authentik: the
   provider's "OpenID Configuration Issuer", e.g.
   `https://auth.example.com/application/o/kandeck/`), **Client ID**, **Client
   secret**, and a **Button label** (`Authentik`). Click **Check provider**.
3. Click **Link my account** and sign in at the provider. Only that provider
   account (its subject ID) can now sign in to KanDeck. Optionally list
   **Allowed emails** too; they work only when the provider marks the email
   as verified.
4. Pick a mode and click **Save sign-in settings**.

Providers without a discovery document (plain OAuth2) can be set up under
**Advanced** with explicit authorization, token, userinfo and JWKS URLs. The flow
uses the authorization-code grant with PKCE, a `state` bound to the browser
and a `nonce`, and verifies the ID token's signature, issuer, audience and
expiry. The client secret is encrypted at rest.

**Passkeys** have no settings: with the **Passkeys** slider on, the Sign-in tab
lists your passkeys and has an **＋ Add a passkey** button. A passkey belongs to
the address you add it from (`localhost` or the current hostname).

### Emergency reset (lockout)

If your identity provider is down or a passkey breaks while password sign-in is
off, turn passwords back on from the server. It takes effect immediately (no
restart):

```bash
docker compose exec kandeck npm run auth:reset
# or, to also switch OAuth and passkeys off:
docker compose exec kandeck npm run auth:reset -- --disable-oauth-passkeys
```

Locally: `npm run auth:reset`. It prints the old and new mode. If the container
won't stay up, set `AUTH_RESET=1` in its environment (or start with
`node src/server.js --disable-oauth-passkeys`) for one start, then remove it.
Forgot the password as well? Follow it with `npm run reset-password -- <username> <password>`.

### Where it's stored

Everything lives in `data/config.json`: the account (`username`,
`passwordHash`), `passkeys` (credential ID, public key, counter, transports,
hostname, name, dates) and `auth`: `mode` (*auth_mode*), `passkeysEnabled`,
and `oauth` (`enabled`, `providerName`, `issuer`, `clientId`,
encrypted `clientSecret`, `scopes`, endpoints, `allowedEmails`, and the linked
subject and email).

---

## Using KanDeck

- **Find your way around** with the icon rail on the left: **Boards**,
  **Inbox** (with its item count), **New board**, **Archives**,
  **App settings**, your initials, the version (opens What's new) and
  **Log out**. On a phone the rail becomes a bar along the bottom.
- **Header**: the board name sits centered at the top with the board tabs
  centered under it — `Home 1 | Work 5 | …`. The number is each board's open
  cards (not done, not archived) and updates live, even when tasks arrive from
  n8n or the API. Many boards? The tab row scrolls (its edges fade). Hover the
  board name to see its description.
- **Search**: the 🔍 at the top right (or press **/**) opens a search box
  across all boards; Esc closes it.
- **Board / List** (left end of the summary line under the tabs): flips between lanes side by side and a list
  with the lanes stacked, one row per card with its reminder, tags and an ✉️ /
  🔗 icon for its email or link (hover for the address), plus Category and Due
  columns. Remembered per board. **Sort** (Manual, Priority, Due date) is at
  the right end of the same line.
- The line under the header sums up the board: overdue · due this week · open.
- **Archive or delete a card** with the small **✕** in its top-right corner
  (Delete needs a second click to confirm).
- **Move a card to another board** from its window: pick the **Board** and
  Save — it lands in that board's first lane with everything kept.
- **Email** on a card holds an address (opens your mail app) or a link such as
  the original Gmail message (opens in a new tab). Click it to open, ✏️ to edit;
  cards show a small clickable ✉️ (address) or 🔗 (link) too.
- **App Settings** (⚙️ in the rail) opens as a full page with a section menu down the left:
  Account, Sign-in, Board settings, Theme, Notifications, API, Calendar,
  Backups, Archives. **Board settings** holds the global categories, badge
  colors and lane-color palette used by every board. Board settings, Theme,
  Notifications and Backups are saved with the page's **Save**; Account,
  Sign-in, API, Calendar and Archives act immediately (the footer then shows
  just **Close**).
- **Account** (App Settings):
  - **Username** — change it any time (no password needed).
  - **Password** — needs your current password; signs out every other browser.
    The **(i)** next to it shows how to reset a forgotten password on the
    server (`docker compose exec kandeck npm run reset-password -- <user> <pass>`).
  - **Sessions → Show sessions** lists every signed-in browser — browser and
    OS, IP address, how it signed in (password, passkey or OAuth), when, and
    when it was last active. **Sign out** any one of them, **Sign out all
    others**, or **Sign out everywhere**. A signed-out browser is refused on
    its next click.
- **New board** (＋ in the rail) opens a small centered window: name, optional
  description, **Create board**. It starts with To Do · In Progress · Done.
- **Board Settings** (the sliders icon at the top right) slides in from the right and has tabs: **General** (name, description,
  what shows on cards), **Lanes** (lanes + auto-archive), **Routing** (routing
  tags), **Calendar** (the board's feed) and **Archived** (archived cards). The
  footer has **Archive board**.
- **Passkeys**: in **App Settings → Sign-in**, turn on the **Passkeys** slider
  and click **＋ Add a passkey**; 1Password (or your browser) saves it. Rename
  or remove passkeys in the same list.
  From then on the sign-in page asks your password manager for the passkey as
  soon as you click into the username box — no button needed — and also shows
  a **🔑 Sign in with passkey** button. The button only appears once a passkey
  exists for that address. A passkey is tied to the hostname it was made on, so
  add one on each address you use (e.g. `kandeck.lan` *and*
  `kandeck.example.com`). Passkeys need HTTPS (or `localhost`). Clearing the
  login with `npm run reset-password` (no arguments) also removes all passkeys.
- **Sign-in** (App Settings) chooses which sign-in methods are offered and sets
  up OAuth — see [Sign-in: passwords, passkeys & OAuth](#sign-in-passwords-passkeys--oauth).
- **Inbox**: open or close the right-hand panel with one click — either the
  Inbox button in the rail or the tab on the right edge of the board (both
  show how many items are waiting). On narrower laptop screens the panel
  slides over the board instead of squeezing it. Items arriving via the API land
  here for triage: drag them onto a lane, or click **+ Board** to send one to a
  board's first lane. The panel's **Summary** tab shows open cards per lane,
  what's due in the next 7 days and your other boards.
- **Cards** open in a side panel on the right, so the board stays in view.
- **Secret fields** (API key, OAuth client secret, SMTP password, Discord
  webhook, text-gateway key) are hidden; click the 👁 eye to show or hide one.
- **Accessibility**: every icon button has hover text and a screen-reader
  label, form fields are labelled, and lane-color swatches are keyboard
  reachable.
- **What's new**: the first time you open KanDeck after an update, a window
  lists what changed in the new version plus the previous 10 releases (newest
  first, collapsed: click a version › to expand it). Dismiss it and it won't appear again until the next version. Click the
  **KanDeck v…** version label at the bottom center of the screen to reopen it.
  Release notes live in [`CHANGELOG.md`](CHANGELOG.md).

---

## Done lane & completed dates

- The **last lane on a board is always the done lane**, whatever it's named.
  Reorder lanes in Board settings and whichever lane is last becomes "done"
  (marked **✓ Done** in the lane editor).
- A card gets a **completed date** each time it enters the done lane — by
  dragging it there or clicking its check circle. Reordering inside the done
  lane keeps the date; moving a card out clears it. The date shows as a green
  **✓ date** badge on cards in the done lane, and as **✓ Completed …** in the
  card's detail window.
- **Auto-archive done tasks after X days** (Board settings; `0` = never)
  archives done-lane cards that many days after their completed date (checked
  hourly and whenever you save the setting). Archived cards keep their completed
  date and stay in the done lane, hidden — click the small **archive-box icon**
  at the right of the done lane's title to show or hide them (it shows how many
  are archived; remembered per board, per browser). Open one and
  click **Unarchive** to bring it back; it then gets a fresh X-day countdown.
  Archived cards are also listed on the **Archived** tab in Board settings.

## Archiving boards

**Board settings → Archive board** hides a board from the board switcher,
search, notifications and calendar feeds, keeping all of its cards.
**App Settings → Archives** lists archived boards with **Restore** and
**Delete** (permanent — though existing backups still contain the board).

## Routing tags

In **Board settings → Routing tags**, type a tag and click **Add** (or press
Enter; commas add several at once). Tags are saved immediately — no need to
click the board's **Save** — and show as chips; click **×** to remove one.

- When a task arrives through the API (`POST /api/tasks` or `/api/inbox`)
  **without** a `boardId`, its tags are compared to the boards' routing tags
  (ignoring upper/lower case) and it goes straight to the matching board's
  **first lane**.
- **Routing rank** (same tab): boards are checked in rank order — rank 1, then
  2, then 3 … — and routing **stops at the first board that owns any of the
  task's tags**. So a task tagged `Bill, Travel` goes to whichever of those
  boards ranks higher. Boards with no rank (or a tied rank) are checked after,
  in tab order — a rank of **0 or blank** means "no rank" and is always checked
  **last**. The tab shows the full **routing order** across all boards.
- Tasks with no tags, or no matching tag, go to the **Inbox** as before.
- A tag can belong to **only one board** — trying to add one that another board
  (even an archived one) already uses shows an error. Archived boards never
  receive routed tasks.
- Items already in the Inbox aren't re-routed automatically — click the small
  **↻** next to the Inbox count to re-check them all against the current
  routing tags (handy after adding a tag to a board).

## Calendar feed (.ics)

Each board can publish a read-only iCalendar feed that Google, Apple, Outlook
and other calendar apps can subscribe to. Turn it on in **Board settings →
Calendar feed**, then **Copy** the link or click **Subscribe**.

- Cards **with** a due date → all-day `VEVENT`s on that date.
- Cards **without** a due date → `VTODO`s. (Google Calendar ignores to-dos;
  Apple/Outlook/Thunderbird support varies for subscribed feeds.)
- A card's **alarm** becomes a `VALARM` reminder at that exact time (dropped
  once the card is done). Heads-up: many apps ignore alarms in *subscribed*
  calendars — Google Calendar always does, and Apple Calendar does unless you
  untick **Remove alerts** in the subscription's settings.
- Options: **Include card descriptions** and **Include done tasks** (both off
  by default). Archived cards and archived boards are never published.

**All boards + Inbox.** **App Settings → Calendar** publishes one app-wide feed
(`/ics/all/<token>.ics`) with every active board's cards — titles end with
the board, e.g. `Fix gate [Home]` — plus Inbox items as `… [Inbox]`
(toggle **Include Inbox items**, on by default). Same descriptions / done-tasks
options, same secret-link model, and its own **Generate new link**; it's
independent of the per-board feeds.

**Security.** Calendar apps can't log in, so the feed is protected by a random
192-bit token in its URL (`/ics/<boardId>/<token>.ics`) — treat the link like a
password.

- Feeds are **off by default**; turning one off revokes the link, and
  **Generate new link** rotates it (old link dies immediately).
- Every failure (wrong token, disabled feed, archived/unknown board) returns
  the same `404`, so the endpoint can't be used to discover boards.
- Responses are read-only, `noindex`, and `no-referrer`.
- Descriptions are excluded unless you opt in.
- If KanDeck is internet-facing, consider a rate-limit rule for `/ics/*` at
  your proxy/CDN (e.g. Cloudflare), and set `APP_URL` so links use your public
  hostname.

---

## REST API

All endpoints are under `/api` and require auth: either an active browser session
or an API key sent as `Authorization: Bearer <key>` or `X-API-Key: <key>`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/boards` | List active boards + summary meta incl. `openCount` (`?archived=1` → archived boards) |
| `GET` | `/api/boards/:id` | Full board (columns + cards) |
| `POST` | `/api/tasks` | Create a task (with `boardId` → that board; otherwise a matching routing tag → that board's first lane; else → Inbox) |
| `GET` | `/api/route-tags` | Every board's routing tags, plus `order` — the sequence routing checks boards in |
| `POST` | `/api/inbox/reprocess` | Re-run routing tags over the Inbox; returns what moved |
| `PUT` | `/api/tasks/:id` | Update or move a task |
| `GET` | `/api/tasks/query` | **Date-filtered task query** (see below) |
| `GET` | `/api/search?q=` | Search cards across all boards |
| `GET` | `/api/changelog` | Current version's release notes + previous 10, and whether they've been seen |
| `PUT` | `/api/changelog/seen` | Mark the running version's notes as seen |
| `GET` | `/api/inbox` · `POST` `/api/inbox` · `POST` `/api/inbox/:id/move` | Inbox |
| `POST` | `/api/boards/:id/archive` · `/api/boards/:id/unarchive` | Archive / restore a board |
| `DELETE` | `/api/boards/:id` | Permanently delete a board |
| `POST` | `/api/boards/:id/ics` | Enable the board's calendar feed (body `{"rotate":true}` → new token) |
| `PUT` | `/api/boards/:id/ics` | Feed options `{ includeDescriptions, includeCompleted }` |
| `DELETE` | `/api/boards/:id/ics` | Disable the feed (revokes the link) |
| `GET` | `/api/ics` · `POST` · `PUT` · `DELETE` | App-wide feed: read state · enable (`{"rotate":true}` → new token) · options `{ includeInbox, includeDescriptions, includeCompleted }` · disable |
| `GET` | `/ics/:boardId/:token.ics` | A board's feed — **no auth header**; the token is the credential |
| `GET` | `/ics/all/:token.ics` | The app-wide feed (all boards + Inbox) — token is the credential |

### Create a task

```bash
curl -X POST https://kandeck.example.com/api/tasks \
  -H "X-API-Key: $KANDECK_API_KEY" -H "content-type: application/json" \
  -d '{"subject":"Buy milk","priority":"high","dueDate":"2026-08-01"}'
```

Add `"email": "https://mail.google.com/mail/u/0/#all/<messageId>"` (or a plain
address) to link the card to its source email. Only email addresses and
`http(s)`/`mailto:` links are accepted.

To move an existing card to another board: `PUT /api/tasks/:id` with
`{"boardId": "<target board id>"}` (or `POST /api/boards/:id/cards/:cardId/transfer`
with `{"toBoardId": …}`) — it lands in that board's first lane.

Add `"alarm": "2026-08-01T09:00:00-06:00"` to set a reminder (include the
time-zone offset; send `null` to clear it). It's kept when the task moves from
the Inbox to a board and is published to calendar feeds.

Add `"tags": ["home"]` (or `"tags": "home, errands"`) and, if a board owns the
`home` routing tag, the response is `{"target":"board","boardId":…,"boardName":"Home","routedBy":"home","card":{…}}`
instead of an Inbox item. `POST /api/inbox` routes the same way.

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

## Notifications

Configured in **App Settings → Notifications** (no env vars):

- **Scheduled summaries** — an email, Discord and/or text digest of your tasks
  (upcoming N days · due today · past due) on a time + weekday schedule you pick.
- **Alarm reminders by text** — a text message the moment a card's or Inbox
  item's alarm time arrives.
- **Card-moved** Discord pings when a card lands in a board's notify lane.

Email uses SMTP you provide (the password is encrypted at rest); Discord uses a
webhook URL. Each has a **Test** button that validates the connection before you
rely on it.

### Text messages (📱 Text tab)

Texts are sent through the [iMessage Gateway](https://github.com/cwland/imessage-gateway)
menu-bar app running on a Mac signed in to Messages.

1. In the gateway: **Settings → Accept connections from → Local network**, then
   **API Keys → Create Key** (name it `KanDeck`). If you use its recipient
   allowlist, add the numbers KanDeck will text.
2. In KanDeck: **App Settings → Notifications → 📱 Text** — enable it, enter the
   **Gateway URL** (use the Mac's IP, e.g. `http://192.168.50.20:8787`; Docker
   containers often can't resolve `.local` names), the **API key** (encrypted at
   rest), who to **send to** (phone numbers or Apple IDs, comma-separated) and
   **iMessage** or **SMS**.
3. Choose **Alarm reminders**, **Daily summary**, or both, click **Send test
   text**, then **Save** (saving checks the gateway and key first).

Alarm reminders are checked every minute and sent once per alarm (changing a
card's alarm time re-arms it). Alarms that are more than 6 hours overdue — e.g.
after the server was down — are skipped rather than texted late. Done and
archived cards never send reminders. The Mac must be awake with Messages signed
in; see the gateway's README for SMS forwarding and other pitfalls.

---

## Backups

In **App Settings → Backups**:

- **Backup now** / **Restore** at any time.
- **Automatic backups** — daily / weekly / monthly, with a "keep last N" retention.
- Each backup is a full snapshot of **boards, the Inbox *and* settings** (secrets stay
  encrypted). Restore takes a safety backup first, and older backups are pruned to
  your retention count. Backups are labeled Automated vs Manual in the list.

CLI: `npm run backup` makes a one-off snapshot.

**Danger zone → Reset all cards** (bottom of the Backups tab, for testing)
deletes every card on every board — active and archived, archived boards
included — and empties the Inbox, keeping boards, lanes, routing tags, feeds and
settings. It asks twice (type `RESET`), only works from a signed-in browser (not
the API key), and saves a **Pre-reset** backup first so you can restore it.

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
settings if you want anyone to pull it. To cut a release, bump `version` in
`package.json`, add a `## <version> — <date>` section to the top of
[`CHANGELOG.md`](CHANGELOG.md) (that's what the in-app **What's new** window
shows), then:

```bash
git tag v3.1.3 && git push origin v3.1.3
```

To cross-build locally from an Apple-Silicon Mac for an Intel/AMD server without
CI, use [`scripts/build-amd64.sh`](scripts/build-amd64.sh).

---

## Privacy & License

- **Privacy:** KanDeck has no telemetry and never phones home; your data stays in
  local files and it only contacts services **you** configure (SMTP /
  Discord). See [`PRIVACY.md`](PRIVACY.md).
- **License:** [MIT](LICENSE) — do essentially anything you want with it.

Contributions and forks welcome. KanDeck is single-user by design.
