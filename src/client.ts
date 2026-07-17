import { Registry } from './agents';
import { run, runObject, runStream } from './run';
import type {
	Agent,
	AgentDefinition,
	ClientDefaults,
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
	private readonly defaults: ClientDefaults;

	constructor(config?: ClientDefaults) {
		this.registry = new Registry();
		this.defaults = {
			apiKey: config?.apiKey,
			model: config?.model,
			remoteBaseUrl: config?.remoteBaseUrl,
			remoteToken: config?.remoteToken
		};
	}

	registerTool<I, O>(tool: ToolDefinition<I, O>): ToolDefinition<I, O> {
		return this.registry.registerTool(tool);
	}

	createAgent(definition: AgentDefinition): Agent {
		return this.registry.createAgent(definition);
	}

	async run(params: RunParams): Promise<RunResult> {
		return run(this.registry, params, this.defaults);
	}

	runStream(params: RunParams): AsyncGenerator<StreamEvent, void, unknown> {
		return runStream(this.registry, params, this.defaults);
	}

	/**
	 * Schema-constrained structured generation. Returns a validated, typed object
	 * instead of free text. Single-shot (no tools). Added in 0.2.0.
	 */
	async runObject<T>(params: RunObjectParams<T>): Promise<RunObjectResult<T>> {
		return runObject<T>(this.registry, params, this.defaults);
	}

	/** Direct access to the underlying registry for advanced introspection. */
	get raw(): Registry {
		return this.registry;
	}
}

/**
 * Factory. Pass a single generic `{ apiKey, model }` and the package constructs whichever
 * provider the model's `provider/` prefix names — so apps never import `@ai-sdk/*`. Omit the
 * config to fall back to the Vercel AI SDK's own env-var/gateway resolution, or pass a
 * `LanguageModel` instance via `createAgent({ model })` for fully custom wiring.
 */
export function createClient(config?: ClientDefaults): AiAgentsClient {
	return new AiAgentsClient(config);
}
