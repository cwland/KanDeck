# Changelog

All notable changes to KanDeck. Newest first. The in-app **What's new** window
reads this file. Format: one `## <version> — <YYYY-MM-DD>` heading per release,
followed by `- ` bullet points (`**bold**` and `` `code` `` are supported).

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
