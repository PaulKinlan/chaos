# CHAOS Shared Types

Shared TypeScript type definitions used by both the CHAOS Chrome extension and the relay server.

## Usage

Imported via the `@chaos/shared` path alias configured in each package:

```typescript
import type { ChannelMessage, ChannelConfig } from "@chaos/shared";
```

## Types

### `ChannelMessage`
The message format exchanged between the extension and the relay server. Includes `id`, `channelType`, `channelId`, `from`, `content`, `timestamp`, and optional `metadata`.

### `ChannelResponse`
Outbound reply format sent from the extension through the relay server to an external channel. Includes `channelType`, `channelId`, `content`, optional `replyTo` message ID, and optional `metadata`.

### `ChannelDirection`
`'inbound'` (receive only) or `'bidirectional'` (receive and reply).

### `ChannelConfig`
Channel registration configuration. Defines the channel `id`, `type` (`discord`, `telegram`, `email`, `webhook`, `slack`), `direction`, `agentId`, `enabled` flag, optional `name` and `prompt`, and a `metadata` record for channel-specific data (bot tokens, webhook secrets, allowlists, etc.).

### `RelayPollResponse`
Response from the `/messages` polling endpoint. Contains an array of `ChannelMessage` objects and a `since` timestamp for the next poll.

### `SkillManifest`
Skill definition format shared across the system. Includes `id`, `name`, `description`, and optional `author`, `version`, `tags`, and `source`.

## License

Apache 2.0
