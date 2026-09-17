# PishHoosh — Diar Real Estate Office Bot

An AI assistant that collects property file details and produces price estimates, for
**Telegram**, a **Telegram Mini App**, and a **landing page**.

The user sends a project name or list number; the bot asks for the required fields, computes
the estimate from the pricing rules stored in Google Sheets, then takes the customer's name
and phone number and saves the lead in the sheet.

In the **mini app** the same flow is calmer: you see the list of active projects, tap one and
land directly in that project's estimate chat — or talk to the same bot in the "Chat" tab.

---

## Project layout

```
src/
  index.js          entry point - starts the Telegram bot and the web server together
  env.js            loads .env (before every other module)
  telegram.js       Telegram connection (commands, keyboards, long-message chunking)
  webApi.js         web API (landing page + mini app) + demo page + rate limiting
  miniapp.js        Telegram initData verification and mini-app user identity
  conversation.js   shared conversation logic (Telegram, mini app and web all use it)
  ai.js             Gemini connection via the official @google/genai SDK
  projects.js       matches user input to a project (list number / name / Persian spelling)
  sheets.js         Google Sheets connection (read projects, save and update leads)
  sessions.js       per-user conversation state in memory + per-user lock
  text.js           Persian text normalization (ی/ي, ک/ك, half-space, digits, numbers, phones)
  notify.js         optional admin alerts
  doctor.js         diagnostics tool: npm run doctor
public/
  miniapp.html      Telegram mini app (two tabs: projects and chat) - served at /app
  demo.html         sample chat widget for testing the web API - served at /demo
tools/
  miniapp-preview.mjs  preview the mini app without a Gemini key or Google Sheet: npm run miniapp:preview
  preview-sheets.mjs   sample projects used by that preview
test/               tests: npm test
```

---

## 1) Google Sheet setup

Create a spreadsheet with two tabs. Tab names can be changed with `PROJECTS_SHEET_TITLE`
and `LEADS_SHEET_TITLE`.

**`Projects` tab** (columns, first row = header):

| Project name | Required fields (comma separated) | Base price per meter (Toman) | Helper notes for the AI | Active? |
|---|---|---|---|---|
| Parsian 1 | Area, floor, build year, deed status | 120000000 | price = area × base price; floors above 3 add 5% | yes |

- **Required fields**: both English `,` and Persian `،` separators are accepted.
- **Base price**: Persian digits, thousands separators and even "120 million" parse correctly.
- **Active?**: `بله / آره / فعال / yes / true / 1` means active; `نه / خیر / غیرفعال / no / false / 0`
  means inactive. If the column is empty the project is treated as **active** (and
  `npm run doctor` warns about it).
- **Helper notes for the AI**: any pricing formula or rule you want followed exactly.

**`Leads` tab** (the bot only writes here):

| Date | Customer name | Phone | Project name | File info | Estimated price (Toman) | Source |
|---|---|---|---|---|---|---|

If you also add a `تاریخ شمسی` (Persian calendar) column, the Tehran Gregorian date is written there.

> **Note:** header spelling is forgiving. Spaces, half-spaces, "ی/ي", "ک/ك", parentheses and "؟"
> are ignored, so `فعال؟`, `فعال` and `وضعیت` all work. If a column cannot be found,
> `npm run doctor` says exactly which column is missing and which headers exist.

---

## 2) Google service account

1. Create a project at https://console.cloud.google.com (or reuse the Gemini project).
2. **APIs & Services → Library** → enable "Google Sheets API".
3. **APIs & Services → Credentials → Create Credentials → Service Account**.
4. In the **Keys** tab: **Add Key → Create New Key → JSON** and download it.
5. From the JSON file:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (multi-line; keep the `\n`s, inside quotes)
6. In the Google Sheet, **Share** with that same `client_email` as **Editor**.
   Without this step the bot can neither read nor write.

---

## 3) The `.env` file

```bash
cp .env.example .env
```

Required values:

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from BotFather |
| `GEMINI_API_KEY` | from https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | default `gemini-3.6-flash`; cheaper option `gemini-2.5-flash` |
| `GEMINI_THINKING_LEVEL` | `minimal`/`low`/`medium`/`high` — `low` is enough and faster here |
| `GOOGLE_SHEET_ID` | the part between `/d/` and `/edit` in the sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | from the JSON file |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | from the JSON file (with `\n`) |
| `ADMIN_CHAT_ID` | admin chat id; failure alerts (e.g. a lead that could not be saved) go there |
| `CORS_ORIGIN` | your site domain(s), comma separated. Empty = open to everyone (testing only) |
| `MINI_APP_URL` | public HTTPS URL of the mini app (`https://your-domain/app`). Only used for `/app` links and diagnostics; a missing `https://` is added automatically |

