import { Registry } from './agents';
import { run, runObject, runStream } from './run';
import type {
	Agent,
	AgentDefinition,
	RunParams,
	RunObjectParams,
	RunObjectResult,
	RunResult,
	StreamEvent,
	ToolDefinition
} from './types';

/**
 * AI agents client. Stateless besides the agent/tool registry; create one per app
 * (or per request — they're cheap).
 */
export class AiAgentsClient {
	private readonly registry: Registry;

	constructor() {
		this.registry = new Registry();
	}

	registerTool<I, O>(tool: ToolDefinition<I, O>): ToolDefinition<I, O> {
		return this.registry.registerTool(tool);
	}

	createAgent(definition: AgentDefinition): Agent {
		return this.registry.createAgent(definition);
	}

	async run(params: RunParams): Promise<RunResult> {
		return run(this.registry, params);
	}

	runStream(params: RunParams): AsyncGenerator<StreamEvent, void, unknown> {
		return runStream(this.registry, params);
	}

	/**
	 * Schema-constrained structured generation. Returns a validated, typed object
	 * instead of free text. Single-shot (no tools). Added in 0.2.0.
	 */
	async runObject<T>(params: RunObjectParams<T>): Promise<RunObjectResult<T>> {
		return runObject<T>(this.registry, params);
	}

	/** Direct access to the underlying registry for advanced introspection. */
	get raw(): Registry {
		return this.registry;
	}
}

/**
 * Factory. Provider auth comes from environment variables. To explicitly configure
 * provider clients (e.g., for testing), pass `LanguageModel` instances to
 * `createAgent({ model })` instead of string identifiers.
 */
export function createClient(): AiAgentsClient {
	return new AiAgentsClient();
}
