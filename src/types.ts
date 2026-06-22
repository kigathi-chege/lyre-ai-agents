import type { z } from 'zod';

/**
 * A model identifier. Vercel AI SDK v6 accepts strings like `'openai/gpt-4o'`,
 * `'anthropic/claude-sonnet-4.5'`, `'google/gemini-2.5-flash'`. Provider auth comes
 * from environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
 * `GOOGLE_GENERATIVE_AI_API_KEY`) unless you wire an explicit provider object.
 */
export type ModelId = string;

/**
 * Anything `streamText` / `generateText` accepts as `model`. Use a string for
 * registry-resolved providers; pass a `LanguageModel` instance for custom wiring.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModelLike = ModelId | { specificationVersion: string; [k: string]: any };

export type ToolDefinition<Input = unknown, Output = unknown> = {
	name: string;
	description: string;
	/**
	 * Zod schema for the tool's input arguments. The AI SDK uses this to constrain
	 * the model's function-call output and to type the `execute` callback.
	 */
	inputSchema: z.ZodSchema<Input>;
	execute: (input: Input, context: ToolContext) => Promise<Output> | Output;
};

export type ToolContext = {
	/** Unique tool call id from the model, useful for correlating tool-call → tool-result. */
	toolCallId: string;
	/** Forwarded from RunParams.context — apps thread per-request state (user id, locale, etc.). */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	app: Record<string, any>;
};

export type Message =
	| { role: 'system'; content: string }
	| { role: 'user'; content: string }
	| { role: 'assistant'; content: string };

/**
 * Client-level defaults applied to every run. `apiKey` is a single generic key the package uses
 * to construct whichever provider a `provider/model` string names (see providers.ts), so consumers
 * never import `@ai-sdk/*`. `model` is the default model when an agent doesn't specify one.
 */
export type ClientDefaults = { apiKey?: string; model?: ModelLike };

export type AgentDefinition = {
	/** Stable identifier; used as the lookup key. Defaults to `name`. */
	id?: string;
	name: string;
	/**
	 * Model to use. A `provider/model` string (e.g. 'anthropic/claude-sonnet-4-5', 'openai/gpt-4o',
	 * 'xai/grok-2-latest') is resolved to a provider using the client's generic `apiKey`; a
	 * `LanguageModel` instance is used as-is. Optional — falls back to the client default model.
	 */
	model?: ModelLike;
	/** System prompt. Inserted as a `system` message when no system message is in the history. */
	instructions?: string;
	temperature?: number;
	maxOutputTokens?: number;
	/**
	 * Tool names this agent may call. If omitted, all globally-registered tools are available.
	 */
	tools?: readonly string[];
	/**
	 * Provider-specific options. Forwarded to Vercel AI SDK's `providerOptions`.
	 * Example: `{ anthropic: { cacheControl: { type: 'ephemeral' } } }`.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	providerOptions?: Record<string, Record<string, any>>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	metadata?: Record<string, any>;
};

export type Agent = Required<Pick<AgentDefinition, 'id' | 'name' | 'instructions'>> &
	Omit<AgentDefinition, 'id' | 'name' | 'instructions'>;

export type RunParams = {
	/** Agent id, name, or definition object. */
	agent: string | AgentDefinition;
	/** The new user message. Combined with `history` to form the full conversation. */
	message?: string;
	/** Prior conversation. The agent's `instructions` is prepended as a system message. */
	history?: readonly Message[];
	/** Override `maxOutputTokens` per call. */
	maxOutputTokens?: number;
	/** Override `temperature` per call. */
	temperature?: number;
	/** Max number of tool-call iterations before bailing. Default 8. */
	maxSteps?: number;
	/** Forwarded to tool `execute(input, context)`. */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	context?: Record<string, any>;
};

export type RunResult = {
	text: string;
	finishReason: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
	toolResults: { toolCallId: string; toolName: string; output: unknown }[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	raw: any;
};

export type StreamEvent =
	| { type: 'text-delta'; text: string }
	| { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
	| { type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }
	| { type: 'tool-error'; toolCallId: string; toolName: string; error: unknown }
	| {
			type: 'finish';
			finishReason: string;
			usage: { inputTokens: number; outputTokens: number; totalTokens: number };
	  }
	| { type: 'error'; error: unknown };

/**
 * Parameters for `runObject` — schema-constrained structured generation. Mirrors
 * `RunParams` minus tools/maxSteps (structured generation is single-shot), plus a Zod
 * `schema` the model output is validated against. Added in 0.2.0; non-breaking.
 */
export type RunObjectParams<T = unknown> = {
	/** Agent id, name, or definition object. */
	agent: string | AgentDefinition;
	/** The new user message. Combined with `history` to form the full conversation. */
	message?: string;
	/** Prior conversation. The agent's `instructions` is prepended as a system message. */
	history?: readonly Message[];
	/** Zod schema the model's JSON output must satisfy. The SDK constrains + validates. */
	inputSchema: z.ZodSchema<T>;
	/** Optional schema name/description forwarded to the provider for better grounding. */
	schemaName?: string;
	schemaDescription?: string;
	maxOutputTokens?: number;
	temperature?: number;
	/** Forwarded to the model call (not to tools — structured generation has no tools). */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	context?: Record<string, any>;
};

export type RunObjectResult<T = unknown> = {
	/** The validated, typed object. */
	object: T;
	finishReason: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	raw: any;
};
