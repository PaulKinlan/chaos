# CHAOS Privacy Policy

## What personal data does CHAOS collect?

CHAOS is primarily a local-first application. The extension itself does not collect or transmit personal data to CHAOS developers or any central server.

**Data created and stored locally:**
- Agent configurations (name, system prompt, model selection)
- Conversation history with agents
- Extension settings and preferences
- API keys for AI providers (entered by the user)
- OAuth tokens for Google services
- Scheduled task definitions and results

## What goes to AI providers?

When you interact with an agent, the following is sent to your configured AI provider (Anthropic, Google, OpenAI, or OpenRouter):

- The agent's system prompt and instructions
- Your messages in the conversation
- Tool results, which may include:
  - Page content from the active tab (when using readability or DOM tools)
  - Screenshots of the active tab (when using screenshot tools)
  - Search results (when using search tools)
- Previous messages in the conversation thread (for context)

**You choose and control which AI provider to use.** CHAOS does not proxy through any intermediary. Your API key connects directly to the provider. Refer to each provider's privacy policy for their data handling practices:
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [Google AI Privacy](https://ai.google.dev/terms)
- [OpenAI Privacy Policy](https://openai.com/privacy)
- [OpenRouter Privacy](https://openrouter.ai/privacy)

## What goes to the relay server?

If you enable the Channels feature (Discord, Telegram, Slack, email, webhooks), the relay server processes:

- Incoming messages from external platforms (content, sender info, timestamps)
- Outgoing replies from your agents
- Channel configuration (bot tokens, webhook URLs, routing rules)

Messages are held temporarily for delivery and are not stored long-term. The relay server does not log message content.

**You can self-host the relay server** to keep all channel data on your own infrastructure.

## What stays local?

- All agent configurations and conversation history
- All API keys and OAuth tokens
- All extension settings
- Page content processed by tools (never persisted beyond the session)
- Scheduled task definitions

## How to delete your data

### Extension data
1. Open the extension options page
2. Use the "Clear All Data" option to wipe all local storage
3. Alternatively, uninstalling the extension removes all associated data automatically

### AI provider data
- Refer to your AI provider's data deletion process
- Revoking your API key prevents further access but may not delete existing logs

### Relay server data
- Disconnect channels from the extension settings to stop message flow
- If self-hosting, you control the server and can delete all data directly
- For the hosted relay server, deleting your account removes all associated channel configurations

### OAuth tokens
- Revoke CHAOS access from your [Google Account Security page](https://myaccount.google.com/permissions)
- Tokens stored locally are deleted when you clear extension data or uninstall

## Third-party services

CHAOS integrates with the following third-party services, each governed by their own privacy policies:

| Service | Purpose | Data shared |
|---------|---------|-------------|
| Anthropic (Claude) | AI agent backend | Prompts, conversation context |
| Google (Gemini) | AI agent backend | Prompts, conversation context |
| OpenAI (GPT) | AI agent backend | Prompts, conversation context |
| OpenRouter | AI provider proxy | Prompts, conversation context |
| Google OAuth | Authentication for Google services | OAuth scopes granted by user |
| Discord API | Channel integration | Messages sent/received |
| Telegram Bot API | Channel integration | Messages sent/received |
| Slack API | Channel integration | Messages sent/received |

CHAOS does not sell, share, or transfer personal data to any third party for advertising or marketing purposes.
