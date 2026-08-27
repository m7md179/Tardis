import { describe, it, expect } from 'bun:test';
import { buildSearchUrl, extractText, hostOf, trim } from './index.js';

// ─── Turning a page into something a small model can read ────────────────────
//
// `web.read-page` exists so a 40kb article never reaches the conversation. That
// only holds if the extractor actually strips the page down — a modern page is
// mostly script and style, and feeding those to the summariser would waste the
// budget on minified JavaScript and leave no room for the article.

describe('extractText', () => {
  it('takes the title', () => {
    const { title } = extractText('<html><head><title>  Exchange rates </title></head><body>x</body></html>');
    expect(title).toBe('Exchange rates');
  });

  it('drops script and style bodies entirely', () => {
    const html = `
      <html><head><style>.a{color:red}</style></head>
      <body><script>var secret = "TOKEN123";</script><p>The rate is 1.41.</p></body></html>`;
    const { text } = extractText(html);
    expect(text).toContain('The rate is 1.41.');
    expect(text).not.toContain('TOKEN123');
    expect(text).not.toContain('color:red');
  });

  it('drops comments, which can be large and are never content', () => {
    const { text } = extractText('<body><!-- build id 8f2a --><p>Hello</p></body>');
    expect(text).toContain('Hello');
    expect(text).not.toContain('8f2a');
  });

  it('decodes the entities that would otherwise reach the model as noise', () => {
    const { text } = extractText('<body><p>Tom &amp; Jerry &quot;quoted&quot; &#39;s&#39;</p></body>');
    expect(text).toContain('Tom & Jerry "quoted" \'s\'');
  });

  it('caps the text, so one long page cannot blow the context', () => {
    const long = `<body><p>${'word '.repeat(5000)}</p></body>`;
    expect(extractText(long).text.length).toBeLessThanOrEqual(8000);
  });

  it('survives a page with no title', () => {
    expect(extractText('<body><p>Bare</p></body>').title).toBe('');
  });
});

describe('hostOf', () => {
  it('names the source without the full URL', () => {
    expect(hostOf('https://www.xe.com/currencyconverter/convert/?Amount=1')).toBe('xe.com');
  });

  it('returns the input unchanged when it is not a URL', () => {
    expect(hostOf('not a url')).toBe('not a url');
  });
});

describe('trim', () => {
  it('collapses whitespace so snippets stay on one line', () => {
    expect(trim('  a\n\n  b\t c ', 100)).toBe('a b c');
  });

  it('marks where it cut, so a truncated snippet is not read as a full one', () => {
    const out = trim('abcdefghij', 5);
    expect(out).toHaveLength(5);
    expect(out.endsWith('…')).toBe(true);
  });
});

// ─── The endpoint ────────────────────────────────────────────────────────────
//
// `api.config.get` is async. Calling it inline and using the result as a value
// gives a Promise, and the first deploy logged "SearXNG at [object Promise]" —
// the same mistake that once printed "[object Promise]" into formatted money.
// Types did not catch it and neither did any test, so the invariant is checked
// here at the point where a bad base URL would otherwise be concatenated into a
// request that quietly returns nothing.

describe('buildSearchUrl', () => {
  it('builds a search URL and encodes the query', () => {
    expect(buildSearchUrl('http://localhost:8888', 'jod to usd')).toBe(
      'http://localhost:8888/search?q=jod%20to%20usd&format=json'
    );
  });

  it('tolerates a trailing slash on the base', () => {
    expect(buildSearchUrl('http://localhost:8888/', 'x')).toContain('8888/search?q=x');
  });

  it('throws on a Promise rather than searching "[object Promise]"', () => {
    expect(() => buildSearchUrl(Promise.resolve('http://localhost:8888'), 'x')).toThrow(
      /not a usable URL/
    );
  });

  it('throws on an empty or malformed base', () => {
    expect(() => buildSearchUrl('', 'x')).toThrow(/not a usable URL/);
    expect(() => buildSearchUrl('localhost:8888', 'x')).toThrow(/not a usable URL/);
  });
});
