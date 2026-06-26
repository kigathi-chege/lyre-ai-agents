// Provider construction. This is what lets a consumer pass a single generic API key + a
// `provider/model` string and have us build the right provider — so apps depend ONLY on this
// package, never on `@ai-sdk/*` directly. Add a provider here (one line + one dependency) and
// every consumer can use it via the model prefix, with no consumer code change.
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

type ProviderFactory = (apiKey: string, modelId: string) => LanguageModel;

// Prefix → factory. The prefix is the part of the model string before the first '/'.
const PROVIDERS: Record<string, ProviderFactory> = {
	anthropic: (apiKey, id) => createAnthropic({ apiKey })(id),
	openai: (apiKey, id) => createOpenAI({ apiKey })(id),
	xai: (apiKey, id) => createXai({ apiKey })(id), // Grok
	google: (apiKey, id) => createGoogleGenerativeAI({ apiKey })(id)
};

// Per-provider env key. Lets a SINGLE process serve agents on DIFFERENT providers at once (e.g. an
// OpenAI agent and an Anthropic agent): each resolves its own key, falling back to the generic key
// passed by the consumer. This is what makes multi-provider, DB-configured agents work.
const PROVIDER_ENV: Record<string, string> = {
	anthropic: 'ANTHROPIC_API_KEY',
	openai: 'OPENAI_API_KEY',
	xai: 'XAI_API_KEY',
	google: 'GOOGLE_GENERATIVE_AI_API_KEY'
};

/** Provider prefixes this package can construct directly from a generic API key. */
export const SUPPORTED_PROVIDERS = Object.keys(PROVIDERS);

/**
 * Turn a `provider/model` string (e.g. 'anthropic/claude-sonnet-4-5', 'openai/gpt-4o',
 * 'xai/grok-2-latest') into a concrete provider model, using a single generic `apiKey`.
 *
 * Falls back to returning the original string when there's no recognizable provider prefix,
 * the provider is unknown, or no `apiKey` is given — in which case the Vercel AI SDK resolves
 * it itself (its gateway / provider-specific env vars). This keeps existing string usage working.
 */
export function resolveModelString(model: string, apiKey?: string): LanguageModel | string {
	const slash = model.indexOf('/');
	if (slash <= 0) return model;
	const provider = model.slice(0, slash);
	const modelId = model.slice(slash + 1);
	const factory = PROVIDERS[provider];
	if (!factory || !modelId) return model;
	// Prefer the provider-specific env key; fall back to the generic key the consumer passed.
	const envKey = typeof process !== 'undefined' ? process.env?.[PROVIDER_ENV[provider]] : undefined;
	const key = envKey || apiKey;
	if (key) return factory(key, modelId);
	return model;
}
