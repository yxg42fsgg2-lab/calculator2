# zed-agent — Pluggable AI Coding Agent Backend

A complete, faithful, 1:1 port of [Zed](https://github.com/zed-industries/zed)'s AI coding agent backend into a standalone, framework-agnostic TypeScript library. Plug it into any UI by implementing the `BackendHost` interface.

[![Tests](https://img.shields.io/badge/tests-331_passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-18.5K_LOC-blue)]()
[![License](https://img.shields.io/badge/license-GPL--3.0-orange)]()

## What This Is

Zed's agent backend (~50,000 lines of production Rust) ported to TypeScript as a pluggable library. It provides:

- **The agentic loop** — send message → model streams → tools execute → loop until done
- **18 built-in tools** — read_file, edit_file, grep, terminal, diagnostics, and more
- **13 LLM providers** — Anthropic, OpenAI, Google, Ollama, and 9 others
- **Full retry/error handling** — exponential backoff, 18 error types mapped
- **Persistence** — SQLite thread storage with save/load/replay
- **Permission system** — always_allow/deny rules with shell command parsing
- **1:1 system prompt** — Handlebars template matching Zed's exact output

Any UI can integrate by implementing `BackendHost` (~200 LOC minimum).

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
        │   @anthropic/zed-agent-core  │
        │                              │
        │  AgentSession                │
        │    ├── Thread (agentic loop) │
        │    │    ├── 18 Tools         │
        │    │    ├── EditAgent         │
        │    │    ├── System Prompt    │
        │    │    └── Permissions      │
        │    ├── ThreadsDatabase       │
        │    └── 13 Providers          │
        └──────────────────────────────┘
```

## Quick Start

```typescript
import { createAgentSession, AnthropicProvider } from '@anthropic/zed-agent-core';
import { createNodeHost } from '@anthropic/zed-agent-host-node';

// 1. Create a host
const host = createNodeHost({
  workspaceRoots: ['/path/to/project'],
  eventSink: {
    emit(event) {
      if (event.type === 'agent_text') process.stdout.write(event.text);
      if (event.type === 'tool_call') console.log(`[Tool: ${event.toolName}]`);
    },
  },
});

// 2. Create a session
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const session = createAgentSession(host, {
  model: provider.providedModels()[0],
  databasePath: './threads.db', // optional persistence
});

// 3. Send messages
await session.send('Read the README and summarize the project.');
```

## Packages

| Package | Description |
|---------|------------|
| `@anthropic/zed-agent-core` | The pluggable backend library |
| `@anthropic/zed-agent-host-node` | Reference Node.js host implementation |
| `@anthropic/zed-agent-demo` | Interactive CLI demo (works without API key!) |

## Tools (18 built-in + StreamingEditFileTool)

| Tool | Kind | Description |
|------|------|-------------|
| `read_file` | read | Read files with line ranges and large-file outline fallback |
| `edit_file` | write | Create/edit/overwrite files via EditAgent (secondary LLM calls) |
| `grep` | read | Regex content search with pagination |
| `find_path` | read | Glob-based file finding |
| `list_directory` | read | Directory contents listing |
| `terminal` | execute | Shell command execution with timeout/cancel |
| `fetch` | fetch | HTTP fetch with HTML→Markdown conversion |
| `web_search` | fetch | Web search (requires WebSearchProvider) |
| `diagnostics` | read | LSP diagnostics |
| `create_directory` | write | Directory creation |
| `delete_path` | write | File/directory deletion |
| `move_path` | write | Move/rename |
| `copy_path` | write | Copy |
| `save_file` | write | Save buffer to disk |
| `restore_file_from_disk` | write | Reload from disk |
| `now` | other | Current datetime |
| `open` | other | Request UI to open a file |
| `subagent` | other | Spawn child agent thread |

## Providers (13)

| Provider | Models | Features |
|----------|--------|----------|
| **Anthropic** | Claude Sonnet 4, Opus 4, Haiku 3.5 | Thinking, images, streaming tools, cache control |
| **OpenAI** | GPT-4o, GPT-4o Mini, o3, o3-mini | Reasoning effort, streaming tools |
| **Google AI** | Gemini 2.5 Pro/Flash, 2.0 Flash | 1M context, thinking |
| **Ollama** | Auto-discovered local models | Local inference |
| **LM Studio** | Auto-discovered local models | Local inference |
| **DeepSeek** | V3, R1 (thinking) | Via API |
| **OpenRouter** | 100+ models | Via API |
| **xAI** | Grok 3, Grok 3 Mini | Via API |
| **Mistral** | Large, Small, Codestral | Via API |
| **Copilot** | GPT-4o, Claude 3.5, o3-mini | Via GitHub |
| **Bedrock** | Claude, Llama, Mistral | Via AWS |
| **Vercel** | Auto-discovered | Via Vercel AI |
| **Zed Cloud** | Claude, GPT-4o, Gemini | Via Zed API |

## BackendHost Interface

To plug in a custom UI, implement `BackendHost`:

| Interface | Required? | Used By |
|-----------|-----------|---------|
| `FileSystem` | **Yes** | read/edit/grep/find/list/create/delete/move/copy/save tools |
| `TerminalProvider` | **Yes** | terminal tool |
| `ProjectInfo` | **Yes** | System prompt (workspace roots, OS, shell) |
| `PermissionHandler` | **Yes** | Tool authorization |
| `EventSink` | **Yes** | All agent events (text, tools, errors) |
| `HttpClient` | **Yes** | fetch tool |
| `DiagnosticsProvider` | No | diagnostics tool |
| `WebSearchProvider` | No | web_search tool |

## Statistics

| Metric | Count |
|--------|-------|
| TypeScript LOC | 18,500+ |
| Production LOC | 13,800+ |
| Test LOC | 4,700+ |
| Tests | 331 passing |
| Test Suites | 33 |
| Files | 112 |
| Providers | 13 |
| Tools | 19 implementations |
| Templates | 5 (system + 4 edit) |
| Commits | 45+ |

## Documentation

- [Architecture Guide](docs/ARCHITECTURE.md) — system overview, data flow, interface guide
- [Quick Start](docs/QUICK_START.md) — 5-minute setup
- [Integration Examples](docs/EXAMPLES.md) — terminal bot, React hook, custom tool, MCP, persistence

## Try the Demo

```bash
npm install
npm run build

# With API key (real completions):
ANTHROPIC_API_KEY=sk-... node packages/zed-agent-demo/dist/index.js /path/to/project

# Without API key (mock mode — demonstrates tool execution):
node packages/zed-agent-demo/dist/index.js /path/to/project
```

## License

GPL-3.0-or-later (matching Zed's license)
