# Integration Examples

## Terminal Chat Bot

A complete example of a terminal-based agent chat using the Node.js host:

```typescript
import { createAgentSession, AnthropicProvider, type AgentEvent } from '@anthropic/zed-agent-core';
import { createNodeHost } from '@anthropic/zed-agent-host-node';
import * as readline from 'node:readline';

// 1. Create event handler
const eventSink = {
  emit(event: AgentEvent) {
    switch (event.type) {
      case 'agent_text':
        process.stdout.write(event.text);
        break;
      case 'agent_thinking':
        process.stdout.write(`\x1b[2m${event.text}\x1b[0m`); // dim
        break;
      case 'tool_call':
        console.log(`\n🔧 ${event.toolName}: ${event.title}`);
        break;
      case 'tool_call_update':
        if (event.fields.status === 'completed')
          console.log('   ✓ Done');
        break;
      case 'stop':
        console.log('');
        break;
      case 'error':
        console.error(`\n❌ ${event.error.message}`);
        break;
    }
  },
};

// 2. Create host + session
const host = createNodeHost({
  workspaceRoots: [process.cwd()],
  eventSink,
});

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});
const model = provider.providedModels()[0]!;

const session = createAgentSession(host, {
  model,
  databasePath: '.agent-threads.db',  // persist conversations
});

// 3. Chat loop
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = () => rl.question('\n> ', async (input) => {
  if (input === 'quit') { session.close(); rl.close(); return; }
  await session.send(input);
  ask();
});
ask();
```

## React Integration

Minimal React hook for using the agent:

```typescript
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  createAgentSession,
  AnthropicProvider,
  type AgentSession,
  type AgentEvent,
  type BackendHost,
} from '@anthropic/zed-agent-core';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function useAgent(host: BackendHost, apiKey: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentText, setCurrentText] = useState('');
  const sessionRef = useRef<AgentSession | null>(null);

  useEffect(() => {
    // Override the event sink to capture events
    const wrappedHost: BackendHost = {
      ...host,
      events: {
        emit(event: AgentEvent) {
          switch (event.type) {
            case 'agent_text':
              setCurrentText(prev => prev + event.text);
              break;
            case 'stop':
              setCurrentText(prev => {
                if (prev) {
                  setMessages(msgs => [...msgs, { role: 'assistant', content: prev }]);
                }
                return '';
              });
              setIsLoading(false);
              break;
            case 'error':
              setIsLoading(false);
              break;
          }
          // Forward to original sink
          host.events.emit(event);
        },
      },
    };

    const provider = new AnthropicProvider({ apiKey });
    const model = provider.providedModels()[0]!;
    sessionRef.current = createAgentSession(wrappedHost, { model });

    return () => sessionRef.current?.close();
  }, [host, apiKey]);

  const send = useCallback(async (text: string) => {
    if (!sessionRef.current) return;
    setMessages(msgs => [...msgs, { role: 'user', content: text }]);
    setIsLoading(true);
    setCurrentText('');
    await sessionRef.current.send(text);
  }, []);

  return { messages, currentText, isLoading, send };
}
```

## Custom Tool

Adding a custom tool that queries a database:

```typescript
import {
  createAgentSession,
  eraseToolType,
  type AgentTool,
  type AgentToolOutput,
  type ToolContext,
} from '@anthropic/zed-agent-core';
import { createNodeHost } from '@anthropic/zed-agent-host-node';

// Define the tool
const queryDbTool: AgentTool<{ sql: string }, string> = {
  name: 'query_database',
  kind: 'read',

  description: () =>
    'Execute a read-only SQL query against the project database.',

  inputSchema: () => ({
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'The SQL query to execute (SELECT only).',
      },
    },
    required: ['sql'],
  }),

  initialTitle: (input) => input?.sql ?? 'Query database',

  async run(input, context) {
    // Validate: only allow SELECT
    if (!input.sql.trim().toUpperCase().startsWith('SELECT')) {
      throw new Error('Only SELECT queries are allowed');
    }

    // Execute query (your database here)
    const results = await executeQuery(input.sql);
    const text = JSON.stringify(results, null, 2);

    return {
      llmOutput: { type: 'text', text },
      rawOutput: results,
    };
  },
};

// Use it
const host = createNodeHost({
  workspaceRoots: ['.'],
  eventSink: { emit: (e) => { /* ... */ } },
});

const session = createAgentSession(host, {
  model: myModel,
  customTools: [eraseToolType(queryDbTool)],
});

// The agent can now query your database when needed
await session.send('How many users signed up this month?');
```

## MCP Server Integration

Connecting an external MCP (Model Context Protocol) server:

```typescript
import {
  createAgentSession,
  ContextServerRegistry,
} from '@anthropic/zed-agent-core';

// Create MCP registry with executor
const mcpRegistry = new ContextServerRegistry(async (serverId, toolName, input) => {
  // Route to your MCP server
  const response = await fetch(`http://localhost:3001/tools/${toolName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server_id: serverId.id, input }),
  });
  return response.json();
});

// Register tools from the MCP server
mcpRegistry.registerServerTools({ id: 'my-mcp-server' }, [
  {
    name: 'search_docs',
    description: 'Search the documentation',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
]);

// Add MCP tools to the session
const session = createAgentSession(host, { model });
const thread = session.createThread();

// Register MCP tools
for (const [, tools] of mcpRegistry.servers()) {
  for (const [, tool] of tools) {
    thread.addTool(tool);
  }
}

await thread.send([{ type: 'text', text: 'Search the docs for auth setup' }]);
```

## Persistence and Thread Management

```typescript
import { createAgentSession } from '@anthropic/zed-agent-core';

const session = createAgentSession(host, {
  model,
  databasePath: './my-agent.db',
});

// Create and use a thread
await session.send('Help me refactor auth.ts');

// List all saved threads
const threads = session.listThreads();
console.log('Saved threads:', threads.map(t => `${t.id}: ${t.title}`));

// Load a previous thread
const oldThread = session.getThread(threads[0].id);
if (oldThread) {
  // Replay events for UI
  const events = oldThread.replay();
  events.forEach(e => renderEvent(e));

  // Continue the conversation
  await oldThread.send([{ type: 'text', text: 'Continue from where we left off' }]);
}

// Export as markdown
const thread = session.getOrCreateActiveThread();
const markdown = thread.toMarkdown();
await fs.writeFile('conversation.md', markdown);

// Clean up
session.close();
```

## Settings Configuration

```typescript
import { createAgentSession, loadSettingsFromJson } from '@anthropic/zed-agent-core';
import * as fs from 'node:fs';

// Load from a Zed-compatible settings file
const settingsJson = fs.readFileSync('./agent-settings.json', 'utf-8');
const settings = loadSettingsFromJson(settingsJson);

// Settings file format:
// {
//   "agent": {
//     "default_model": {
//       "provider": "anthropic",
//       "model": "claude-sonnet-4-20250514",
//       "enable_thinking": true,
//       "effort": "medium"
//     },
//     "profiles": {
//       "coding": {
//         "tools": { "web_search": false }
//       }
//     },
//     "tool_permission_mode": "custom",
//     "always_allow": [
//       { "tool": "terminal", "pattern": "^cargo" },
//       { "tool": "read_file" }
//     ]
//   }
// }

const session = createAgentSession(host, { model, settings });
```
