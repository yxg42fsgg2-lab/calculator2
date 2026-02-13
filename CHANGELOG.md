# Changelog

## 0.1.0 — Initial Port

Complete 1:1 port of Zed's AI coding agent backend from Rust to TypeScript.

### Core Library (`@anthropic/zed-agent-core`)

#### Types
- Branded ID types (SessionId, ToolCallId, UserMessageId, etc.)
- 18 completion error types with full HTTP status mapping
- 13 AgentEvent types for UI communication
- 8 BackendHost sub-interfaces
- Language model types (request, response, completion events)
- Tool types (AgentTool, ToolCallEventStream, permissions)
- Settings types (profiles, permissions, model selection)

#### Language Models
- `LanguageModel` interface (stream completion, token counting, capabilities)
- `LanguageModelProvider` interface (model listing, authentication)
- `LanguageModelRegistry` (provider management, model selection)
- `RateLimiter` (semaphore-based concurrent request limiting)
- Tool schema adaptation for different provider formats

#### Providers (13)
- Anthropic (full streaming, thinking/extended thinking, cache control)
- OpenAI (streaming tools, reasoning effort for o3)
- Google AI (Gemini, 1M context, thinking)
- Ollama (auto-discovery via /v1/models)
- LM Studio (auto-discovery)
- DeepSeek (V3 + R1 thinking)
- OpenRouter (model discovery)
- xAI (Grok 3)
- Mistral (Large, Small, Codestral)
- GitHub Copilot Chat
- AWS Bedrock
- Vercel AI
- Zed Cloud (SSE streaming, queue positions, upstream routing)

#### Tools (19 implementations)
- `read_file` — with line ranges, outline fallback, mtime tracking
- `edit_file` — EditAgent-powered (secondary LLM call for diffs)
- `streaming_edit_file` — direct search/replace in tool input
- `grep` — regex search with pagination
- `find_path` — glob matching with pagination
- `list_directory` — with filtering
- `terminal` — timeout, kill, output limits, user cancellation
- `fetch` — HTML→Markdown, JSON formatting
- `web_search` — via WebSearchProvider
- `diagnostics` — LSP integration
- `create_directory`, `delete_path`, `move_path`, `copy_path`
- `save_file`, `restore_file_from_disk`
- `now` — current datetime
- `open` — UI file open event
- `subagent` — child thread execution with summary

#### EditAgent Sub-system
- `EditParser` (XML tags + diff-fenced formats)
- `CreateFileParser` (code fence extraction)
- `StreamingFuzzyMatcher` (DP-based with Zed's cost model)
- `StreamingDiff` (LCS-based line diff)

#### Agentic Loop (Thread)
- send / resume / cancel / truncate
- Streaming completion with parallel tool dispatch
- Retry with exponential backoff (18 error types mapped)
- Context tags (files, directories, symbols, selections, fetch, rules, diagnostics)
- LLM-powered title and summary generation
- Profile-based tool filtering
- Thread serialization (toDb / fromDb / replay)
- Markdown export (toMarkdown)
- Token usage tracking
- Stale file detection (mtime comparison)

#### Session Management
- `AgentSession` (thread lifecycle, model switching, auto-save)
- `createAgentSession()` factory
- Settings loader (JSON config matching Zed's format)
- SubagentTool auto-wiring

#### Persistence
- SQLite via better-sqlite3
- Thread save/load/list/delete with Map serialization

#### Permission Engine
- Shell command parser (&&, ||, ;, |, quotes, escapes, parentheses)
- Pattern extraction (terminal commands, file paths, URLs)
- Always allow/deny rules with regex matching
- Sub-command validation for compound shell commands

#### Templates (5)
- System prompt (1:1 Handlebars port with or/gt/len/contains helpers)
- XML edit prompt
- Diff-fenced edit prompt
- Create file prompt
- Diff judge prompt

#### MCP Integration
- `ContextServerRegistry` for external MCP server tools and prompts

### Node.js Host (`@anthropic/zed-agent-host-node`)
- `NodeFileSystem` (read/write/grep/findPath/outline/buffer)
- `NodeTerminalProvider` (child_process with PTY-like behavior)
- `NodeProjectInfo` (workspace roots, rules files, OS/shell detection)
- `NodePermissionHandler` (auto-allow or callback-based)
- `NodeHttpClient` (native fetch)
- `createNodeHost()` factory

### Demo (`@anthropic/zed-agent-demo`)
- Interactive CLI with REPL
- Mock mode (no API key needed — scripted tool calls)
- Anthropic and OpenAI support
- Colorized terminal output
