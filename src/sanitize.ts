/**
 * Minimal HTML sanitizer for AI-generated rich text. Strips script/style/iframe and
 * inline event handlers; keeps a small allowlist of tags and attributes suitable for
 * advisor output.
 *
 * Ported from @kigathi/ai-agents v1.1.0 with minor TS typing tweaks.
 */

const ALLOWED_TAGS = new Set([
	'a',
	'b',
	'blockquote',
	'br',
	'code',
	'div',
	'em',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'i',
	'li',
	'ol',
	'p',
	'pre',
	'span',
	'strong',
	'table',
	'tbody',
	'td',
	'th',
	'thead',
	'tr',
	'u',
	'ul'
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
	a: new Set(['href', 'title', 'target', 'rel']),
	'*': new Set(['class'])
};

const UNSAFE_PROTOCOLS = /^\s*(javascript|data|vbscript):/i;

export function sanitizeRichHtml(input: string | null | undefined): string {
	if (!input) return '';
	let html = String(input);

	// Strip dangerous tags wholesale.
	html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
	html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, '');

	// Strip on* attributes.
	html = html.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

	// Strip unsafe href/src values.
	html = html.replace(
		/\s+(href|src)\s*=\s*("(?:[^"]*?)"|'(?:[^']*?)'|[^\s>]+)/gi,
		(match, attr: string, value: string) => {
			const v = value.replace(/^['"]|['"]$/g, '');
			if (UNSAFE_PROTOCOLS.test(v)) return '';
			return ` ${attr}="${v.replace(/"/g, '&quot;')}"`;
		}
	);

	// Optional: drop tags not in allowlist. We do this last so attribute stripping above
	// applies to the broader HTML stream first.
	html = html.replace(/<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tagName: string) => {
		const lower = tagName.toLowerCase();
		if (ALLOWED_TAGS.has(lower)) return match;
		return '';
	});

	return html;
}

export { ALLOWED_TAGS, ALLOWED_ATTRS };
