# Quick Start Guide

Get the Zed agent backend running in your project in 5 minutes.

## 1. Install

```bash
npm install @anthropic/zed-agent-core @anthropic/zed-agent-host-node
```

## 2. Create a Host

The host is what connects the agent to your environment:

```typescript
import { createNodeHost } from '@anthropic/zed-agent-host-node';

const host = createNodeHost({
  workspaceRoots: ['/path/to/your/project'],
  eventSink: {
    emit(event) {
      switch (event.type) {
        case 'agent_text':
          process.stdout.write(event.text);
          break;
        case 'tool_call':
          console.log(`\n[Tool: ${event.toolName}] ${event.title}`);
          break;
        case 'tool_call_update':
          if (event.fields.status === 'completed') console.log('[Done]');
          break;
        case 'error':
          console.error(`Error: ${event.error.message}`);
          break;
      }
    },
  },
});
```

## 3. Create a Session

```typescript
import { createAgentSession, AnthropicProvider } from '@anthropic/zed-agent-core';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const model = provider.providedModels()[0]; // Claude Sonnet 4

const session = createAgentSession(host, { model });
```

## 4. Send Messages

```typescript
// Simple text message
await session.send('Read the README and summarize the project.');

// The agent will:
// 1. Call read_file tool to read README.md
// 2. Respond with a summary
// All events flow through your eventSink
```

## 5. Advanced Usage

### Multiple Threads

```typescript
const thread1 = session.createThread();
const thread2 = session.createThread();

await thread1.send([{ type: 'text', text: 'Work on feature A' }]);
await thread2.send([{ type: 'text', text: 'Work on feature B' }]);
```

### Persistence

```typescript
const session = createAgentSession(host, {
  model,
  databasePath: './agent-threads.db',
});

// Threads are automatically saved after each turn
// Load previous threads:
const threads = session.listThreads();
const loaded = session.getThread(threads[0].id);
```

### Custom Tools

```typescript
import { eraseToolType, type AgentTool } from '@anthropic/zed-agent-core';

const myTool: AgentTool<{ query: string }, string> = {
  name: 'my_custom_tool',
  kind: 'other',
  description: () => 'Does something custom',
  inputSchema: () => ({
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  }),
  initialTitle: (input) => input?.query ?? 'Custom tool',
  async run(input, context) {
    const result = `Processed: ${input.query}`;
    return {
      llmOutput: { type: 'text', text: result },
      rawOutput: result,
    };
  },
};

const session = createAgentSession(host, {
  model,
  customTools: [eraseToolType(myTool)],
});
```

### Different Providers

```typescript
// OpenAI
import { OpenAIProvider } from '@anthropic/zed-agent-core';
const openai = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });

// Google AI
import { GoogleProvider } from '@anthropic/zed-agent-core';
const google = new GoogleProvider({ apiKey: process.env.GOOGLE_API_KEY });

// Ollama (local)
import { createOllamaProvider } from '@anthropic/zed-agent-core';
const ollama = createOllamaProvider();
await ollama.authenticate(); // Discovers available models

// Use any provider's model
const model = openai.providedModels()[0];
const session = createAgentSession(host, { model });
```

## Try the Demo

Run the demo without any API key to see the agent in action:

```bash
cd packages/zed-agent-demo
npm run build
node dist/index.js /path/to/project
```

Type "list the current directory" or "what time is it?" to see tools execute.
