import type { Agent, AgentDefinition, ToolDefinition } from './types';

/**
 * In-memory registry of agents and tools. One per `Client`.
 */
export class Registry {
	readonly tools = new Map<string, ToolDefinition>();
	readonly agents = new Map<string, Agent>();

	registerTool<I, O>(tool: ToolDefinition<I, O>): ToolDefinition<I, O> {
		this.tools.set(tool.name, tool as unknown as ToolDefinition);
		return tool;
	}

	createAgent(definition: AgentDefinition): Agent {
		const agent: Agent = {
			id: definition.id ?? definition.name,
			name: definition.name,
			model: definition.model,
			instructions: definition.instructions ?? '',
			temperature: definition.temperature,
			maxOutputTokens: definition.maxOutputTokens,
			tools: definition.tools,
			providerOptions: definition.providerOptions,
			metadata: definition.metadata
		};

		this.agents.set(agent.id, agent);
		// Also key by name when distinct from id, so consumers can look up by either.
		if (agent.name !== agent.id) this.agents.set(agent.name, agent);
		return agent;
	}

	resolveAgent(input: string | AgentDefinition): Agent {
		if (typeof input !== 'string') {
			// Allow callers to pass a fully-formed definition for one-off calls.
			return this.createAgent(input);
		}
		const found = this.agents.get(input);
		if (!found) throw new Error(`Unknown agent: ${input}`);
		return found;
	}

	resolveTools(agent: Agent): ToolDefinition[] {
		const names = agent.tools && agent.tools.length > 0 ? agent.tools : [...this.tools.keys()];
		const out: ToolDefinition[] = [];
		for (const name of names) {
			const tool = this.tools.get(name);
			if (tool) out.push(tool);
		}
		return out;
	}
}
