# Architecture Guide

This document explains how the zed-agent-core library is structured and how to plug it into any UI.

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                      YOUR UI                             │
│  (React, Svelte, Terminal, Electron, Tauri, etc.)        │
│                                                          │
│  1. Implement BackendHost interface                      │
│  2. Call createAgentSession(host, { model })             │
│  3. Listen for AgentEvents on the EventSink              │
│  4. Call session.send("user message")                    │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────▼──────────────────┐
          │       @anthropic/zed-agent-core  │
          │                                  │
          │  AgentSession                    │
          │    ├── Thread (agentic loop)     │
          │    │    ├── LanguageModel        │
          │    │    ├── Tools (18 built-in)  │
          │    │    ├── EditAgent            │
          │    │    ├── Permissions          │
          │    │    └── System Prompt        │
          │    ├── ThreadsDatabase           │
          │    └── ModelRegistry             │
          └──────────────────────────────────┘
```

## Data Flow

### Sending a Message

```
session.send("Fix the bug in auth.ts")
  │
  ├── 1. Thread.send() — adds UserMessage to history
  │
  ├── 2. Thread.runTurn() — starts the agentic loop
  │     │
  │     ├── 3. buildCompletionRequest()
  │     │     ├── System prompt (Handlebars template)
  │     │     ├── Message history (with context tags)
  │     │     └── Tool definitions (filtered by profile)
  │     │
  │     ├── 4. model.streamCompletion(request)
  │     │     └── Streams events: text, thinking, tool_use, stop
  │     │
  │     ├── 5. handleCompletionEvent()
  │     │     ├── text → accumulate + emit AgentTextEvent
  │     │     ├── thinking → accumulate + emit AgentThinkingEvent
  │     │     └── tool_use → dispatch to tool
  │     │
  │     ├── 6. Tool execution (if tool_use)
  │     │     ├── Permission check → auto/confirm/deny
  │     │     ├── tool.run(input, context)
  │     │     ├── Emit ToolCallEvent + ToolCallUpdateEvent
  │     │     └── Collect LanguageModelToolResult
  │     │
  │     └── 7. Loop: if tools were called, go to step 3 with tool results
  │            Otherwise, end turn → emit StopEvent
  │
  └── 8. Return StopReason
```

### Event Flow

Every action emits events through the `BackendHost.events.emit()` sink:

```
AgentEvent union type:
  ├── user_message      — user submitted a message
  ├── agent_text        — model streaming text
  ├── agent_thinking    — model streaming reasoning
  ├── tool_call         — tool execution started
  ├── tool_call_update  — tool progress/completion
  ├── tool_call_authorization — needs user permission
  ├── subagent_spawned  — child agent created
  ├── retry             — retrying after error
  ├── stop              — turn ended
  ├── error             — unrecoverable error
  ├── title_updated     — thread title changed
  ├── token_usage_updated — token counts changed
  └── session_list_updated — thread list changed
```

## Implementing BackendHost

The `BackendHost` interface has 8 sub-interfaces. Here's what each does:

### FileSystem (required)

Provides file operations. Used by: read_file, edit_file, grep, find_path, list_directory, create_directory, delete_path, move_path, copy_path, save_file, restore_file.

Key methods:
- `readFile(path)` / `readFileRange(path, start, end)`
- `writeFile(path, content)`
- `grep(options)` — regex search across files
- `findPath(glob)` — glob-based file finding
- `openBuffer(path)` — returns a FileBuffer for in-memory edits

### TerminalProvider (required)

Executes shell commands. Used by: terminal tool.

Key method:
- `createTerminal(options)` → returns `TerminalHandle` with waitForExit/kill/output

### ProjectInfo (required)

Workspace metadata. Used by: system prompt, path resolution.

Key properties:
- `workspaceRoots` — list of workspace root directories
- `os` / `shell` — system info
- `resolveProjectPath(relativePath)` — converts "rootname/file.ts" to absolute path

### PermissionHandler (required)

Tool authorization. Used by: all destructive tools (terminal, edit_file, delete_path, etc.).

Key methods:
- `checkAutoPermission(toolName, inputs)` → allow/deny/confirm
- `requestPermission(request)` → user approval flow

### EventSink (required)

Receives all `AgentEvent`s. This is how the backend communicates with your UI.

Single method:
- `emit(event: AgentEvent)` — called for every event

### HttpClient (required)

HTTP requests. Used by: fetch tool.

Single method:
- `fetch(url, options)` → response

### DiagnosticsProvider (optional)

LSP diagnostics. Used by: diagnostics tool.

### WebSearchProvider (optional)

Web search. Used by: web_search tool.

## Minimal Implementation Example

```typescript
import { createAgentSession, AnthropicProvider, type BackendHost } from '@anthropic/zed-agent-core';

