// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { generateObject, generateText, streamText, tool, type ModelMessage, type Tool } from 'ai';
import type { Registry } from './agents';
import type {
	Message,
	RunParams,
	RunObjectParams,
	RunObjectResult,
	RunResult,
	StreamEvent,
	Agent,
	ToolDefinition
} from './types';

function resolveModel(agent: Agent) {
	// The AI SDK accepts either provider strings or LanguageModel instances at runtime.
	// Our public API intentionally exposes that looser surface, so we narrow only here.
	return agent.model as never;
}

function buildMessages(agent: Agent, params: RunParams): ModelMessage[] {
	const messages: ModelMessage[] = [];

	const history = params.history ?? [];
	const hasSystem = history.some((m) => m.role === 'system');
	if (!hasSystem && agent.instructions) {
		messages.push({ role: 'system', content: agent.instructions });
	}

	for (const m of history) messages.push(m as unknown as ModelMessage);

	if (params.message) {
		messages.push({ role: 'user', content: params.message });
	}

	return messages;
}

function buildTools(
	registry: Registry,
	agent: Agent,
	context: Record<string, unknown>
): Record<string, Tool> {
	const defs = registry.resolveTools(agent);
	const out: Record<string, Tool> = {};
	for (const def of defs as ToolDefinition[]) {
		out[def.name] = tool({
			description: def.description,
			inputSchema: def.inputSchema,
			execute: async (input, opts: { toolCallId: string }) =>
				def.execute(input, { toolCallId: opts.toolCallId, app: context })
		});
	}
	return out;
}

export async function run(registry: Registry, params: RunParams): Promise<RunResult> {
	const agent = registry.resolveAgent(params.agent);
	const messages = buildMessages(agent, params);
	const tools = buildTools(registry, agent, params.context ?? {});

	const result = await generateText({
		model: resolveModel(agent),
		messages,
		tools,
		temperature: params.temperature ?? agent.temperature,
		maxOutputTokens: params.maxOutputTokens ?? agent.maxOutputTokens,
		stopWhen: ({ steps }) => steps.length >= (params.maxSteps ?? 8),
		providerOptions: agent.providerOptions
	});

	return {
		text: result.text,
		finishReason: result.finishReason as string,
		usage: {
			inputTokens: result.usage?.inputTokens ?? 0,
			outputTokens: result.usage?.outputTokens ?? 0,
			totalTokens: result.usage?.totalTokens ?? 0
		},
		toolCalls: (result.toolCalls ?? []).map((c) => ({
			toolCallId: c.toolCallId,
			toolName: c.toolName,
			input: c.input
		})),
		toolResults: (result.toolResults ?? []).map((r) => ({
			toolCallId: r.toolCallId,
			toolName: r.toolName,
			output: (r as { output: unknown }).output
		})),
		raw: result
	};
}

export async function* runStream(
	registry: Registry,
	params: RunParams
): AsyncGenerator<StreamEvent, void, unknown> {
	const agent = registry.resolveAgent(params.agent);
	const messages = buildMessages(agent, params);
	const tools = buildTools(registry, agent, params.context ?? {});

	const result = streamText({
		model: resolveModel(agent),
		messages,
		tools,
		temperature: params.temperature ?? agent.temperature,
		maxOutputTokens: params.maxOutputTokens ?? agent.maxOutputTokens,
		stopWhen: ({ steps }) => steps.length >= (params.maxSteps ?? 8),
		providerOptions: agent.providerOptions
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for await (const part of result.fullStream as AsyncIterable<any>) {
		switch (part.type) {
			case 'text-delta':
				yield { type: 'text-delta', text: part.text ?? part.delta ?? '' };
				break;
			case 'tool-call':
				yield {
					type: 'tool-call',
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					input: part.input ?? part.args
				};
				break;
			case 'tool-result':
				yield {
					type: 'tool-result',
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					output: part.output ?? part.result
				};
				break;
			case 'tool-error':
				yield {
					type: 'tool-error',
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					error: part.error
				};
				break;
			case 'finish':
				yield {
					type: 'finish',
					finishReason: part.finishReason,
					usage: {
						inputTokens: part.usage?.inputTokens ?? 0,
						outputTokens: part.usage?.outputTokens ?? 0,
						totalTokens: part.usage?.totalTokens ?? 0
					}
				};
				break;
			case 'error':
				yield { type: 'error', error: part.error };
				break;
			// Silently drop other chunk types (start/step boundaries, raw text accumulators, etc.).
		}
	}
}

/**
 * Schema-constrained structured generation. Single-shot (no tools): the model is
 * forced to return JSON matching `params.inputSchema`, validated by the AI SDK before
 * it resolves. Use this for analysis/extraction where you want a typed object instead
 * of free text. Additive — does not touch `run`/`runStream`.
 */
export async function runObject<T>(
	registry: Registry,
	params: RunObjectParams<T>
): Promise<RunObjectResult<T>> {
	const agent = registry.resolveAgent(params.agent);
	const messages = buildMessages(agent, params as unknown as RunParams);

	const result = await generateObject({
		model: resolveModel(agent),
		messages,
		schema: params.inputSchema,
		schemaName: params.schemaName,
		schemaDescription: params.schemaDescription,
		temperature: params.temperature ?? agent.temperature,
		maxOutputTokens: params.maxOutputTokens ?? agent.maxOutputTokens,
		providerOptions: agent.providerOptions
	} as never);

	return {
		object: result.object as T,
		finishReason: (result.finishReason as string) ?? 'stop',
		usage: {
			inputTokens: result.usage?.inputTokens ?? 0,
			outputTokens: result.usage?.outputTokens ?? 0,
			totalTokens: result.usage?.totalTokens ?? 0
		},
		raw: result
	};
}

export type { Message };