The remaining variables (port, rate limits, session TTL, tab names) are documented in `.env.example`.

---

## 4) Install, health check, run

```bash
npm install
npm run doctor     # checks everything and says exactly what is wrong
npm start
```

`npm run doctor` verifies: environment variables, model name and Gemini key validity, the Google
Sheets connection, column header mapping, active projects (including whether any field list or
base price failed to parse) and that the Leads tab is ready. It exits with code 1 on problems.

Healthy output:

```
✅ Telegram bot active: @diyar_bot
✅ Web server listening on 0.0.0.0:3000
   AI model: gemini-3.6-flash | thinking level: low
   Chat test page: http://localhost:3000/demo
✅ 2 active projects read from Google Sheets: Parsian 1, Negin Building
```

For development with auto-restart: `npm run dev`
To run the tests: `npm test`

---

## 5) Deploy and connect the Telegram bot

The `railway.json` file in the repo applies the sensitive settings itself:
**one instance** (two simultaneous instances = 409 errors and duplicate replies),
**no deploy overlap** (`overlapSeconds: 0`, so the old instance stops polling before the new one
starts), **healthcheck on `/health`** and **no sleeping when idle**.

Steps:

1. Import the repo at https://railway.app with **New Project → Deploy from GitHub repo**.
   In **Settings → Source** pick the branch that holds the final code (currently
   `arena/01a0ac59-pishhoosh`). If the service already exists, just change the branch to trigger
   a new deploy.
2. Enable **Public Networking** to get a public domain `https://<name>.up.railway.app`;
   the mini app will not open in Telegram without public HTTPS.
3. In the **Variables** tab enter (Railway does not read the `.env` file):
   `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `GOOGLE_SHEET_ID`,
   `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`,
   `ADMIN_CHAT_ID`, `CORS_ORIGIN` and optionally **`MINI_APP_URL`** (e.g.
   `https://<name>.up.railway.app/app`).
   Keep the `\n`s inside the private key.
4. Deploy and look for these log lines:
   ```
   ✅ Telegram bot active: @your_bot
      📱 Mini app: https://<name>.up.railway.app/app (url source: RAILWAY_PUBLIC_DOMAIN)
   ✅ Web server listening on 0.0.0.0:3000
   ✅ 2 active projects read from Google Sheets
   ```
5. Open `https://<name>.up.railway.app/app` in a browser (it works outside Telegram too), then set
   the menu button once in BotFather (see "Mini app entry in Telegram" below) and send `/start` in
   Telegram; the mini app opens from the **menu button** next to the input box.

**If a webhook was previously set for this bot**, polling will not work and you will see 409
errors in the log. Call this once (it also opens in a browser):

```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/deleteWebhook
```

`npm run doctor` checks the same things: token validity via `getMe`, the bot username, and
whether a webhook is active.

### Local run (easiest way to test)

```bash
git clone https://github.com/GameOver2032/PishHoosh.git
cd PishHoosh
npm install
cp .env.example .env      # then fill in real values
npm run doctor            # should say everything is healthy
npm start
```

> ⚠️ Do not run the bot on your laptop and on Railway at the same time; only one instance can poll.

---

## 6) Telegram Mini App

A sparse, minimal mini app with two sections, served by **this same service** at `/app` and
requiring no other service:

| Section | What it does |
|---|---|
| **Projects** | The active projects from Google Sheets with each one's required fields, plus a **search box** above the list. Tapping a project opens that project's estimate chat: the bot asks for the file details and announces the estimate. |
| **Chat** | The same bot, directly; ask anything or type a project name. |

Search matches the **project name and its fields** and requires every word to hit (AND).
Both sides are normalized before comparison, so these make no difference: Arabic "ي"/"ک" vs
Persian "ی"/"ک", Latin vs Persian digits, half-space vs space, and diacritics/tatweel
(`پارسـيان` ≡ `پارسیان`). When nothing is found, the query itself is shown in the "not found"
message so typos are obvious.

The first time a user taps a project, a small sheet asks for **name and phone number** (the name
is pre-filled from the Telegram profile) so the lead saved in the sheet has a follow-up number.
The user can tap "continue without a number for now". If the user already shared their phone in
the bot chat, the mini app reuses it and does not ask again.

A few short, silent motions bring these sections to life — all under one second and aligned with
the work of a real-estate office: cards rise one by one like **floors of a building** and a
**crane** sways while loading; the tab indicator slides; in the contact sheet a **signature is
written on a contract** and then a **saved checkmark** is drawn; and when the bot announces a
price, the number appears inside a **price chip** with a spinning coin and counting digits. If the
user has enabled "reduce motion" (`prefers-reduced-motion`) in their OS, all of this turns off.

