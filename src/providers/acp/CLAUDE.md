# ACP Provider

Adaptor for Agent Client Protocol (ACP) agents via stdio JSON-RPC 2.0.

## Protocol Overview

ACP is a standardized JSON-RPC 2.0 protocol for agent-editor communication, similar to LSP for language servers. The ACP provider enables Claudian to connect to any ACP-compatible agent.

The protocol uses:
- **Startup handshake**: client sends `initialize`, receives server capabilities
- **Client → Server** (request/response): `chat/send`, `tools/list`, `shutdown`
- **Server → Client** (notifications): streaming deltas, tool events, `chat/messageStop`
- **Server → Client → Server** (server requests): tool approval gates, user input requests

## Design Decisions

### Transport Layer

The stdio transport (`AcpStdioTransport`) is adapted from `CodexRpcTransport` since both use JSON-RPC 2.0 over newline-delimited JSON. This provides a proven pattern for:
- Request/response correlation
- Timeout handling
- Notification routing
- Server request (bidi-rpc) handling

### Provider State

ACP agents are stateless from Claudian's perspective. The `providerState` only stores the `sessionId` for tracking active conversations. Agent-managed history and session persistence are handled by the agent itself.

### MVP Scope

The initial implementation (Phase 1) supports:
- Text streaming via `chat/textDelta` notifications
- Basic tool use (approval, execution, result)
- stdio transport for local agents

Future phases will add:
- HTTP/WebSocket transport for remote agents
- Multi-agent configuration
- Agent capability discovery
- Session persistence

## Built-in Agents

The ACP provider includes pre-configured agent templates for popular CLI tools:

### Gemini CLI

- **Type**: `gemini-cli`
- **Command**: `gemini app-server`
- **Transport**: stdio
- **Discovery**: Auto-detected in PATH or via custom path
- **WSL Variant**: `gemini-cli-wsl` with `GEMINI_USE_WSL=1` environment variable

Built-in agents can be added via the "Quick add built-in agents" section in settings.

## Non-Obvious Behaviors

### Agent Configuration

ACP agents are configured in settings under `acp.agents`. Each agent has:
- `id`: Unique identifier
- `name`: Display name in UI
- `transportType`: 'stdio' | 'http' | 'websocket'
- `command`/`args`/`env`: For stdio agents
- `url`/`headers`: For HTTP/WebSocket agents (future)

The `defaultAgentId` setting determines which agent is active by default.

### Chunk Buffering

Similar to Codex, the runtime uses a chunk buffer pattern:
- Notifications push chunks to `chunkBuffer`
- The `query()` generator drains the buffer
- `chunkResolve` unblocks the drain loop when new chunks arrive

### Tool Approval Mapping

ACP uses `allow`/`deny`/`allow-always` decisions. Claudian's `ApprovalDecision` is mapped as:
- `allow` or `allow-always` → `allow`
- `deny` or `cancel` → `deny`

### User Input Questions

ACP's `user/requestInput` uses question IDs. Claudian's `AskUserQuestionCallback` expects a `Record<string, unknown>`, so the router converts between formats.

## Gotchas

- `AcpChatRuntime` is a minimal MVP implementation—many `ChatRuntime` methods are no-ops or return stub values
- Tool result interpretation is minimal—ACP doesn't have the same async agent pattern as Claude
- The settings reconciler only invalidates conversations when the configured agent is removed
- HTTP/WebSocket transport is stubbed for future implementation
- Built-in agents are templates - the CLI binary path is resolved at runtime from PATH or custom configuration
- If the Gemini CLI binary is not found, the agent will fail to start with a "command not found" error
- The WSL variant requires WSL to be properly configured on Windows
