# Channels

Connect external services to your agents -- Telegram, Discord, Email, webhooks, and more.

## What This View Does

Channels bridge your browser-based agents to the outside world. When someone sends a Telegram message, posts to a Discord channel, sends an email, or triggers a webhook, the message reaches your agent through the relay server. The agent can read, process, and reply.

## Relay Server

- Channels connect through a **relay server** that sits between external services and your browser
- Enter your relay server URL and click **Connect** to link up
- A default hosted relay is available, or you can self-host your own
- The relay handles authentication, message queuing, and delivery

## Setting Up a Channel

1. Connect to a relay server (if not already connected)
2. Click **+ Add Channel** and choose a type
3. Follow the setup flow for your chosen service
4. Configure which agent should handle messages from this channel

## Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather) in Telegram
2. Copy the bot token
3. Paste it in the Telegram channel setup
4. Send the pairing code to your bot in Telegram to verify ownership
5. Add allowed users to the allowlist for security

## Discord

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers)
2. Add the bot to your server with message permissions
3. Paste the bot token in the Discord channel setup
4. Complete the pairing flow
5. Configure which channels and users can reach your agent

## Email

1. Choose "Email" as the channel type
2. Enter your email address for verification
3. Click the verification link sent to your inbox
4. The relay generates a unique inbound address for this channel
5. Forward emails to this address, or give it out directly

## Webhooks

- Create a webhook channel for custom integrations
- Any HTTP POST to the webhook URL triggers your agent
- Use webhooks with GitHub, CI/CD systems, monitoring tools, or any service that supports them
- The webhook URL and secret are generated automatically

## Allowlists

- Control who can message your agent through each channel
- Add specific user IDs or chat IDs to the allowlist
- Unknown senders are blocked by default for security
- Each channel has its own independent allowlist

## Tips

- Start with one channel and expand once you see how it works
- Always configure allowlists -- without them, anyone who finds your bot can talk to your agent
- Use the channel prompt to give your agent specific instructions for messages from that source
- Webhook channels are great for automated notifications from CI/CD or monitoring
- Test channels by sending a message and checking that the agent receives and replies to it