### Telegram connection

**On Railway you do not need to configure anything for the URL.** The service builds the mini app
address itself from the built-in `RAILWAY_PUBLIC_DOMAIN` variable (`https://<domain>/app`). The only
requirement is that the service's **Public Networking** is on (Settings → Networking → Generate
Domain).

If you have your own domain or deploy elsewhere, set the address manually:

```
MINI_APP_URL=https://amlak.diyar.ir/app
```

After boot the bot logs:

```
✅ Telegram bot active: @your_bot
   📱 Mini app: https://your-app.up.railway.app/app (url source: RAILWAY_PUBLIC_DOMAIN)
```

### Mini app entry in Telegram: manual in BotFather

The service **never** sets or overwrites the menu button and never puts an "open mini app" button
under messages; you create the entry once in BotFather and that is the source of truth:

`/mybots` → your bot → **Bot Settings → Menu Button → Configure Menu Button** →
type **Web App** and URL `https://your-domain/app`.

| Way | Where it appears |
|---|---|
| **Menu button (BotFather)** | The icon next to the input box in a private chat with the bot |
| **`/app` command** | Sends the mini app URL as plain text in the chat (for support/diagnostics) |

If you do not see the menu button: fully close and reopen Telegram (clients cache it) and make
sure you are in a **private chat** with the bot (there is no menu button in groups). The live
state of the button is also visible in `/api/miniapp-status` (below).

### Self-diagnosis: `GET /api/miniapp-status`

Instead of digging through logs, open this in a browser:

```
https://your-domain/api/miniapp-status
```

The output is a Persian report with `verdict` (root cause), `hints` (next steps) and the live
Telegram state (fresh `getMe` and `getChatMenuButton` results). It distinguishes these cases:

| `verdict` | Meaning |
|---|---|
| `Mini app URL could not be built…` | Neither `MINI_APP_URL` is set nor a public service domain was found (Public Networking off) |
| `URL "…" does not start with https…` | Telegram only accepts public HTTPS |
| `Server could not reach api.telegram.org…` | A service network problem, not the token |
| `Telegram rejected the bot: Unauthorized` | `TELEGRAM_BOT_TOKEN` is wrong or revoked |
| `Telegram side is fine: the menu button is set to the mini app` | The BotFather button is healthy; if a client does not show it, it is Telegram's cache |
| `Menu button is not set in Telegram…` | The service intentionally sets nothing; create it in BotFather (steps are in `hints`) |
| `Menu button is set to a different address…` | The BotFather button does not match the current service URL; align either the button or `MINI_APP_URL` |

> The response never leaks the bot token, and the Telegram output is cached for 30 seconds.

### Which version is deployed? `build` in the same report

If you do not see a change in the mini app, first check which version the server **actually**
serves. The same `/api/miniapp-status` has a `build` section:

```json
{
  "build": {
    "version": "1.3.0",
    "miniapp": "4ec1e210",
    "deployment": "…",
    "commit": "…",
    "branch": "arena/01a0ac59-pishhoosh",
    "startedAt": "2026-09-17T00:38:29.118Z"
  }
}
```

- `version` comes from `package.json` and `miniapp` is a short fingerprint of the very
  `public/miniapp.html` the server is serving right now (computed from the file, so it never goes
  stale).
- `branch`/`commit`/`deployment` come from Railway's built-in variables; they show **which branch**
  the service deployed. If it is not your working branch, changes never arrive.
- If those are correct and you still see no change, it is the Telegram client cache: fully close
  the mini app (remove it from recents) and open it again.

> The legacy variables `MINI_APP_TITLE` and `MINI_APP_MENU_BUTTON` are no longer used; if they are
> still in your service Variables, removing them is harmless but not required.

> ⚠️ Telegram only accepts **public HTTPS**; `http://localhost:3000/app` will not open in Telegram.

### Preview the mini app without a Gemini key or Google Sheet

```bash
npm run miniapp:preview     # then http://localhost:4100/app
```

This tool runs **the same server code and the same mini app page**, replacing only Google Sheets
with a few sample projects and Gemini with a simple pricing simulator, so you can click through
the whole flow "pick a project → file details → estimate → lead saved". Leads are printed to the
console instead of the sheet.

### Implementation notes

- **Authentication:** the page sends `WebApp.initData` to the server and `src/miniapp.js` verifies
  Telegram's signature with `HMAC-SHA256` (key: `WebAppData` + bot token). Tampered or stale
  strings (default: older than 24 hours) are rejected with `403`.
