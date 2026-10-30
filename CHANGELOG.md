# Changelog

All notable changes to KanDeck. Newest first. The in-app **What's new** window
reads this file. Format: one `## <version> — <YYYY-MM-DD>` heading per release,
followed by `- ` bullet points (`**bold**` and `` `code` `` are supported).

## 3.0.2 — 2026-10-29

- **Board / List** moved to the left end of the summary line (overdue · due this week · open) and **Sort** to its right end, so the header is just the board name, tabs, search and board settings.

## 3.0.1 — 2026-10-29

- **Compact header**: the board name is centered at the top (no description line; hover the name to see it) with the board tabs centered underneath. **Board / List** and **Sort** sit at the top left; **search** is now a 🔍 icon at the top right (press **/** too), next to **Board settings** (new sliders icon, so it isn't confused with the App settings gear).
- **Inbox opens and closes with one click**, from the rail or from the new **tab on the right edge** of the board (like the original version), which shows the item count. On laptop-size screens the panel slides over the board instead of squeezing it.
- **List view**: emails and links show as just an ✉️ / 🔗 icon (hover for the address).
- The version number moved into the rail (under your initials) so it no longer covers cards.
- **Archive board** is now a red text button, set apart from Cancel.
- Many boards: the tab row fades at the edges when there are more to scroll to.
- **Accessibility**: every icon has hover text and a screen-reader label; all settings fields are labelled; lane-color swatches are real, keyboard-reachable buttons.
- The unused "Due date" badge color setting is hidden (due dates show as text on cards now).

## 3.0.0 — 2026-10-29

- **New look.** A cleaner, card-based layout in the Figtree typeface: an **icon rail** on the left (Boards, Inbox, Search, New board, Archives, Settings, Log out), white lanes on a light grey page, each card on its own tile, and rounded **pills** for category, tags, alarm ⏰, email ✉️ and link 🔗. The due date sits at the top-right of each card.
- **Board tabs** across the top with each board's open-card count, plus a summary line: overdue · due this week · open.
- **List view**: a **Board / List** switch in the header. The list stacks the lanes, one row per card, with the reminder, email/link and tags written out, plus Category and Due columns.
- The **Inbox** moved to a panel on the **right**, opened from the rail. Each item shows the date it arrived and a **+ Board** button; a new **Summary** tab shows open cards per lane, what's due this week and your other boards.
- **Cards** and **Board settings** open as side panels, so the board stays visible. **App settings** is now a full page.
- **Show / hide secrets**: the API key, OAuth client secret, SMTP password, Discord webhook and text-gateway key are hidden by default, with an 👁 eye button to reveal each one.
- New **Navy** theme (the new default). Your current theme is kept; pick Navy under App settings → Theme for the look in the screenshots.
- Restyled sign-in page to match. On phones the rail becomes a bar along the bottom.

## 2.11.3 — 2026-10-29

- **Fix:** after an update the browser could keep using the old app files until a hard refresh, so new features didn't appear. KanDeck now tells the browser to check for newer files on every load (unchanged files are still served from cache).

## 2.11.2 — 2026-10-29

- **Sign-in tab** tidied up: each method has its own slider, and its settings only show while the slider is on.
- **Passkeys** moved here from the Account tab and have no settings any more: just your list and an **＋ Add a passkey** button. A passkey always belongs to the address you add it from (localhost or the current URL).
- The OAuth **callback (redirect) URL** now sits inside the OAuth settings.

## 2.11.1 — 2026-10-29

- **What's new** window: earlier releases under **Previous updates** now start collapsed. Click a version (›) to expand its changes; each row shows how many changes it has.

## 2.11.0 — 2026-10-29

- **OAuth / OpenID Connect sign-in** — sign in through Authentik, Authelia, Keycloak, Google, Microsoft or any OIDC provider. Set it up in the new **App Settings → Sign-in** tab: issuer URL, client ID and secret, and your own button label (e.g. **Sign in with Authentik**). Click **Link my account** once so only *your* provider account can sign in (or list allowed, verified emails).
- **Sign-in modes** — choose what the sign-in page offers: *Password, passkeys and OAuth* · *Password and OAuth* · *Passkeys and OAuth* · *Passkeys only* · *OAuth only*. Methods you turn off disappear from the page and are refused by the server too. KanDeck won't save a setup that would lock you out.
- **Passkey options** — turn passkeys on or off, set the name shown in the passkey prompt, and optionally one passkey domain for all your subdomains.
- **Emergency reset** — locked out because your identity provider is down or a passkey broke? `docker compose exec kandeck npm run auth:reset` turns password sign-in back on immediately (`-- --disable-oauth-passkeys` also switches OAuth and passkeys off). Or start the container once with `AUTH_RESET=1`.

## 2.10.1 — 2026-10-29

- **Categories** and **Lane colors** are back in **App Settings** (they're global), now combined on one **Board settings** tab together with the badge colors. They no longer appear in each board's ⚙️ settings.

## 2.10.0 — 2026-10-29

- **Passkeys** — add one or more passkeys under **App Settings → Account** (1Password, iCloud Keychain, a security key …). Once one exists, the sign-in page offers it as soon as you click into the username box (1Password pops up on its own), and a **🔑 Sign in with passkey** button appears. With no passkeys the button stays hidden and nothing changes.
- A passkey works only on the address it was created on, so add one for each KanDeck address you use (e.g. internal and external). Passkeys can be renamed or removed, and need HTTPS.
- KanDeck now needs **Node 20** or newer when run outside Docker (the Docker image already uses it).

## 2.9.1 — 2026-10-27

- Cards whose Email field holds a **link** now show a small **🔗** next to the priority, date and alarm (click to open it in a new tab). Email addresses keep the ✉️.
- **Fix:** due dates sent as a plain date (e.g. `"2026-10-30"` from n8n) showed one day early on cards and in the card window for time zones west of UTC. They now show the right day.
- A card due **today** is no longer shown in red as overdue; it turns red once the due day has passed.

## 2.9.0 — 2026-10-26

- **Quick archive / delete** — a small **✕** in the top-right corner of every card (shown on hover) opens a menu to **Archive** (or **Unarchive**) or **Delete** the card. Delete asks for a second click so nothing is removed by accident.

## 2.8.1 — 2026-10-26

- **Fix:** board tab counts (and the Inbox / open board) now keep themselves up to date even when a reverse proxy holds back or drops KanDeck's live-update connection. The connection sends a heartbeat and reconnects if it stalls, and the page also re-checks every 30 seconds and whenever you switch back to the tab.
- Routing rank **0 or blank** = no rank, always checked last (now spelled out on the Routing tab).

## 2.8.0 — 2026-10-26

- **Routing rank** — give each board a rank on its **Routing** tab. Incoming tasks are checked against boards in rank order (1, then 2, then 3 …) and go to the first board that owns any of their tags. Unranked boards come after, in tab order.
- The Routing tab shows the full **routing order** across all boards. The rank saves as soon as you change it.

## 2.7.1 — 2026-10-26

- The card window's **Email** field now sits right under the description and spans the full width, showing the whole address or link.

## 2.7.0 — 2026-10-26

- **Inbox tab on the left edge** — a slim tab shows how many items are in the Inbox; click it to slide the Inbox out, and again (‹) to close it. Your choice is remembered per browser.
- Removed the Inbox / Board buttons from the bottom of the screen. The **KanDeck version** now sits there instead — click it for What's new.

## 2.6.0 — 2026-10-26

- **Board tabs at the top** — `Home (1) | Work (5) | …` centered on the board title line replaces the bottom-bar "Switch board". Each number is that board's open cards and updates live, including tasks added or sorted behind the scenes (n8n, API, tag routing, auto-archive).
- **Move a card to another board** — pick a different **Board** in the card window and Save; it lands in that board's first lane with all its details. The API can do it too (`boardId` on `PUT /api/tasks/:id`).
- **Email field** on cards and Inbox items — an address or a link to the source email. Click to open (new tab / mail app), ✏️ to edit; integrations can set it with `"email"`. Cards show a clickable ✉️ (toggle under Board settings → Show on cards).

## 2.5.0 — 2026-10-25

- **Text messages** — new **📱 Text** tab under App Settings → Notifications sends texts through the iMessage Gateway Mac app (iMessage or SMS).
- **Alarm reminders by text** — KanDeck now texts you when a card's or Inbox item's alarm time arrives (once per alarm; stale alarms aren't sent late).
- Optional **daily summary by text**, with the same content and schedule options as email and Discord.
- **Send test text** button, and saving checks the gateway connection and API key first. The API key is encrypted at rest.
- Removed the ✕ from the top of App Settings — use **Cancel** (or Esc) to close.

## 2.4.0 — 2026-10-25

- **Alarms** — set a reminder date and time on any card (or Inbox item) in the card window. Cards show an ⏰ badge (toggle it under Board settings → Show on cards).
- API pushes can include `"alarm"` (e.g. `"2026-10-30T09:00:00-06:00"`); it's kept when an item moves from the Inbox to a board.
- Calendar feeds include the alarm as a reminder (`VALARM`). Note that some calendar apps ignore alarms in subscribed calendars.
- **Fix:** password managers (1Password, Bitwarden, LastPass, Dashlane) no longer pop up on the settings windows' fields. The sign-in page still works with them.

## 2.3.0 — 2026-10-25

- **Reset all cards** (for testing) — **App Settings → Backups → Danger zone**. Deletes every card on every board (active and archived) and empties the Inbox, while keeping boards, lanes, tags, feeds and settings. Asks you to type `RESET`, and takes a **Pre-reset** backup first so it can be undone.
- **Backups now include the Inbox.** Previously a restore brought back boards and settings but not Inbox items. (Older backups restore as before and leave the current Inbox alone.)

## 2.2.0 — 2026-10-25

- **Board settings** are now split into tabs — **General**, **Lanes**, **Routing**, **Calendar** and **Archived** (with a count) — instead of one long list.
- Board **routing tags** now save the moment you click **Add** or **×** — no need to click the board's Save button.
- **Re-check the Inbox** — a small **↻** button next to the Inbox count runs every Inbox item through the board routing tags again and moves matches to that board's first lane. Handy after adding a tag to a board.

## 2.1.1 — 2026-10-25

- **App Settings** now has a vertical section menu on the left (with icons) instead of a row of tabs, so every section fits without scrolling sideways. Only the settings area scrolls. On phones it falls back to a swipeable tab strip.

## 2.1.0 — 2026-10-25

- **Routing tags** — in **Board settings**, add tags to a board (type, click **Add**; remove with ×). A task pushed to KanDeck without a board but with a matching tag goes straight to that board's **first lane** instead of the Inbox.
- Each tag can belong to only one board — adding a duplicate shows an error naming the board that already has it.
- Tasks without tags (or without a match) still go to the Inbox.

## 2.0.2 — 2026-10-25

- All-boards calendar feed: the board name now goes at the **end** of each title — `Fix gate [Home]`, `Call plumber [Inbox]` — instead of the start.

## 2.0.1 — 2026-10-25

- **Fix:** the HSTS security header is now sent only for your public hostname (`APP_URL`). A second, internal proxy name no longer gets pinned, so browsers don't block it with "invalid certificate" if its certificate isn't perfect.

## 2.0.0 — 2026-10-25

- **Username + password login.** After upgrading, sign in once with your existing password and choose a username — your boards, settings and API key are untouched, and a full **pre-upgrade backup** is taken automatically first.
- New **App Settings → Account** tab: change your username or password, and **Log out all sessions**. Changing the password signs out other browsers.
- Logout and password changes now truly end sessions (they're revocable), and existing sessions from 1.x are signed out once on upgrade.
- **Hardening for public exposure:** login rate-limiting can no longer be bypassed with fake `X-Forwarded-For` headers (set `TRUST_PROXY=1` behind a proxy), first-run setup is limited to your local network or a `SETUP_TOKEN`, security headers (CSP, anti-framing, HSTS over HTTPS) on every page, and new passwords need at least 12 characters.
- `npm run reset-password -- <username> <password>` sets a new login directly.

## 1.5.0 — 2026-10-25

- **Removed the AI Chat widget** (the floating chat bubble and the **App Settings → AI Chat** tab), along with its n8n chat template and setup guide. Its saved settings, including the encrypted webhook token, are cleared from `settings.json` on upgrade.
- The REST API, API key and task-query endpoint are unchanged, so n8n workflows and scripts that call KanDeck keep working.
- All-boards calendar feed: the **Board:** line (or "Inbox item") now comes at the end of each event's description instead of the start.

## 1.4.0 — 2026-10-25

- **All-boards calendar feed** — **App Settings → Calendar** publishes one `.ics` link covering every board plus your Inbox. Titles are prefixed with the board name (e.g. `[Home]`) or `[Inbox]`.
- Options for Inbox items, card descriptions and done tasks, plus **Generate new link** and an on/off switch — the same secret-link security as per-board feeds.

## 1.3.1 — 2026-10-25

- Removed the version number from the bottom-right corner. Click **KanDeck v…** at the bottom of the Inbox to open the What's new window.

## 1.3.0 — 2026-10-25

- **Auto-archive done tasks after X days** replaces "Show done tasks for the last X days". Done-lane cards are archived that many days after their completed date; your existing setting carries over.
- A small **archive-box icon** on the right of the done lane's title shows or hides archived tasks (hover for help; it shows how many are archived). Archived cards appear dimmed with their completed date, and can be opened and **Unarchived**.
- The card window's **Archive** button becomes **Unarchive** for archived cards.

## 1.2.1 — 2026-10-25

- The **completed date** now also shows in the card's detail window (under the created date) for cards in the done lane.

## 1.2.0 — 2026-10-25

- **What's new window** — after an update, KanDeck shows the changes in the new version plus the 10 releases before it. Dismiss it and it stays hidden until the next update.
- Click the **version number** (bottom-right) any time to open the window again.

## 1.1.0 — 2026-10-25

- **Archive boards** instead of deleting them. Archived boards leave the board menu, search, notifications and calendar feeds; restore or permanently delete them from **App Settings → Archives**.
- **Calendar feed (.ics)** per board — subscribe from Google, Apple or Outlook. Dated cards become all-day events; undated cards become to-dos. Secured by a secret link you can rotate or turn off.
- **The last lane is always the done lane**, whatever it's named.
- Cards get a **completed date** when they enter the done lane; it shows on cards in that lane.
- New board setting: **Show done tasks for the last X days**, with a **Show all** toggle at the top of the done lane.
- Board switcher is now a slide-up popover instead of a modal.

## 1.0.1 — 2026-07-26

- **Password reset** from the command line: `npm run reset-password`.
- Failed sign-ins now show password-reset help.
- Notification settings stay hidden until enabled and are validated on save.
- GitHub Actions workflow builds a multi-arch (amd64 + arm64) Docker image.

## 1.0.0 — 2026-07-26

- First release: flat-file Kanban boards with drag-and-drop lanes and cards, no database.
- **Inbox** for items arriving via the REST API, with a **send to board** menu.
- App-wide **categories**, lane colors, badge colors and 20 light/dark **themes**.
- **AI Chat** widget backed by an n8n webhook, plus an API key and task-query endpoint for assistants.
- **Notifications** — scheduled email and Discord summaries.
- **Backups** — manual and automatic, with one-click restore.
- Security: bcrypt password, JWT sessions, login rate-limiting, secrets encrypted at rest.
