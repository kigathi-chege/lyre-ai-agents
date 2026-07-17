// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { generateText, streamText, tool, Output, type ModelMessage, type Tool } from 'ai';
import type { Registry } from './agents';
import type {
	ClientDefaults,
	Message,
	RunParams,
	RunObjectParams,
	RunObjectResult,
	RunResult,
	StreamEvent,
	Agent,
	ToolDefinition
} from './types';
import { resolveModelString } from './providers';
import { ensureRemoteAgent, reportRun, buildProxyTool } from './remote';

// Resolve the agent, fetching it from the remote source when it's a string not registered locally and a
// remote base URL is configured. Falls through to the normal (throwing) resolveAgent otherwise.
async function resolveAgentMaybeRemote(
	registry: Registry,
	agentInput: RunParams['agent'],
	defaults?: ClientDefaults
): Promise<Agent> {
	if (typeof agentInput === 'string' && defaults?.remoteBaseUrl && !registry.hasAgent(agentInput)) {
		await ensureRemoteAgent(registry, agentInput, defaults);
	}
	return registry.resolveAgent(agentInput);
}

function resolveModel(agent: Agent, defaults?: ClientDefaults) {
	// Use the agent's model, or fall back to the client default. A string `provider/model` is
	// constructed into a real provider via a single generic apiKey (see providers.ts); a
	// LanguageModel instance is passed straight through. We narrow the AI SDK's loose surface here.
	const model = agent.model ?? defaults?.model;
	if (typeof model === 'string') return resolveModelString(model, defaults?.apiKey) as never;
	return model as never;
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
	// Materialize remote proxy tools this agent may use, binding each to the run's CONTEXT so the tool call
	// forwarded to the source carries the run scope (needed to resolve the source's built-in tools). When the
	// agent names tools, only the named proxy tools are included; otherwise all (matches resolveTools).
	const allowed = agent.tools && agent.tools.length > 0 ? new Set(agent.tools) : null;
	for (const [name, spec] of registry.proxyTools) {
		if (allowed && !allowed.has(name)) continue;
		if (!out[name]) out[name] = buildProxyTool(spec, context);
	}
	return out;
}

// Options shared by `run` and `runStream` that depend on RunParams: the schema-constrained `output`
// spec and the first-step `toolChoice`. Factored out so both entry points behave identically.
function buildRunOptions(params: RunParams): Record<string, unknown> {
	const opts: Record<string, unknown> = {};

	if (params.output) {
		opts.output = Output.object({
			schema: params.output.schema,
			name: params.output.name,
			description: params.output.description
		});
	}

	// `toolChoice` constrains ONLY the first step. If it forced a tool on every step the model could
	// never stop to answer, so from step 2 onward we return to `auto` (or `none` if the final schema
	// object shouldn't call tools — but `auto` lets the model keep gathering if it needs to).
	if (params.toolChoice && params.toolChoice !== 'auto') {
		opts.toolChoice = params.toolChoice;
		opts.prepareStep = ({ stepNumber }: { stepNumber: number }) =>
			stepNumber === 0 ? { toolChoice: params.toolChoice } : { toolChoice: 'auto' };
	}

	return opts;
}

export async function run(
	registry: Registry,
	params: RunParams,
	defaults?: ClientDefaults
): Promise<RunResult> {
	const startedAt = Date.now();
	const agent = await resolveAgentMaybeRemote(registry, params.agent, defaults);
	const messages = buildMessages(agent, params);
	const tools = buildTools(registry, agent, params.context ?? {});

	// Same as runStream: `output` forces a schema-valid final object; `toolChoice` can force the first
	// step to call a tool. Both come from buildRunOptions so the two entry points stay identical.
	const result = await generateText({
		model: resolveModel(agent, defaults),
		messages,
		tools,
		...buildRunOptions(params),
		temperature: params.temperature ?? agent.temperature,
		maxOutputTokens: params.maxOutputTokens ?? agent.maxOutputTokens,
		stopWhen: ({ steps }: { steps: readonly unknown[] }) =>
			steps.length >= (params.maxSteps ?? 8),
		providerOptions: agent.providerOptions
	} as never);

	const runResult: RunResult = {
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
		...(params.output
			? { object: (result as unknown as { experimental_output?: unknown }).experimental_output }
			: {}),
		raw: result
	};

	// Report the run back to the remote source (best-effort; skipped when no remote configured).
	void reportRun(defaults ?? {}, buildRunReport(agent, params, runResult, true, null, startedAt));
	return runResult;
}

// Map a finished run to the source's /runs ingest shape. `agent.name` is the slug. Cost is NOT sent — the
// source derives it from model + tokens. `raw` is never sent.
function buildRunReport(
	agent: Agent,
	params: RunParams,
	result: Pick<RunResult, 'text' | 'usage' | 'toolCalls' | 'toolResults' | 'object'> & { finishReason?: string },
	ok: boolean,
	error: string | null,
	startedAt: number
): Record<string, unknown> {
	return {
		operation: 'agent_ask',
		agentSlug: agent.name,
		model: typeof agent.model === 'string' ? agent.model : null,
		question: params.message ?? null,
		requestPayload: { message: params.message ?? null, context: params.context ?? null },
		responsePayload: { text: result.text, object: result.object ?? null, finishReason: result.finishReason ?? null },
		toolCalls: result.toolCalls,
		toolResults: result.toolResults,
		inputTokens: result.usage.inputTokens,
		outputTokens: result.usage.outputTokens,
		totalTokens: result.usage.totalTokens,
		latencyMs: Date.now() - startedAt,
		ok,
		error
	};
}

