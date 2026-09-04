# WhatsApp Real-Time Chat Reader & Group LLM Extractor 🚀

A real-time application that stores messages from explicitly selected WhatsApp groups and direct-message conversations. Selected group messages can pass through a multimodal LLM extraction pipeline (Google Gemini, OpenAI, Anthropic, or local Ollama); selected DMs are stored without LLM processing.

---

## Features

- **Real-time Group Chat Reader**: Direct WebSocket protocol reader built with `@whiskeysockets/baileys`.
- **Opt-in Direct Messages**: Every DM starts paused. Only DMs selected in the dashboard are persisted, and DM content is not sent to an LLM.
- **Multimodal & Document Support**: Downloads images and documents (PDF, DOCX, CSV, TXT) automatically for OCR and LLM analysis.
- **Multi-Provider LLM Engine**: Supports Google Gemini (`gemini-2.0-flash`), OpenAI (`gpt-4o`/`gpt-4o-mini`), Anthropic (`claude-3-5-sonnet`), and local Ollama (`qwen2.5`/`llama3`).
- **Customizable Schemas**: Define custom JSON fields and instructions per group chat (e.g. Lead Generation, Issue Tracker, Expense Monitor, Action Items).
- **SQLite Data Store**: Retains selected-chat messages, media paths, and group extraction results locally.
- **Protected Supplier Sync**: Imports visible WhatsApp Web history idempotently, waits for fragmented supplier replies to settle, and only accepts quotations from configured supplier identities.
- **Modern Web Dashboard**: QR code pairing modal, separate group and DM selectors, live message stream, database explorer, and CSV/JSON export.

---

## Quick Start

### 1. Launch the Application
Open a terminal in this directory and run:
```bash
npm run setup
npm start
```
The local dashboard is bound to `127.0.0.1` by default and message sending is disabled unless you explicitly set `ALLOW_SEND_MESSAGES=true`.

For perpetual AWS hosting, use the production container, persistent runtime storage, health checks, backups, and single-instance migration procedure in [`deploy/aws/README.md`](deploy/aws/README.md). Do not start AWS with a copied WhatsApp session while the Mac listener is still running.

### 2. Access the Dashboard
Open your browser and navigate to:
```
http://localhost:3000
```

### 3. Connect WhatsApp (Secondary SIM)
1. Click **"Scan QR Code"** or **"Connect WhatsApp"** in the top navigation bar.
2. Open WhatsApp on your secondary phone.
3. Go to **Settings** &rarr; **Linked Devices** &rarr; **Link a Device**.
4. Point your camera at the QR code displayed on the Web Dashboard screen.
5. Once paired, connection state will turn green (**CONNECTED**). Groups appear under **Monitored Groups**, and discovered direct conversations appear under **Selected DMs**; both start paused.

### 4. Configure LLM API Keys
1. Click the **LLM Settings** tab in the dashboard.
2. Enter your API Key (e.g. Google Gemini or OpenAI) or set your local Ollama URL.
3. Click **Save Configurations**.

### 5. Monitor & Extract Data
1. Go to **Monitored Groups** and toggle ON only the target group chat(s). Buffered historical text for those groups is then imported; all other groups remain paused.
2. Assign your preferred **Extraction Schema** (e.g., General Summary, Sales Leads, Bug Reports).
3. Go to **Selected DMs** and enable only the individual conversations you want stored. Any history available in the current in-memory sync buffer is imported; future messages appear in real time.
4. Switch to **Live Stream** to watch messages from selected groups and DMs. LLM extraction remains group-only.
5. Explore and export stored records anytime under the **Extractions Data** tab.

WhatsApp delivers linked-device history as a sync payload before the app can apply per-chat choices. For paused chats, this app keeps only a capped in-memory buffer and does not write message bodies to SQLite. The buffer is cleared on logout or restart.

If this feature is added to a linked device that already completed its initial history sync, the old DM list will not automatically reappear on a normal reconnect. Add a known conversation by phone number, wait for that DM to become active, or perform one fresh re-link. Once a selected DM has a live message anchor, the app also asks the phone for up to 50 older messages through WhatsApp's on-demand history flow.

---

## Recommended Security & Safety Guidelines

- **Use a Secondary SIM / Phone Number**: Always host the WhatsApp bot using a dedicated secondary SIM card to protect your primary personal account.
- **Read-Only Operation**: Keep the bot passive (reading and extracting data only) rather than sending automated messages.
---

