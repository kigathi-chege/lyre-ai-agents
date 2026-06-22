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
	if (factory && apiKey && modelId) return factory(apiKey, modelId);
	return model;
}