export async function* runStream(
	registry: Registry,
	params: RunParams,
	defaults?: ClientDefaults
): AsyncGenerator<StreamEvent, void, unknown> {
	const startedAt = Date.now();
	const agent = await resolveAgentMaybeRemote(registry, params.agent, defaults);
	const messages = buildMessages(agent, params);
	const tools = buildTools(registry, agent, params.context ?? {});

	// Accumulate for the run report (best-effort report on finish/error).
	let reportText = '';
	let reportObject: unknown;
	const reportToolCalls: { toolCallId: string; toolName: string; input: unknown }[] = [];
	const reportToolResults: { toolCallId: string; toolName: string; output: unknown }[] = [];

	// When `output` is given, force the FINAL answer to be a schema-valid object WHILE still allowing
	// tool calls (AI SDK: pass `tools` and `Output.object` together). The model calls tools, reads the
	// results across steps, then emits the validated object as its last step. Without `output` the run
	// is free-text (unchanged). The object generation is itself a step, so `stopWhen`/`maxSteps` must
	// leave room for it beyond the tool iterations.
	const result = streamText({
		model: resolveModel(agent, defaults),
		messages,
		tools,
		...buildRunOptions(params),
		temperature: params.temperature ?? agent.temperature,
		maxOutputTokens: params.maxOutputTokens ?? agent.maxOutputTokens,
		stopWhen: ({ steps }: { steps: readonly unknown[] }) =>
			steps.length >= (params.maxSteps ?? 8),
		providerOptions: agent.providerOptions
	} as never);

	// Accumulate per-step usage as a fallback: in AI SDK v5/v6 the aggregate usage rides on the
	// final `finish` part as `totalUsage`, while per-step usage rides on each `finish-step` part as
	// `usage`. Some providers populate one but not the other, so we track both and prefer the
	// aggregate.
	const accumulatedUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
	const addUsage = (u: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined) => {
		if (!u) return;
		accumulatedUsage.inputTokens += u.inputTokens ?? 0;
		accumulatedUsage.outputTokens += u.outputTokens ?? 0;
		accumulatedUsage.totalTokens += u.totalTokens ?? 0;
	};

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for await (const part of result.fullStream as AsyncIterable<any>) {
		switch (part.type) {
			case 'text-delta': {
				const t = part.text ?? part.delta ?? '';
				reportText += t;
				yield { type: 'text-delta', text: t };
				break;
			}
			case 'finish-step':
				addUsage(part.usage);
				break;
			case 'tool-call':
				reportToolCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input ?? part.args });
				yield {
					type: 'tool-call',
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					input: part.input ?? part.args
				};
				break;
			case 'tool-result':
				reportToolResults.push({ toolCallId: part.toolCallId, toolName: part.toolName, output: part.output ?? part.result });
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
			case 'finish': {
				// AI SDK v5/v6 carries aggregate usage as `totalUsage` on the final finish part
				// (older builds used `usage`); fall back to the per-step accumulation.
				const finalUsage = part.totalUsage ?? part.usage;
				// When `output` was requested, the AI SDK resolves the schema-validated object on the
				// stream result (`experimental_output`). Await it here so consumers get the parsed object
				// on the finish event instead of re-parsing raw text. Best-effort: a validation failure
				// throws, which we surface as an `error` event below via the outer iterator.
				let object: unknown;
				if (params.output) {
					object = await (result as unknown as { experimental_output?: Promise<unknown> })
						.experimental_output;
				}
				reportObject = object;
				const usage = {
					inputTokens: finalUsage?.inputTokens ?? accumulatedUsage.inputTokens,
					outputTokens: finalUsage?.outputTokens ?? accumulatedUsage.outputTokens,
					totalTokens: finalUsage?.totalTokens ?? accumulatedUsage.totalTokens
				};
				void reportRun(
					defaults ?? {},
					buildRunReport(
						agent,
						params,
						{ text: reportText, usage, toolCalls: reportToolCalls, toolResults: reportToolResults, object: reportObject, finishReason: part.finishReason },
						true,
						null,
						startedAt
					)
				);
				yield {
					type: 'finish',
					finishReason: part.finishReason,
					usage,
					...(params.output ? { object } : {})
				};
				break;
			}
			case 'error':
				void reportRun(
					defaults ?? {},
					buildRunReport(
						agent,
						params,
						{ text: reportText, usage: accumulatedUsage, toolCalls: reportToolCalls, toolResults: reportToolResults, object: reportObject },
						false,
						part.error instanceof Error ? part.error.message : String(part.error),
						startedAt
					)
				);
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
	params: RunObjectParams<T>,
	defaults?: ClientDefaults
): Promise<RunObjectResult<T>> {
	const agent = registry.resolveAgent(params.agent);
	const messages = buildMessages(agent, params as unknown as RunParams);

	// AI SDK v6 deprecated `generateObject` in favor of `generateText` with an `output` spec.
	// `Output.object` forces a schema-validated object; the result is exposed as `result.output`.
	const result = await generateText({
		model: resolveModel(agent, defaults),
		messages,
		output: Output.object({
			schema: params.inputSchema,
			name: params.schemaName,
			description: params.schemaDescription
		}),
		temperature: params.temperature ?? agent.temperature,
		maxOutputTokens: params.maxOutputTokens ?? agent.maxOutputTokens,
		providerOptions: agent.providerOptions
	} as never);

	return {
		object: result.output as T,
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
