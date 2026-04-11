# Plans

Future work, explorations, and architectural plans for CHAOS.

Each plan is a markdown file exploring a feature or direction. Plans are not commitments - they're thinking tools.

**Last audited: 2026-04-07**

## Status Summary

| Plan | Status | Done | Remaining |
|------|--------|------|-----------|
| [Per-Agent Model Config](per-agent-model-config.md) | **COMPLETE** | All 4 phases | - |
| [Token Usage Tracking](token-usage-tracking.md) | **COMPLETE** | All 4 phases | - |
| [Smart Onboarding](smart-onboarding.md) | **MOSTLY DONE** | Phases 1-4 | Phase 5 (progressive profiling) |
| [Rich Artifacts & Proactive UI](rich-artifacts-and-proactive-ui.md) | **MOSTLY DONE** | Phases 1-4 | Phase 5 (advanced artifact types) |
| [Reactive UI (Lit Components)](reactive-ui.md) | **COMPLETE** | All 8 phases | - |
| [Skills Import](skills-import.md) | **MOSTLY DONE** | Phases 1, 2, 4 | Phase 3 (skill registry/marketplace) |
| [Jobs Board (Master Agent)](jobs-board.md) | **MOSTLY DONE** | Phases 1-4 | Missing: broadcast_message, set_agent_hook, set_agent_schedule tools |
| [External Channels](external-channels.md) | **MOSTLY DONE** | Phases 1-5, auth, persistence, real-time | Phase 6 partial; Discord/Email extension UI missing |
| [Relay Conformance](relay-conformance.md) | **PARTIAL** | Phases 1-2 (OpenAPI spec, test suite) | Phases 3-5 (client SDK spec, self-hosting, reference client) |
| [Agent API Abstraction (SDK)](agent-api-abstraction.md) | **MOSTLY DONE** | Phases 1-6, partial 8-9 | Phase 7 (demo apps), Phase 8 (conformance CLI), Phase 9 (external docs) |
| [Agent Loop Library](agent-loop-library.md) | **PARTIAL** | Phases 1-5 | Phase 6 (multi-agent orchestration), Phase 7 (extension migration), Phase 8 (examples/docs) |
| [Onboarding & Help](onboarding-and-help.md) | **PARTIAL** | Phases 1-2 | Phase 3 (help button UI), Phase 4 (empty states partial), Phase 5 (tooltips) |
| [MCP Integration](mcp-integration.md) | **NOT STARTED** | - | All 5 phases |

## What's Outstanding

### High Priority (affects daily usage)

- **Discord extension UI** — Server-side Discord support is built, but no UI in the extension to set up Discord channels (external-channels Phase 2)
- **Email extension UI** — Server-side Email support is built, but no UI in the extension to set up Email channels (external-channels Phase 4)
- **Help button UI** — Help content files exist for all 10 views (`docs/help/*.md`) but there is no ? button or help panel to surface them (onboarding Phase 3)
- **Missing master tools** — `broadcast_message`, `set_agent_hook`, and `set_agent_schedule` tools were planned but never implemented (jobs-board Phase 2)
- **Rich message formatting per channel** — Channels send plain text; no Discord embeds, Telegram inline keyboards, or HTML email formatting (external-channels Phase 6)

### Medium Priority (valuable but not blocking)

- **MCP Integration** — Entire plan is TODO. Would allow connecting agents to external MCP tool servers and exposing agents as MCP servers to Claude Code/Cursor. Most impactful new feature not yet started.
- **Agent Loop Library migration** — `@chaos/agent-loop` package exists with core functionality, but the extension still uses its own `agentic-loop.ts` and `loop.ts` instead of the library (agent-loop Phase 7)
- **Multi-agent orchestration in agent-loop** — `createOrchestrator()` for master/worker agent delegation not yet built (agent-loop Phase 6)
- **Skill registry/marketplace** — Only curated featured skills exist; no searchable JSON registry or marketplace API (skills-import Phase 3)
- **Advanced artifact types** — PDF rendering, CSV table view, JSON tree viewer, image preview, SVG rendering not yet implemented (rich-artifacts Phase 5)
- **Progressive profiling** — Agent learning from user behavior over first week of use (smart-onboarding Phase 5)
- **File/image handling across channels** — Channels don't handle file attachments or images (external-channels Phase 6)
- **Demo apps for SDK** — No `packages/demo-web/` or `packages/demo-cli/` to prove SDK independence (agent-api Phase 7)
- **Spending alerts** — Global and per-agent spending alerts are implemented, but multi-channel coordination for alerts is not

### Low Priority (nice to have)

- **Self-hosting guide** — Docker image, docker-compose.yml, reverse proxy setup for relay server (relay-conformance Phase 4)
- **Reference client library** — Standalone `@chaos/relay-client` package (relay-conformance Phase 5)
- **Client SDK specification** — Formal documentation of the relay client protocol (relay-conformance Phase 3)
- **SDK conformance CLI** — `@chaos/sdk-conformance` runnable test suite for third-party implementations (agent-api Phase 8)
- **SDK documentation for external developers** — Architecture guide, conformance guide (agent-api Phase 9)
- **Agent loop examples** — CLI agent, web agent, serverless agent quickstart examples (agent-loop Phase 8)
- **Contextual tooltips** — First-time tooltips for UI elements with "don't show again" (onboarding Phase 5)
- **Empty state improvements** — Not all views have action-oriented empty state guidance (onboarding Phase 4)
- **Multi-channel coordination** — Same agent responding coherently across Discord + Telegram + Email (external-channels Phase 6)
