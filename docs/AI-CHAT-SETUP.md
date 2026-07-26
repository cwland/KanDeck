# KanDeck AI Chat — Setup, Security & Webhook Spec

KanDeck's AI Chat feature adds a floating, draggable chat bubble to your boards
that talks to an [n8n](https://n8n.io) workflow through a Chat Webhook. The widget
runs entirely in your browser (KanDeck's server is not involved in the chat), so
the webhook URL and an optional bearer token are configured per install, and the
conversation history is stored locally in the browser (`localStorage`).

A ready-to-import n8n workflow lives next to this guide at
[`../templates/n8n/kandeck-chat-sample.json`](../templates/n8n/kandeck-chat-sample.json).

> ⚠️ **Requirement — a valid, browser-trusted HTTPS certificate.** The widget calls
> your webhook **directly from the browser**, so your n8n instance must be reachable
> over HTTPS with a certificate the browser already trusts (a real/public cert, or
> one from an internal CA — e.g. front n8n with a reverse proxy like Nginx Proxy
> Manager, Caddy, or Traefik using Let's Encrypt). **A self-signed or otherwise
> untrusted certificate will silently block every request and the chat will not
> work.** (A plain `http://` LAN address also works; the rule is specifically that
> if you use HTTPS, it must be trusted.)

---

## 1. Enable or disable the chat widget

Open **App Settings** (the ⚙️ button, top-right) → **AI Chat** tab.

1. Toggle **Enable AI Chat widget** on. When off, the bubble is not rendered at
   all. (The URL/token/other fields can be filled while it's still off — the
   toggle is what actually turns it on.)
2. Fill in the **n8n Chat Webhook URL** (required) — see section 2.
3. Optionally set a **Bearer token** — strongly recommended; see section 4.
4. Optionally set the **Widget title**, **Chat history length** (how many recent
   messages the widget keeps and reloads; default **10**), and **Response
   timeout** (how long to wait for n8n before giving up; default **60 s**, range
   5–300).
5. Click **Save**. The widget rebuilds immediately — no page reload needed.

There's a **Test connection** button that POSTs a ping (using the current, even
unsaved, URL + token) and reports whether n8n answered — use it to confirm setup
before relying on the bubble.

### Using the widget

The bubble sits bottom-right. Click it to open the chat; click again (or ✕) to
close. Drag the bubble or the window's header to reposition — positions are
remembered per device. On phones (≤ 640 px) dragging is disabled and it opens as a
full-screen sheet. The 🗑 button clears the conversation and starts a fresh
session.

---

## 2. Set up the n8n Webhook node

The fastest path is to **import the sample**: in n8n choose **Import from File** →
select `templates/n8n/kandeck-chat-sample.json` → attach your OpenAI (or other)
model credential → replace the token placeholder (section 4) → confirm the webhook
path → **Activate**.

If you'd rather build it by hand, use a standard **Webhook** node (not the n8n Chat
Trigger):

1. Add a **Webhook** node. Set **HTTP Method** = `POST`.
2. Set a **Path**, e.g. `kandeck-chat`.
3. Set **Respond** = **Using 'Respond to Webhook' Node** (`responseMode:
   responseNode`).
4. In **Options**, add **Allowed Origins (CORS)** = `*` (the widget calls from the
   browser, so the response must allow the cross-origin request).
5. End the flow with a **Respond to Webhook** node, **Respond With** = **JSON**,
   body `{ "reply": "…the model text…" }`.

**Use the exact Production URL shown in the Webhook node** (copy it from the node
in the n8n editor — don't hand-assemble it). For a static path it's the clean form:

```
https://<your-n8n-host>/webhook/kandeck-chat
```

> ⚠️ Use the **Production** URL, not the **Test** URL (the Test URL only accepts one
> call after you click "Listen", and only while the editor is open).

---

## 3. Let the assistant see your cards (optional)

KanDeck does **not** send board contents in the chat request — only
`{ source, sessionId, message, timestamp }`. So out of the box the assistant is a
general helper. To let it answer questions about your actual cards, give the n8n
**AI Agent** an **HTTP Request tool** that calls KanDeck's REST API:

- `GET /api/boards` — list boards
- `GET /api/boards/:id` — a board with its columns and cards
- `GET /api/search?q=<text>` — search cards across all boards

Authenticate the tool with an `X-API-Key` header (set `API_KEY` in KanDeck's
environment). The agent can then look up cards on demand and answer with real data.

---

## 4. Secure the endpoint (bearer-token gate)

Left open, anyone who knows the URL can POST to your webhook and run your LLM.
Because the widget runs in your browser, **any token it sends is visible in your own
browser's devtools** — a token can't be truly secret client-side. So a token gate
is the right tool for "keep strangers out," and network-level controls are the tool
for stronger isolation.

The sample workflow already includes the gate (an **IF** node named **Check Auth**
right after the Webhook):

- **Condition:** `{{ $json.headers.authorization }}` **equals** `Bearer <YOUR_TOKEN>`
  (headers arrive lowercased; keep the literal `Bearer ` prefix here).
- **True** → continue into the agent.
- **False** → a **Respond to Webhook** node with **Response Code 401** and body
  `{ "error": "unauthorized" }`.

Then set the same token in KanDeck: **App Settings → AI Chat → Bearer token**,
pasting **only the token value** (the widget adds the `Bearer ` prefix itself).
Save. Requests without the token now get a 401 and never reach the model.

### Generate / rotate a token

Any long random string works:

```bash
openssl rand -base64 32
# or
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

To **rotate**, change the value in **two places** so they match: the IF node's
comparison (`Bearer <newtoken>`) and KanDeck's Bearer-token field (`<newtoken>`).

### Stronger option — network level

For real isolation (no secret in the browser at all), don't expose the webhook
publicly: keep n8n on Tailscale/LAN, or put a reverse-proxy IP allowlist in front
of it. Trade-off: KanDeck's chat then only works from that network.

---

## 5. Request / response contract

### Request (KanDeck → n8n)

```
POST <your webhook Production URL>
Content-Type: application/json
Authorization: Bearer <token>        # sent whenever a token is configured
```

```json
{
  "source": "kandeck",
  "sessionId": "b3f1c2e4-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  "message": "What should I focus on today?",
  "timestamp": "2026-07-26T20:15:03.000Z"
}
```

| Field       | Type   | Notes                                                                 |
|-------------|--------|-----------------------------------------------------------------------|
| `source`    | string | Always `"kandeck"`. Handy for routing.                                |
| `sessionId` | string | Stable per browser; identifies the conversation. Rotated by "Clear conversation". |
| `message`   | string | The user's text.                                                      |
| `timestamp` | string | ISO-8601 send time.                                                   |

On the Webhook node the body is under `{{ $json.body }}` (`{{ $json.body.message }}`,
…) and the token under `{{ $json.headers.authorization }}`.

### Response (n8n → KanDeck)

Respond with `application/json` containing the reply. The widget reads `reply`
first:

```json
{ "reply": "Your only card due today is 'Ship the release'.", "sessionId": "b3f1c2e4-…" }
```

For flexibility it also accepts the reply under any of `reply`, `output`, `text`,
`message`, `response`, `answer`, `content`, unwraps a top-level array or a
`json`/`data` envelope, and uses raw text if the response is `text/plain`. So an AI
Agent node whose output is `$json.output` works with no extra mapping.

### Behaviour, timeouts, errors

- One `POST`, waits for the full response (no streaming). Aborts after the
  configured **Response timeout** (default 60 s; 5–300).
- Typing indicator while in flight; inline error on failure.
- **Clear conversation** wipes local history and generates a **new** `sessionId`.

---

## 6. Storage & cross-device behaviour

History and `sessionId` live in the browser's `localStorage` — **per device / per
browser profile** (keys `kandeck.aiChatHistory`, `kandeck.aiChatSessionId`,
`kandeck.aiChatUi`). Conversations don't auto-sync between machines; the
authoritative context lives in your n8n memory node (keyed by `sessionId`).

---

## Troubleshooting

- **No chat bubble.** Confirm AI Chat is enabled and **Saved**. The widget mounts on
  load and after every save; if it's still missing, check the browser console for
  errors.
- **"Couldn't reach the assistant" right after adding a token.** The browser now
  sends an `Authorization` header, which triggers a CORS preflight. Ensure the
  Webhook node's **Allowed Origins** is `*` (or your origin). If a reverse proxy
  sits in front, make sure it forwards `OPTIONS` and the `Authorization` header.
- **Reply shows "(unrecognized response)".** Return `{ "reply": "…" }` (or name the
  field `output`/`text`/…), or respond as plain text.
- **No memory between messages.** Ensure a memory node is connected to the agent and
  its session key uses the incoming id (`={{ $json.sessionId }}`).
- **HTTPS "widget offline" / test fails at the network layer.** Self-signed certs
  are blocked by the browser; use a trusted cert or a reverse proxy with a real cert.
