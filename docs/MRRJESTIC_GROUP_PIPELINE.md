# Mrrjestic Supplier Group Pipeline

## Imported coverage

The linked WhatsApp Business account currently exposes the following readable history:

| Group | Oracle supplier | Readable messages | First readable message | Latest imported message |
| --- | --- | ---: | --- | --- |
| MRR X TYRES ONLINE | TO | 103 | 28 Jul 2026, 13:53 SGT | 25 Aug 2026, 18:39 SGT |
| MRR X ON TYRES | ON | 97 | 5 Aug 2026, 11:21 SGT | 25 Aug 2026, 18:40 SGT |

The first Tyres Online records are two image listings at 13:53, followed by the first text message at 13:54. These are the oldest records supplied to the linked WhatsApp Web session for the two groups. The importer preserves native WhatsApp message IDs, so repeating an import is idempotent rather than creating duplicates.

## What the real conversations show

- Mrrjestic normally asks for a tyre by size, brand, and sometimes model.
- A supplier may reply with one complete block or several short messages such as price, model, and year.
- A supplier may say the requested model is unavailable and then quote an alternative. Only the alternative is recorded.
- One reply can contain several sizes and several models. Each price belongs to the nearest preceding size heading.
- Prices are per piece. Text such as `2pcs` describes available quantity and must not multiply the price.
- `Y25` and `dot25` mean production year 2025. `Y26` and `dot26` mean 2026.
- Commercial formats such as `195R15C` are valid even though they do not contain a profile value.
- The same groups also contain batteries, delivery arrangements, acknowledgements, and ordinary conversation. These are not Oracle tyre-price records.
- Supplier stock images can contain complete quotation listings. Realtime images from approved supplier identities are transcribed first, and the transcription is retained as quotation evidence.

## Conversation patterns handled

| Pattern | Example shape | Pipeline behavior |
| --- | --- | --- |
| Complete quote | size + model + `$price` + year in one reply | Create one review record. |
| Fragmented quote | `$235` → `PS5` → `Yes` after a 2026 question | Join the bounded exchange and create one record only after it settles. |
| Multi-size block | size heading followed by several models, then another size heading | Associate each model with its nearest size heading. |
| Requested item unavailable | `no`, followed by another model and price | Ignore the unavailable item and record only explicit alternatives. |
| Stock broadcast | Unprompted size/model/price list | Record explicit items as unsolicited supplier stock quotations. |
| Quantity fragment | `left 1pc only $165` | Store quantity as availability evidence; keep `$165` as the per-piece price. |
| Supplier image | Screenshot/photo containing readable listings | Transcribe visible text, then apply the same evidence and validation rules. |
| Order or logistics | `send 2pc`, address, driver, collection, thanks | Store the chat message but do not create a quotation update. |
| Unsupported product | Battery, rim, service, or delivery quote | Store the chat message but do not send it to the new-tyre write endpoint. |

## Processing flow

1. Store every monitored message with its native WhatsApp ID, sender identity, timestamp, source, and group.
2. Ignore quotation triggering when the sender is not one of the supplier identities configured for that group.
3. When a supplier replies, wait for a configurable quiet period. A new supplier fragment resets the timer.
4. Build a bounded session ending at the supplier trigger message. Stop at the nearest relevant requester enquiry and enforce the configured time/message limits.
5. For supplier images, transcribe only visible text and retain it with the message before quotation extraction.
6. Extract only a complete new-tyre quotation that the latest supplier message completes or corrects.
7. Require source evidence for tyre size, supplier price, brand, and model. Reject any generated value that cannot be traced to the bounded session.
8. Reject negative availability, incomplete requests, requester messages, batteries, rims, services, and delivery-only discussion.
9. Normalize size, per-piece price, year, country, quantity, availability, and exact/alternative/broadcast match type.
10. Search Oracle by size, then match normalized brand/model aliases such as `PS5` and descriptive suffixes such as `XL` locally.
11. Place the structured event in the review queue. Automatic publishing remains disabled unless explicitly enabled.
12. Record every settled processing decision in the audit view, including skipped and failed checks with source message IDs.
13. When publishing is enabled or staff approves an event, write it through Oracle's supplier-price endpoint and verify that the returned record appears in API history.

## Safety rules

- Group-to-supplier mapping and sender allowlists are separate. A group supplier code alone is not enough to authorize a message as a supplier quotation.
- Imported history is stored for context and analysis but is not replayed into Oracle automatically.
- A quiet period prevents partial records from fragmented replies and allows corrections to settle.
- A short context window prevents an old quotation from being joined to a later unrelated enquiry.
- Brand, model, size, and price must all pass deterministic source-evidence checks after model extraction.
- Generic per-message extraction is disabled for mapped quotation groups; only the settled, conversation-aware pipeline processes them.
- Oracle read requests retry temporary rate limits and service failures. Price writes are never blindly retried because a timed-out write may already have succeeded.
- Oracle credentials remain server-side and are never returned to the browser.
- The documented Oracle write endpoint accepts new supplier tyre prices. Used-tyre and rim data can be read from Oracle, but this listener does not invent unsupported write operations for them.

## Current group configuration

- `MRR X TYRES ONLINE` maps to supplier `TO`. Its observed supplier identities are the TyresOnline phone JID and its WhatsApp privacy LID.
- `MRR X ON TYRES` maps to supplier `ON`. Its observed supplier identity is the ON Tyres phone JID.
- If WhatsApp changes a supplier from a phone JID to a privacy LID, add the new identity to that group's supplier sender list before relying on automatic synchronization.

## Verified real-history replays

The pipeline was replayed against a temporary copy of the imported database with live Oracle reads and publishing disabled:

- Tyres Online fragmented exchange: Michelin PS5, `235/55R19`, S$235 per piece, 2026. Classified as an existing Oracle listing with no stock.
- ON Tyres complete block: Bridgestone Potenza RE71RS XL, `245/35R19`, S$270 per piece, 2025. Classified as an existing Oracle listing with no stock.
- Tyres Online unavailable-item exchange: the `no` response was ignored and the explicit Michelin PilotSport 5 alternative at S$240 was retained.
- ON Tyres multi-size block: five Michelin/Pirelli items were associated with the correct `275/35R21` and `305/30R21` headings.
- AGM battery and delivery/payment follow-ups produced no Oracle tyre-price events.

These replays write only to a temporary local review database. They do not publish historical supplier messages to Oracle.