## Mrrjestic Supplier Quotation Sync

The real supplier-group message patterns, imported coverage, and pipeline safeguards are documented in [`docs/MRRJESTIC_GROUP_PIPELINE.md`](docs/MRRJESTIC_GROUP_PIPELINE.md).

This local application links one WhatsApp account, listens only to explicitly selected chats, extracts structured supplier information, and stores it in SQLite. It now includes a guarded Mrrjestic quotation pipeline for sending approved new-tyre supplier prices to Oracle.

### Quotation workflow

1. Link the dedicated listener WhatsApp account from the **Quotation Sync** tab. The account must already be a member of the intended supplier groups.
2. Open **Monitored Groups**, sync the group list, and select the matching Oracle supplier for each target group.
3. Enable quotation sync only for verified supplier groups. All other chats remain unread and unstored.
4. The first relevant exchange opens a persistent quotation case. The 45-second quiet period controls when the case is evaluated; it does not close the case.
5. Related late fragments can fill missing brand, model, size, price, supplier quantity, or confirmed ready-stock evidence during the configurable case lifetime (60 minutes by default). Direct WhatsApp replies and the original requester anchor outrank semantic matching; ambiguous matches stop for review.
6. A quotation is prepared for review only when every item has an evidenced brand, model, tyre size, positive per-piece price, and positive supplier stock quantity. Explicit ready-stock confirmation is preferred; a supplier price plus quantity may be treated as an assumed ready-stock draft that MRR staff must verify from the attached transcript before publishing. Preorders and unknown availability remain incomplete.
7. Immediately before publishing, the app searches Oracle by normalized size + brand + model. It targets the matching tyre record for an update or submits the complete product fields to create a new record when no exact match exists.
8. By default, the result waits in **Quotation Review Queue**. Press **Publish** only after checking the supplier, tyre, price, and GST convention.
9. Automatic publishing is a separate setting and should stay off until the real Mrrjestic account and every supplier mapping have been validated.

The current linked account is only a test session. Replacing it removes the local WhatsApp session and requires a fresh QR or pairing code, but it does not erase the database or group mappings.

### Oracle API scope

The supplied Oracle contract supports reading new tyres, used tyres, rims, and suppliers. Its write endpoint upserts supplier-price records for new tyres. The listener forwards the supplier's explicitly quoted quantity and availability as quotation metadata and retains both in its audit database; this does not mutate Mrrjestic's own warehouse inventory count. Used-tyre and rim inventory still require separate Oracle write endpoints.

Oracle credentials are read from server-side environment variables and are never returned to the browser:

```env
ORACLE_PRICING_URL=https://tyre-pricing.onrender.com
ORACLE_API_TOKEN=replace_with_api_token
```

### Safety defaults

- Newly discovered groups are paused.
- Quotation sync requires both monitoring and a valid Oracle supplier mapping.
- Automatic publishing defaults to off.
- Duplicate quotations are blocked using a stable supplier/product/price/quantity/availability/date fingerprint.
- Incomplete or low-confidence quotations are rejected, and every required value—including supplier quantity and ready-stock confirmation—must be traceable to supplier messages.
- Fragmented supplier replies are grouped into a bounded quotation session; mapped groups do not use the generic one-message extractor.
- Incomplete cases persist with their known evidence and explicit missing fields. A later fragment can re-open evaluation even after the quiet-period check has run.
- Case correlation prioritizes a WhatsApp reply target, the same requester anchor, matching tyre evidence, and recency. Two plausible matches are marked ambiguous rather than guessed.
- Corrected candidates supersede unpublished review records for the same case and product. Published prices remain auditable and a correction becomes a newer price record.
- When several supplier fragments settle together, the listener applies the complete batch before automatic publishing. Only candidates still marked ready after corrections and incomplete follow-ups are considered.
- Realtime supplier images are transcribed before the same quotation evidence checks are applied.
- The Processing Audit records completed, skipped, and failed checks with source-message counts and reasons.
- Publication performs a fresh exact Oracle record lookup to avoid creating a duplicate while an item waits for review.
- The server revalidates all mandatory fields at publish time; the dashboard status alone cannot bypass the safety gate.
- A publish is marked successful only after its returned record ID and approved product/price appear in Oracle API history.