- **Stable session:** the mini app session key is `miniapp:<telegram user id>`, so closing and
  reopening the mini app keeps the half-finished project and contact info, and the user continues
  the same conversation.
- **Plain browser:** outside Telegram, a `sessionId` in `localStorage` is used instead of initData,
  so the same page works for browser testing.
- **Data privacy:** the project list only exposes `name` and `fields` to the client; the base price
  per meter and the pricing formula (the sheet's notes column) never reach the user's browser.
- **Theme:** colors are read from `--tg-theme-*`, so the mini app matches Telegram in light/dark
  mode and with the user's custom colors. Telegram's back button and haptic feedback are wired up.

---

## Web API (landing page and mini app)

| Route | Description |
|---|---|
| `GET /health` | server health + number of active sessions |
| `GET /api/miniapp-status` | diagnostic report "why is the mini app button missing" (Persian, with next steps) |
| `GET /app` | the Telegram mini app page (same page at `GET /miniapp`) |
| `GET /api/welcome` | `{ message, projects: [{name, fields}] }` |
| `GET /api/projects` | `{ projects: [{name, fields}] }` — list only, no session |
| `POST /api/state` | `{ initData \| sessionId }` → current user state: `{ projects, project, contact, state }` |
| `POST /api/select` | `{ initData \| sessionId, project }` → definitive project selection and start of the estimate conversation (no AI quota used) |
| `POST /api/contact` | `{ initData \| sessionId, customerName, phone }` → save the lead's contact info |
| `POST /api/message` | `{ initData \| sessionId, text }` → `{ message, project?, projects? }` |
| `POST /api/reset` | `{ initData \| sessionId }` → start over |
| `GET /demo` | ready-made chat widget for testing (no landing page needed) |

The user identity is sent as one of these two:

- **`initData`** (Telegram mini app): the `WebApp.initData` string; the server verifies Telegram's
  signature and the session key is derived from the user id. Lead source: `Telegram mini app`.
- **`sessionId`** (landing page): create it in the browser with `crypto.randomUUID()` and keep it in
  `localStorage` so a page refresh preserves the conversation. Lead source: `Landing page`.

Both use **relative paths**, so they work behind a proxy or the Railway domain.

Possible errors: `400` invalid input, `403` invalid or expired initData, `413` message too long,
`429` rate limit exceeded, `502/503` AI or sheet service error.

---

## Bot behavior

- The user can pick a project by **number** (`2`), **full name** or **partial name** (`Negin`).
  In Telegram a keyboard with the project names is also shown.
- Persian spelling differences are ignored: `پارسـيان 1`, `ساختمان‌نگین` and `اسمان` all match.
- **Switching projects mid-conversation:** if the user names another active project during a chat
  ("I meant Narestan 5"), the conversation switches to that project and sends its fresh greeting;
  if the name matches several projects, the bot asks "which one?". Numeric answers to the bot's
  questions (`2`) and a project name buried in a long file-info sentence do not trigger a switch.
- **Non-price questions go to the experts:** the bot only produces price estimates; questions like
  "is it good?", "when is delivery?" or "is it worth investing?" are not answered — the user is
  referred to the Diar office experts.
- After the estimate and lead save, the conversation stays open: the user can correct a wrong
  number and **the same sheet row** is updated (no duplicate row is created).
- "Start over", "from the beginning", `/restart` and `/start` open a new conversation.
- If saving the lead to the sheet fails, the user is **never told a false "saved"**; they get an
  error message and can send `retry save`. If `ADMIN_CHAT_ID` is set, the full conversation
  transcript is sent to the admin so customer data is not lost.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "No active project defined" | The `Active?` column is empty or the `Projects` tab has another name | run `npm run doctor` |
| Bot does not know the base price | The price value in the sheet is textual/invalid | doctor reports that exact row |
| "Private key cannot be read" | The key's `\n`s were lost | copy the key fully from the JSON file |
| Sheets 403 error | The sheet was not shared with the service account | add `client_email` as Editor |
| "Service is busy right now" | Gemini quota (429) | set `GEMINI_THINKING_LEVEL=low` or a paid plan |
| Telegram 409 error | Two bot instances running at once | keep only one active service |
| Messages arrive in pieces | Reply longer than 4096 characters | chunked automatically; check logs if not |
| Mini app button missing in Telegram | Menu button not created in BotFather, or Telegram client cache | create it in BotFather; send `/app` to the bot; fully close and reopen Telegram |
| Mini app shows a white page/error | The Telegram URL does not match the real service domain | `MINI_APP_URL` must be exactly `https://domain/app` |
| "Telegram session is not valid" (403) | initData tampered, or the server's `TELEGRAM_BOT_TOKEN` differs from the bot's | set the correct token; user reopens the mini app |
| Mini app returns 403 after a while | initData age exceeded `MINI_APP_INIT_DATA_MAX_AGE_SECONDS` | close and reopen the mini app (or raise the limit) |
| Mini app leads have no phone | The user tapped "continue without a number" | the bot asks for the number in chat at the end |

---

## Version 1.3 changes

- **Always-visible project search** in the mini app, with Persian-aware normalization (Arabic
  ya/kaf, Latin digits, half-space, tatweel and diacritics) over project names and fields.
- **Minimal animations** with three motifs — construction (cards rise like floors, a crane sways
  while loading), deal (sliding tab indicator, a signature written on the contract, a drawn saved
  checkmark) and money (price chip with a spinning coin and counting digits). All disabled under
  `prefers-reduced-motion`.
- **Project switching mid-chat** and referral of **non-price questions** to the office experts.
- **Version stamp** in `/api/miniapp-status` (`build`: package version, mini-app file fingerprint,
  Railway branch/commit/deployment) so it is always possible to tell which version is live.
- **Mini app entry is fully manual in BotFather**: the service no longer registers or overwrites
  the menu button and no longer puts an entry button under messages; `/app` sends the URL as plain
  text. A scheme-less `MINI_APP_URL` is completed with `https://` automatically, and a non-HTTPS
  URL can no longer take down whole bot messages.

## Version 1.2 changes

- **Telegram mini app** (`/app`): two sparse, minimal sections — a clickable project list with
  price estimates, and chat with the same bot. Colors from Telegram's own theme, dark mode support,
  back button and haptic feedback.
- Server-side verification of Telegram `initData` (`src/miniapp.js`); the session key is derived
  from the Telegram user id so closing and reopening the mini app preserves the half-finished
  conversation and contact info.
- New API routes: `/api/projects`, `/api/state`, `/api/select`, `/api/contact`; and `initData`
  accepted by `/api/message` and `/api/reset` (previous `sessionId` behavior unchanged).
- Definitive project selection by click (`selectProject`) without spending Gemini quota and without
  the risk of a wrong name match.
- Phone normalization (`normalizePhone`) for the mini app form: `+98912…`, `۰۹۱۲ ۱۲۳ ۴۵۶۷` and
  `912…` all become one shape.
- **Information leak fixed:** project lists in API responses (and `/api/reset`) previously returned
  the raw sheet objects including "base price per meter" and the pricing formula; now only `name`
  and `fields` go to the client.
- `npm run miniapp:preview` tool to view and click the mini app without a Gemini key or sheet.
- Tests aligned with current conversation behavior (welcome without a numbered list, and name/phone
  taken from `contact` instead of AI extraction) plus 22 new tests for the mini app and contact;
  66 green tests in total.
- Stable test runs: application logs are silenced during API tests (`test/quiet.mjs`) so they do
  not interfere with the `node:test` reporter protocol.

## Version 1.1 changes

- Migrated from the deprecated `@google/generative-ai` package to the official `@google/genai` SDK.
- Real `systemInstruction` and removal of `temperature` (ignored by `gemini-3.6-flash` and later),
  plus `thinkingLevel` configuration.
- **One** Gemini request per user message instead of three (reply + done-detection + JSON
  extraction); structured output via `responseSchema`, and the conversation history is no longer
  polluted with meta messages.
- Fixed `undefined` in the first message when the fields column was empty.
- Correct parsing of sheet numbers (Persian digits and thousands separators) and field splitting on
  the Persian comma.
- Forgiving sheet header matching with clear reporting of missing columns (instead of silent empty).
- Project selection by list number and normalization of ی/ي, ک/ك and half-space.
- Messages after the conversation ends are no longer dropped, and lead correction is possible.
- Honest lead saving: a sheet write failure = error message to the user + admin alert + retry.
- Telegram long-message chunking, no empty messages, typing indicator renewal, bot error handler,
  and no replies to group messages (unless mentioned).
- Rate limiting and configurable CORS for the web API.
- Added `.gitignore` and `.env.example`, the `npm run doctor` tool, the `/demo` page and 44 tests
  (`npm test`).

---

## Cost and security

- The free Gemini quota is limited (roughly 10 requests per minute and 1500 per day). Since each
  user message costs only **one** request, a full conversation uses about 4 to 6 requests.
- Never commit the `.env` file (it is in `.gitignore`). If it was committed by mistake, **revoke**
  the keys.
- Set `CORS_ORIGIN` to your own domain in production so nobody can burn your quota.
