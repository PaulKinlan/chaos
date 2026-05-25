# CHAOS Channels System

The **Channels System** is the secure, event-driven bridge that connects your isolated Chrome extension agents to the external world. Because browser extensions run on local client machines behind sandboxed networks without public IP addresses or open ports, Chaos relies on a public-facing **Relay Server** (built in Deno and hosted on Deno Deploy) to act as a secure proxy.

This document outlines the detailed architecture, channel routing classifications (One-Way vs. Bidirectional), and deep execution mechanics of our channels, including the **Email Channel** integration.

---

## System Architecture

The system coordinates between three primary actors:
1. **The External Source**: Any external platform (Telegram, GitHub webhooks, Discord, Inbound Email) sending events.
2. **The Relay Server**: A lightweight, authenticated Deno service backed by Deno KV for sessions, channels, and message persistence.
3. **The Chrome Extension**: The local client runtime running the `agent-do` agent loop, OPFS storage, and Chrome event listeners.

```
 +-----------------+          +-----------------------------------+          +------------------------------+
 | External Source |          | Relay Server (Deno Deploy)        |          | Chrome Extension             |
 |                 |          |                                   |          |                              |
 |   Webhook POST  |          |  POST /webhook/:id                |          |                              |
 |  -------------->|=========>|  1. Validate signature / secret   |          |                              |
 |                 |          |  2. Store in Deno KV              |          |                              |
 |                 |          |  3. Trigger kv.watch()            |          |                              |
 |                 |          |                                   |          |                              |
 |                 |          |  WebSocket: /ws?token=...         |          |  WebSocket Connection        |
 |                 |          |  ================================>|=========>|  - Wakes up BG script        |
 |                 |          |  - Instant push message payload   |          |  - Dispatches to agentic loop|
 |                 |          |                                   |          |                              |
 |                 |          |  WS "reply" or POST /reply        |          |  Agent runs loop (OPFS files)|
 |  Platform Send  |          |  <================================|<=========|  - Sends reply back to Relay |
 |  <--------------|==========|  - Route to Bot API / Resend      |          |                              |
 +-----------------+          +-----------------------------------+          +------------------------------+
```

---

## 1. Channel Routing Classifications

To ensure absolute safety, the Relay Server **only ever routes agent replies back through the exact channel that ingested the original trigger**. The extension dispatches a reply carrying the original `channelId` and `channelType`, which the relay uses to enforce routing boundaries.

Channels are classified into two models based on their platform capabilities:

### A. One-Way (Inbound-Only) Channels
*   **Examples**: Generic HTTP `webhook`.
*   **Inbound Flow**: The external service POSTs JSON payloads to `POST /webhook/{channelId}?token={secret}`. The payload is validated via the token secret, stored in KV, and pushed to the extension.
*   **Outbound Flow**: Because generic webhooks are one-way HTTP pushes, the Relay has no downstream platform endpoint to push replies back to. When the agent produces a reply, the relay merely calls `addResponse(channelId, response)` to store the output in Deno KV. 
*   **Retrieval**: The calling service must poll `GET /responses/{channelId}?since={ISO8601}` to retrieve the agent's replies.

### B. Bidirectional Channels
*   **Examples**: `telegram`, `discord`, `email`.
*   **Inbound Flow**: The platform sends an event (a Telegram update, Discord interaction, or Resend email payload) which the relay captures, sanitizes, and forwards to the extension.
*   **Outbound Flow**: When the agent finishes its loop, the extension sends a reply back to the relay (via WebSocket or `POST /reply`). In addition to storing the response, the relay **immediately dispatches the reply** directly back to the original platform's chat or recipient using its respective API (Telegram Bot API, Discord Bot API, Resend Email API).

---

## 2. Inbound Message Synchronization (Relay -> Extension)

Manifest V3 background service workers (`background.ts`) are frequently terminated by Chrome. Chaos uses a dual-path pipeline to guarantee that triggers are received:

1.  **WebSocket + `kv.watch()` (Active Path)**: When Chrome is running, the extension holds a persistent WebSocket connection to `GET /ws?token={apiKey}`. When a channel receives an inbound message, the relay writes it to Deno KV. Deno’s `kv.watch()` detects the write instantly across server isolates and pushes the message payload down the WebSocket, immediately waking up the background worker.
2.  **Alarm-Based Polling (Fallback Path)**: If the WebSocket disconnects, the relay holds the messages in Deno KV (capped at 100 messages per user, retained for 24 hours). The extension runs a periodic Chrome Alarm that polls `GET /messages?since={last_timestamp}` to sync offline events.

---

## 3. The Email Channel: End-to-End Mechanics

The **Email Channel** is a robust bidirectional bridge built on top of **Resend** (for mail receiving, verification, and dispatch) and **Svix** (for cryptographic webhook signatures verification).

### A. Channel Registration & Verification
1.  **Creation**: When you create an email channel, the relay generates a unique address matching `{channelName}-{randomSuffix}@{domain}` (using `crypto.getRandomValues` to generate a 10-character suffix to prevent address collisions).
2.  **Verification Token**: The relay generates a UUID `verificationToken` and sends an HTML verification email via Resend to your personal email:
    `GET /email/verify?token={token}&channelId={id}`.
3.  **Activation**: Clicking the verification link updates the channel metadata in Deno KV, sets `verified: true`, and adds your verified email address to the channel's `allowedSenders` list.

### B. Inbound Processing (`POST /email/inbound`)
1.  **Svix Signature Verification**: If a `RESEND_WEBHOOK_SECRET` is set, the server verifies the Svix HMAC-SHA256 signature headers (`svix-id`, `svix-timestamp`, `svix-signature`) to guarantee the inbound request originated from Resend.
2.  **Content Ingestion**: The relay parses the Resend inbound payload. Because webhooks sometimes lack full bodies, the relay calls Resend's receiving API (`GET https://api.resend.com/emails/receiving/{emailId}`) to fetch the full text/HTML content and headers.
3.  **Sender Allowlist (`allowedSenders`)**: The relay extracts the sender's email (`from` header) and checks it against the channel's allowlist metadata to silently drop spam.
4.  **Threading Resolution**: The relay parses the email's threading headers:
    *   `Message-ID` (identifies the incoming email).
    *   `In-Reply-To` (indicates the message being replied to).
    *   `References` (the chain of parent emails).
    
    It sets `threadId` to `In-Reply-To` (or `Message-ID` if starting a new thread) and flags `isReply: true` in the message metadata. This allows the extension's agent to maintain cohesive conversation history across email threads.

### C. Outbound Reply (`sendEmailReply`)
When the agent finishes processing and dispatches the reply payload to the relay, the email responder performs a fully threaded email send:
1.  **Metadata Extraction**: It resolves the email channel's metadata (`inboundAddress` or `fromAddress` as the sender, and the user's verified address as the target `toAddress`).
2.  **Subject Construction**: It prefixes the subject with `Re: ` (e.g. `Re: ${originalSubject}`), stripping any existing `Re:` headers to maintain thread structure.
3.  **Threading Headers Injection**: To ensure standard email clients (Gmail, Apple Mail) render the reply inline inside the original conversation thread, the relay injects threading headers:
    *   `In-Reply-To` is set to the original incoming `emailMessageId`.
    *   `References` is appended by adding the incoming `emailMessageId` to the end of the existing `references` chain.
4.  **Resend Send**: Dispatches the fully threaded JSON body with headers to `POST https://api.resend.com/emails`.

---

## 4. Cryptographic Security & Boundaries

Because agents operate on local files inside the extension's OPFS, the relay enforces strict cryptographic security on all management actions:
*   **Bearer Auth**: All standard API endpoints require `Authorization: Bearer {apiKey}`.
*   **ECDSA Request Signing**: Outgoing updates or reply events from the extension are signed using an ECDSA P-256 private key. The relay verifies the signature against the registered public key, checking `X-Timestamp` (strictly within a 5-minute threshold of server time) and `X-Nonce` to protect against replay attacks.