const host: BackendHost = {
  fileSystem: myFileSystem,     // Implement FileSystem interface
  terminal: myTerminal,         // Implement TerminalProvider
  project: {
    workspaceRoots: [{ name: 'myproject', absolutePath: '/path/to/project' }],
    os: 'linux',
    shell: '/bin/bash',
    resolveProjectPath: (p) => `/path/to/project/${p.replace('myproject/', '')}`,
    getShortPath: (p) => p.replace('/path/to/project/', 'myproject/'),
    getRootForPath: () => null,
  },
  permissions: {
    requestPermission: async () => ({ type: 'approved', optionId: 'allow' }),
    checkAutoPermission: () => ({ type: 'allow' }),
    getToolPermissionRules: () => ({ mode: 'auto' }),
  },
  events: {
    emit: (event) => {
      // Render events in your UI
      if (event.type === 'agent_text') process.stdout.write(event.text);
    },
  },
  http: {
    fetch: async (url) => {
      const r = await globalThis.fetch(url);
      return { status: r.status, headers: {}, body: await r.text(), url };
    },
  },
};

const provider = new AnthropicProvider({ apiKey: 'sk-...' });
const model = provider.providedModels()[0]!;
const session = createAgentSession(host, { model });
await session.send('Hello, agent!');
```

## Tools

All 18 built-in tools + the StreamingEditFileTool variant:

| Tool | Kind | What it does |
|------|------|-------------|
| `now` | other | Current datetime |
| `fetch` | fetch | HTTP fetch → Markdown |
| `web_search` | fetch | Web search (needs WebSearchProvider) |
| `read_file` | read | Read file with line ranges and outline fallback |
| `list_directory` | read | List directory contents |
| `find_path` | read | Glob-based file finding |
| `grep` | read | Regex content search |
| `edit_file` | write | Create/edit/overwrite files (uses EditAgent for secondary LLM calls) |
| `create_directory` | write | Create directories |
| `delete_path` | write | Delete files/directories |
| `move_path` | write | Move/rename files |
| `copy_path` | write | Copy files |
| `save_file` | write | Save buffer to disk |
| `restore_file_from_disk` | write | Reload from disk |
| `terminal` | execute | Run shell commands |
| `diagnostics` | read | LSP diagnostics |
| `open` | other | Request UI to open a file |
| `subagent` | other | Spawn child agent thread |

## Persistence

Thread state is automatically saved to SQLite when `databasePath` is provided:

```typescript
const session = createAgentSession(host, {
  model,
  databasePath: '/path/to/threads.db',
});
```

The database stores: messages, token usage, model info, title, summary.

## MCP Integration

External tool servers (MCP) can register tools dynamically:

```typescript
import { ContextServerRegistry } from '@anthropic/zed-agent-core';

const registry = new ContextServerRegistry(async (serverId, toolName, input) => {
  // Execute the MCP tool call
  return await callMcpServer(serverId, toolName, input);
});

registry.registerServerTools({ id: 'my-server' }, [
  { name: 'query_db', description: 'Query the database', inputSchema: {...} },
]);
```

## Provider Setup

12 providers are available:

```typescript
import {
  AnthropicProvider,
  OpenAIProvider,
  GoogleProvider,
  createOllamaProvider,
  createLMStudioProvider,
  createDeepSeekProvider,
  createOpenRouterProvider,
  createXAIProvider,
  createMistralProvider,
  createCopilotProvider,
  createBedrockProvider,
  createVercelProvider,
} from '@anthropic/zed-agent-core';
```
