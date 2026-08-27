import type { PluginAPI } from '@tardis/core';

/**
 * The web, at arm's length.
 *
 * TARDIS runs a 4B model with a training cutoff and no way to look anything up,
 * which does not stop it answering — it will state an exchange rate or a release
 * date fluently and be wrong, and unlike a bad tool call there is no row count
 * to catch it. This plugin is the way out of that, and its whole design is about
 * not making the problem worse:
 *
 * - **Snippets, not pages.** `web.search` returns five trimmed results and no
 *   more. Twenty full results would eat the 32k context and leave the model
 *   confabulating over the top of them.
 * - **Page text never reaches the conversation.** `web.read-page` is why this is
 *   a Tier 2 plugin: it summarises through its *own* isolated model call, so a
 *   40kb article becomes a paragraph before the main loop ever sees it.
 * - **Every result carries its URL**, because a cited answer can be checked and
 *   an uncited one cannot.
 */

// ─── Types ───

interface SearxResult {
  title?: string;
  url?: string;
  content?: string;
  engine?: string;
}

interface SearxResponse {
  results?: SearxResult[];
  answers?: string[];
  unresponsive_engines?: unknown[];
}

interface WebResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

// ─── Plugin state ───

let api: PluginAPI;

const DEFAULTS = {
  searxngUrl: 'http://localhost:8888',
  maxResults: 5,
  timeoutMs: 12_000,
};

function config<K extends keyof typeof DEFAULTS>(key: K): (typeof DEFAULTS)[K] {
  return (api.config.get<(typeof DEFAULTS)[K]>(key) ?? DEFAULTS[key]) as (typeof DEFAULTS)[K];
}

// ─── Lifecycle ───

export const onActivate = async (pluginApi: PluginAPI): Promise<void> => {
  api = pluginApi;
  api.logger.info(`Web plugin activated — SearXNG at ${config('searxngUrl')}`);
};

export const onDeactivate = async (): Promise<void> => {
  api.logger.info('Web plugin deactivated');
};

// ─── Helpers ───

/** Snippets are trimmed hard: five of them are a token budget, not a page. */
const SNIPPET_CHARS = 240;

export function trim(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** The host, for showing where an answer came from without the full URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Strips a page down to readable text.
 *
 * Deliberately crude — no DOM parser, no dependency. Script and style bodies go
 * first (they are the bulk of a modern page and pure noise), then tags, then
 * entities. Good enough to feed a summariser, and it cannot execute anything.
 */
export function extractText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? trim(decodeEntities(titleMatch[1] ?? ''), 120) : '';

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return { title, text: trim(decodeEntities(text), 8000) };
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config('timeoutMs'));
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Skills ───

export const executeTool = async (
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> => {
  switch (toolName) {
    case 'web.search': {
      const query = String(args['query'] ?? '').trim();
      if (!query) return { success: false, message: 'Say what to search for.' };

      const requested = Number(args['limit'] ?? config('maxResults'));
      const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 5, 1), 10);

      const endpoint =
        `${config('searxngUrl').replace(/\/$/, '')}/search` +
        `?q=${encodeURIComponent(query)}&format=json`;

      let body: SearxResponse;
      try {
        // Through api.http, not global fetch: `http:external` is a declared
        // permission and the guard is what enforces it. Reaching past it would
        // make the declaration decorative.
        body = await withTimeout(async (signal) => {
          const res = await api.http.get(endpoint, { signal });
          if (!res.ok) throw new Error(`SearXNG returned ${res.status}`);
          return (await res.json()) as SearxResponse;
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        api.logger.error(`search failed: ${reason}`);
        return {
          success: false,
          message: `Could not reach the search service (${reason}). Nothing was searched.`,
        };
      }

      const results: WebResult[] = (body.results ?? [])
        .filter((r): r is SearxResult & { url: string } => typeof r.url === 'string')
        .slice(0, limit)
        .map((r) => ({
          title: trim(r.title ?? hostOf(r.url), 120),
          url: r.url,
          snippet: trim(r.content ?? '', SNIPPET_CHARS),
          source: hostOf(r.url),
        }));

      if (results.length === 0) {
        return { query, results: [], count: 0, message: `No results for "${query}".` };
      }

      return {
        query,
        results,
        count: results.length,
        // Repeated in the result because the system prompt is not where the
        // model is looking when it reads a tool result.
        message: `${results.length} result(s) for "${query}". Answer from these and cite the URL you used.`,
      };
    }

    case 'web.read-page': {
      const url = String(args['url'] ?? '').trim();
      if (!url) return { success: false, message: 'Give me a URL to read.' };
      if (!/^https?:\/\//i.test(url)) {
        return { success: false, message: `"${url}" is not an http(s) URL.` };
      }

      let html: string;
      try {
        html = await withTimeout(async (signal) => {
          const res = await api.http.get(url, {
            signal,
            headers: { 'User-Agent': 'TARDIS/2.0 (self-hosted assistant)' },
          });
          if (!res.ok) throw new Error(`page returned ${res.status}`);
          const type = res.headers.get('content-type') ?? '';
          if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
            throw new Error(`not a readable page (${type || 'unknown type'})`);
          }
          return await res.text();
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { success: false, message: `Could not read ${hostOf(url)}: ${reason}` };
      }

      const { title, text } = extractText(html);
      if (text.length < 80) {
        return {
          success: false,
          message: `${hostOf(url)} had no readable text — it may be a JavaScript app or a paywall.`,
        };
      }

      // The isolated call. The main conversation never sees the page itself,
      // only what comes back from here.
      const question = String(args['question'] ?? '').trim();
      const instruction = question
        ? `Answer this question using only the page below: "${question}". ` +
          'If the page does not answer it, say so plainly rather than guessing.'
        : 'Summarise the page below in at most six sentences.';

      let summary: string;
      try {
        summary = await api.llm.generate(text, {
          systemPrompt:
            `${instruction} Use only what is on the page — do not add anything you happen to know. ` +
            'Be concise and factual. No preamble.',
          temperature: 0.2,
          maxTokens: 400,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { success: false, message: `Read ${hostOf(url)} but could not summarise it: ${reason}` };
      }

      return {
        url,
        title: title || hostOf(url),
        source: hostOf(url),
        summary: trim(summary, 2000),
        message: `Read ${hostOf(url)}. Cite this URL if you use it.`,
      };
    }

    default:
      return { success: false, message: `Unknown skill "${toolName}"` };
  }
};
