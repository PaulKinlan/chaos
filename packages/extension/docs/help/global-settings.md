# Global Settings

Configure providers, API keys, appearance, and permissions that apply to all agents.

## What This View Does

Global Settings controls the system-wide configuration for CHAOS. API keys, default models, theme preferences, and permission policies are all managed here. These settings apply to every agent unless an individual agent overrides them.

## Providers and API Keys

- Select your active AI provider: Anthropic (Claude), Google (Gemini), OpenAI, OpenRouter, or Ollama
- Enter your API key for the selected provider
- Keys are stored locally in your browser -- they are never sent anywhere except directly to the provider's API
- You can configure multiple providers and switch between them
- Ollama runs locally and does not require an API key

### Getting API Keys

| Provider | Where to Get a Key |
|----------|-------------------|
| Anthropic | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| Google | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) |
| Ollama | Install from [ollama.ai](https://ollama.ai) -- no key needed |

## Model Selection

- Choose which model to use from the provider's available options
- More capable models cost more per token but handle complex tasks better
- The selected model is the default for all agents unless overridden in agent settings

## Theme

- Switch between **Light**, **Dark**, and **System** themes
- The system option follows your operating system preference
- Theme applies across all CHAOS views

## Permissions

- Control what agents can do by default
- **Auto-approve** lets agents act without asking for confirmation
- **Ask every time** requires your confirmation before each action
- **Deny** blocks the action entirely
- Permissions can be set per action type (e.g., allow tab reading but require approval for downloads)

## Archived Agents

- View and restore previously archived (hidden) agents
- Archived agents keep all their data but do not appear in the active sidebar
- Restore an agent to make it active again

## Debug Panel

- Access diagnostic information about the extension
- View logs, connection status, and internal state
- Useful for troubleshooting issues or reporting bugs

## Re-Run Setup Wizard

- Click to re-run the initial onboarding wizard
- Useful if you want to reconfigure your provider or walk through the setup again

## Tips

- Test your API key by sending a message in Chat after entering it
- Start with a mid-range model and upgrade if you need more capability
- Use Auto-approve for trusted actions (reading tabs) and Ask for sensitive ones (making requests)
- If agents are slow, check that your provider is not rate-limiting you
- The debug panel is your first stop when something is not working as expected
