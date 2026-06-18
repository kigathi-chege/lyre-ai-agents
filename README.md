# @~lyre/ai-agents

Multi-provider AI agents SDK for SvelteKit and Node. Thin agent/tool/run/runStream/runObject API on top of the [Vercel AI SDK](https://ai-sdk.dev/) — supports OpenAI, Anthropic, Google Gemini, Mistral, Cohere, and any other provider the AI SDK targets.

## Structured output (`runObject`) — added in 0.2.0

`run`/`runStream` return free text. For analysis/extraction where you want a validated,
typed object, use `runObject` — single-shot, schema-constrained generation over the AI
SDK's `generateObject`. Purely additive; existing `run`/`runStream` are unchanged.

```ts
import { createClient } from '@~lyre/ai-agents';
import { z } from 'zod';

const ai = createClient();
ai.createAgent({ name: 'extractor', model: anthropic('claude-sonnet-4-5'), instructions: '...' });

const { object } = await ai.runObject({
  agent: 'extractor',
  message: 'Summarize these conversations …',
  inputSchema: z.object({
    topics: z.array(z.string()),
    sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed'])
  })
});
// object is typed + validated; no manual JSON parsing.
```


## Why

The original `@kigathi/ai-agents` v1.1.0 (in `belva/axis/packages/lyre-ai-agents-node`) was OpenAI-only and built directly on `openai.responses.create()`. Locking the AI advisor to one vendor is bad insurance — when Anthropic ships a 10× cheaper model, you want to switch in a config line. This package preserves the original's developer-facing API (`createClient` → `registerTool` / `createAgent` / `run` / `runStream`) but routes everything through the AI SDK's provider-agnostic `generateText` / `streamText`.

## Quick start

```bash
pnpm add @~lyre/ai-agents ai zod
pnpm add @ai-sdk/anthropic   # or @ai-sdk/openai, @ai-sdk/google, etc.
```

```ts
import { createClient } from '@~lyre/ai-agents';
import { z } from 'zod';

const ai = createClient();

ai.registerTool({
  name: 'book_advisor_call',
  description: 'Capture the user\'s intent to speak with a human advisor.',
  inputSchema: z.object({
    reason: z.string(),
    preferred_time: z.string().optional()
  }),
  execute: async (input, { app }) => {
    // app.userId, app.guestUuid, app.locale, etc. — whatever you put in RunParams.context
    return { booked: true, ticketId: 'demo-1234' };
  }
});

ai.createAgent({
  name: 'advisor',
  model: 'anthropic/claude-sonnet-4.5',
  instructions: 'You are a calm wealth advisor...',
  tools: ['book_advisor_call'],
  temperature: 0.7,
  providerOptions: {
    anthropic: { cacheControl: { type: 'ephemeral' } }  // prompt caching
  }
});

// Non-streaming
const result = await ai.run({
  agent: 'advisor',
  message: 'Should I write a will?',
  history: [],
  context: { userId: 'u_123' }
});
console.log(result.text);

// Streaming
for await (const ev of ai.runStream({ agent: 'advisor', message: 'Hi' })) {
  if (ev.type === 'text-delta') process.stdout.write(ev.text);
  if (ev.type === 'tool-call') console.log('\ntool-call:', ev.toolName, ev.input);
  if (ev.type === 'tool-result') console.log('tool-result:', ev.toolName, ev.output);
  if (ev.type === 'finish') console.log('\nusage:', ev.usage);
}
```

Provider authentication uses environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, …). To use a non-standard endpoint or test fixture, pass a constructed `LanguageModel` object to `createAgent({ model })` instead of a string.

## What's different from `@kigathi/ai-agents`

| Surface | `@kigathi/ai-agents` v1.1.0 | `@lyre/ai-agents` |
|---|---|---|
| Providers | OpenAI only (Responses API) | OpenAI, Anthropic, Google, Mistral, Cohere, … (Vercel AI SDK) |
| Streaming events | Text deltas only | Full event stream: `text-delta`, `tool-call`, `tool-result`, `tool-error`, `finish`, `error` |
| Tool schemas | Loose JSON schema | Zod-typed `inputSchema`, type-safe `execute` |
| Modes (direct / proxy / persistence) | Built in | **Dropped** — apps own their persistence and routing |
| TTS, read-aloud | Built in | **Dropped** for the POC. Re-add if needed. |
| Conversation state | In-memory `Map` | **Dropped** — apps own their conversation persistence |
| Prompt caching | Not exposed | Forwarded via `agent.providerOptions` |
| Language | JavaScript | TypeScript |

If you need TTS or the read-aloud UI from the original, port those modules separately — they're orthogonal to the agent runtime.
