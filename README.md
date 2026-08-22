# WhatsApp Real-Time Group Chat Reader & LLM Extractor 🚀

A robust, real-time software application that reads messages from chosen WhatsApp group chats (text, images, and documents like PDFs/DOCXs), passes them through a multimodal LLM extraction pipeline (Google Gemini, OpenAI, Anthropic, or local Ollama), stores structured data in SQLite, and provides a modern web dashboard.

---

## Features

- **Real-time Group Chat Reader**: Direct WebSocket protocol reader built with `@whiskeysockets/baileys`.
- **Multimodal & Document Support**: Downloads images and documents (PDF, DOCX, CSV, TXT) automatically for OCR and LLM analysis.
- **Multi-Provider LLM Engine**: Supports Google Gemini (`gemini-2.0-flash`), OpenAI (`gpt-4o`/`gpt-4o-mini`), Anthropic (`claude-3-5-sonnet`), and local Ollama (`qwen2.5`/`llama3`).
- **Customizable Schemas**: Define custom JSON fields and instructions per group chat (e.g. Lead Generation, Issue Tracker, Expense Monitor, Action Items).
- **SQLite Data Store**: Retains all raw messages, media paths, and structured JSON extractions locally.
- **Modern Web Dashboard**: QR code pairing modal, group monitor toggles, live stream console, database explorer, and CSV/JSON export.

---

## Quick Start

### 1. Launch the Application
Open a terminal in this directory and run:
```bash
npm start
```
*(Or run `npm run dev` for hot-reloading dev mode)*

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
5. Once paired, connection state will turn green (**CONNECTED**), and your participating group chats will automatically load into the **Monitored Groups** tab!

### 4. Configure LLM API Keys
1. Click the **LLM Settings** tab in the dashboard.
2. Enter your API Key (e.g. Google Gemini or OpenAI) or set your local Ollama URL.
3. Click **Save Configurations**.

### 5. Monitor & Extract Data
1. Go to **Monitored Groups** tab and toggle ON real-time monitoring for your target group chat(s).
2. Assign your preferred **Extraction Schema** (e.g., General Summary, Sales Leads, Bug Reports).
3. Switch to the **Live Stream** tab to watch incoming group messages get parsed into structured JSON in real-time!
4. Explore and export stored records anytime under the **Extractions Data** tab.

---

## Recommended Security & Safety Guidelines

- **Use a Secondary SIM / Phone Number**: Always host the WhatsApp bot using a dedicated secondary SIM card to protect your primary personal account.
- **Read-Only Operation**: Keep the bot passive (reading and extracting data only) rather than sending automated messages.
