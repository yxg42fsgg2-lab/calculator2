# zed-agent — Pluggable AI Coding Agent Backend

A complete, faithful, 1:1 port of [Zed](https://github.com/zed-industries/zed)'s AI coding agent backend into a standalone, framework-agnostic TypeScript library.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   YOUR UI                        │
│  (React, Svelte, Terminal, Electron, etc.)       │
│                                                  │
│  Implements: BackendHost interface               │
│  Receives:   AgentEvent stream                   │
└────────────────────┬────────────────────────────┘
                     │
        ┌────────────▼────────────────┐
        │     @anthropic/zed-agent-core│
        │                             │
        │  • AgentSession             │
        │  • Thread (agentic loop)    │
        │  • 18 built-in tools        │
        │  • 14 LLM providers         │
        │  • System prompt templates  │
        │  • Permission engine        │
        │  • Session persistence      │
        └─────────────────────────────┘
```

## Packages

| Package | Description |
|---------|------------|
| `@anthropic/zed-agent-core` | The pluggable backend library |
| `@anthropic/zed-agent-host-node` | Reference Node.js host implementation |
| `@anthropic/zed-agent-demo` | Minimal CLI demo |

## Quick Start

```typescript
import { createAgentSession, type BackendHost, type AgentEvent } from '@anthropic/zed-agent-core';
import { createNodeHost } from '@anthropic/zed-agent-host-node';

// 1. Create a host (implements BackendHost interface)
const host = createNodeHost({
  workspaceRoots: ['/path/to/your/project'],
  eventSink: {
    emit(event: AgentEvent) {
      // Handle events in your UI
      switch (event.type) {
        case 'agent_text':
          process.stdout.write(event.text);
          break;
        case 'tool_call':
          console.log(`\n[Tool: ${event.toolName}] ${event.title}`);
          break;
        case 'stop':
          console.log(`\n[Done: ${event.reason}]`);
          break;
      }
    },
  },
});

// 2. Create a session
const session = await createAgentSession(host, {
  model: yourLanguageModel,
});

// 3. Send messages
await session.send('Read the README and summarize the project.');
```

## Implementing BackendHost

To plug in a custom UI, implement the `BackendHost` interface:

| Capability | Required? | What It Enables |
|-----------|-----------|-----------------|
| `FileSystem` | **Yes** | read_file, edit_file, grep, find_path, list_directory, etc. |
| `TerminalProvider` | **Yes** | terminal tool |
| `ProjectInfo` | **Yes** | System prompt context (workspace roots, OS, shell) |
| `PermissionHandler` | **Yes** | Tool authorization |
| `EventSink` | **Yes** | Receiving all agent events |
| `HttpClient` | **Yes** | fetch tool |
| `DiagnosticsProvider` | No | diagnostics tool |
| `WebSearchProvider` | No | web_search tool |

## Building

```bash
npm install
npm run build
```

## License

GPL-3.0-or-later (matching Zed's license)
