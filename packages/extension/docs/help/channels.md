# Channels

Connect external services to your agents. Channels let agents send and receive messages through Telegram, Discord, Email, webhooks, and more.

### Relay Server
- Channels connect through a relay server that bridges your browser to external services
- Enter your relay server URL and click **Connect**
- The default relay is provided, or run your own

### Setting Up a Channel
1. Connect to a relay server
2. Click **+ Add Channel** and choose a type
3. Follow the pairing flow for your chosen service

### Telegram
- Create a Telegram bot via @BotFather
- Paste the bot token and pair it through the relay
- Your agent can then send and receive Telegram messages

### Discord
- Create a Discord bot in the Developer Portal
- Add the bot to your server and paste the token
- Messages in allowed channels reach your agent

### Webhooks
- Create a webhook channel for custom integrations
- Any HTTP POST to the webhook URL triggers your agent

### Allowlists
- Control who can message your agent through each channel
- Add specific user IDs or chat IDs to the allowlist
- Block unknown senders by default for security
