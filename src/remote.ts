// Remote agent source support: fetch an agent definition from a configured base URL, register it (plus
// proxy tools for any tools the host doesn't have locally) into the client's registry, run it locally, and
// report the result back. Mirrors the older sibling package's core/backend.js. All calls are best-effort
// for reporting and hard-failing only where a run genuinely can't proceed (definition not found).
import { tool as aiTool, jsonSchema, type Tool } from 'ai';
import type { Registry } from './agents';
import type { ClientDefaults, ProxyToolSpec, RemoteToolSpec } from './types';

function authHeaders(defaults: ClientDefaults): Record<string, string> {
	const h: Record<string, string> = { 'Content-Type': 'application/json' };
	if (defaults.remoteToken) h.Authorization = `Bearer ${defaults.remoteToken}`;
	return h;
}

type RemoteDefinition = {
	slug: string;
	name: string;
	model?: string;
	instructions?: string;
	temperature?: number;
	maxOutputTokens?: number;
	tools?: RemoteToolSpec[];
};

// Fetch + register a remote agent (and its proxy tools) into the registry. Returns the agent name to run,
// or null when there's no remote configured or the agent can't be resolved. Idempotent: an already-
// registered agent (by name) short-circuits.
export async function ensureRemoteAgent(
	registry: Registry,
	agentSlug: string,
	defaults: ClientDefaults
): Promise<string | null> {
	if (!defaults.remoteBaseUrl) return null;
	// Already registered locally (or fetched earlier)? Use it.
	if (registry.hasAgent(agentSlug)) return agentSlug;

	const base = defaults.remoteBaseUrl.replace(/\/+$/, '');
	let def: RemoteDefinition;
	try {
		const res = await fetch(`${base}/agents/${encodeURIComponent(agentSlug)}/definition`, {
			method: 'GET',
			headers: authHeaders(defaults)
		});
		if (!res.ok) return null;
		def = (await res.json()) as RemoteDefinition;
	} catch {
		return null;
	}

	// Register a proxy tool SPEC for every tool the definition names that the host hasn't registered
	// locally. Locally-registered tools win (the host's own implementation is preferred). The spec is
	// materialized into an AI-SDK tool at run time (buildTools), where the run's context is available.
	for (const spec of def.tools ?? []) {
		if (!spec?.name || registry.hasTool(spec.name)) continue;
		if (!spec.proxySlug) continue; // unproxyable tools are skipped (run without them)
		registry.registerProxyTool({
			name: spec.name,
			description: spec.description ?? `Proxied tool "${spec.proxySlug}".`,
			inputSchema: spec.inputSchema ?? { type: 'object', properties: {} },
			proxySlug: spec.proxySlug,
			base,
			headers: authHeaders(defaults)
		});
	}

	registry.createAgent({
		id: def.slug,
		name: def.slug,
		model: def.model,
		instructions: def.instructions ?? '',
		temperature: def.temperature,
		maxOutputTokens: def.maxOutputTokens,
		tools: (def.tools ?? []).map((t) => t.name)
	});
	return def.slug;
}

// Materialize a proxy tool spec into an AI-SDK tool bound to the run's CONTEXT. The tool call sent to the
// source carries the model's `input` PLUS the run scope (appId/tenantId/scopeMode/targetApps/collectionIds/
// range) the source needs to resolve built-in tools (and to scope apiTools). Built at run time so `context`
// is the live run's context.
export function buildProxyTool(spec: ProxyToolSpec, context: Record<string, unknown>): Tool {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const schema: any = spec.inputSchema ?? { type: 'object', properties: {} };
	// Whitelist the scope fields the source understands; forward whatever the run provided.
	const scope = pickScope(context);
	return aiTool({
		description: spec.description,
		inputSchema: jsonSchema(schema),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		execute: async (input: any) => {
			const res = await fetch(`${spec.base}/tools/${encodeURIComponent(spec.proxySlug)}/call`, {
				method: 'POST',
				headers: spec.headers,
				body: JSON.stringify({ input, ...scope })
			});
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				return { error: `Proxied tool "${spec.proxySlug}" failed: HTTP ${res.status} ${text}`.trim() };
			}
			const body = (await res.json().catch(() => ({}))) as { output?: unknown };
			return body.output ?? body;
		}
	});
}

// The run-scope fields the source's /tools/[slug]/call endpoint reads (built-ins need these; apiTools use
// appId/tenantId). Only forwards keys that are present, so the body stays minimal. `toolContext` is an
// opaque per-conversation identity bag the source folds into the apiTool's outbound `_context` (e.g.
// axis-api's tools read `_context.metadata.axis_conversation_id`) — forwarded verbatim when the run supplies it.
function pickScope(context: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of ['appId', 'tenantId', 'scopeMode', 'targetApps', 'collectionIds', 'range']) {
		if (context[key] !== undefined && context[key] !== null) out[key] = context[key];
	}
	if (context.toolContext && typeof context.toolContext === 'object') {
		out.toolContext = context.toolContext;
	}
	return out;
}

// Best-effort run report to the remote source. Never throws.
export async function reportRun(
	defaults: ClientDefaults,
	report: Record<string, unknown>
): Promise<void> {
	if (!defaults.remoteBaseUrl) return;
	const base = defaults.remoteBaseUrl.replace(/\/+$/, '');
	try {
		await fetch(`${base}/runs`, {
			method: 'POST',
			headers: authHeaders(defaults),
			body: JSON.stringify(report)
		});
	} catch {
		// Reporting is best-effort.
	}
}
