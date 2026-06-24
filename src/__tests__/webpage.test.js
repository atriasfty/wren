import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWebpage, extractUrls } from '../integrations/search/webpage.js';

function mockFetch(status, body, isOk = true) {
  globalThis.fetch = vi.fn(async () => {
    return {
      ok: isOk,
      status,
      text: async () => body,
    };
  });
}

describe('fetchWebpage', () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;

  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });

  it('successfully fetches and parses article selector content', async () => {
    const html = `
      <html>
        <head><title>Test Title</title></head>
        <body>
          <header>Header content to be removed</header>
          <nav>Nav content to be removed</nav>
          <article>
            This is the main article content. It is long enough to pass the 100 character threshold.
            Let's make sure it contains enough text to satisfy the minimum requirements for extraction.
          </article>
          <aside>Sidebar advertisement</aside>
          <footer>Footer content</footer>
        </body>
      </html>
    `;
    mockFetch(200, html, true);

    const result = await fetchWebpage('https://example.com');
    expect(result).not.toBeNull();
    expect(result.title).toBe('Test Title');
    expect(result.url).toBe('https://example.com');
    expect(result.content).toContain('This is the main article content.');
    // Check that excluded tags are stripped
    expect(result.content).not.toContain('Header content');
    expect(result.content).not.toContain('Nav content');
    expect(result.content).not.toContain('Footer content');
  });

  it('falls back to body if specific content selectors match but are too short', async () => {
    const html = `
      <html>
        <head><title>Short Article Page</title></head>
        <body>
          <article>Short article.</article>
          <div class="main-body-content">
            This is the main body content of the webpage. It is long enough to bypass any short length filters and serve as the main source of text.
            Let's make sure it contains enough text to satisfy the minimum requirements for extraction.
          </div>
        </body>
      </html>
    `;
    mockFetch(200, html, true);

    const result = await fetchWebpage('https://example.com');
    expect(result).not.toBeNull();
    expect(result.content).toContain('This is the main body content of the webpage.');
    expect(result.content).toContain('Short article.');
  });

  it('falls back to first h1 if title tag is missing', async () => {
    const html = `
      <html>
        <body>
          <h1>First Heading Title</h1>
          <article>
            This is some long content to make sure the fetch succeeds and is not marked as too short.
            It contains enough text to satisfy the minimum length.
          </article>
        </body>
      </html>
    `;
    mockFetch(200, html, true);

    const result = await fetchWebpage('https://example.com');
    expect(result.title).toBe('First Heading Title');
  });

  it('uses default "Webpage" if title and h1 are missing', async () => {
    const html = `
      <html>
        <body>
          <article>
            This is some long content to make sure the fetch succeeds and is not marked as too short.
            It contains enough text to satisfy the minimum length.
          </article>
        </body>
      </html>
    `;
    mockFetch(200, html, true);

    const result = await fetchWebpage('https://example.com');
    expect(result.title).toBe('Webpage');
  });

  it('truncates content and title based on limits', async () => {
    const html = `
      <html>
        <head><title>${'A'.repeat(300)}</title></head>
        <body>
          <article>
            ${'B'.repeat(6000)}
          </article>
        </body>
      </html>
    `;
    mockFetch(200, html, true);

    const result = await fetchWebpage('https://example.com', { maxChars: 1000 });
    expect(result.title.length).toBe(200);
    expect(result.content.length).toBe(1000);
  });

  it('returns null if content is under 50 characters', async () => {
    const html = `
      <html>
        <head><title>Short Page</title></head>
        <body>
          <article>Tiny page content</article>
        </body>
      </html>
    `;
    mockFetch(200, html, true);

    const result = await fetchWebpage('https://example.com');
    expect(result).toBeNull();
  });

  it('returns null if response is not ok', async () => {
    mockFetch(404, 'Not Found', false);

    const result = await fetchWebpage('https://example.com');
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[webpage] failed https://example.com: 404'));
  });

  it('returns null on fetch network exception', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

    const result = await fetchWebpage('https://example.com');
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[webpage] error https://example.com: Network offline'));
  });

  it('returns null on fetch timeout / AbortError', async () => {
    globalThis.fetch = vi.fn(async (url, options) => {
      if (options.signal) {
        if (options.signal.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        return new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      }
    });

    // Run fetchWebpage with a very short timeout (1ms) to force trigger the AbortController
    const result = await fetchWebpage('https://example.com', { timeoutMs: 1 });
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[webpage] timeout https://example.com'));
  });
});

describe('extractUrls', () => {
  it('extracts normal URLs correctly', () => {
    const text = 'Check out https://google.com and http://example.org/path?query=1 for details.';
    const urls = extractUrls(text);
    expect(urls).toEqual([
      'https://google.com',
      'http://example.org/path?query=1'
    ]);
  });

  it('strips trailing punctuation from extracted URLs', () => {
    const text = 'Go to https://google.com, or http://example.org/foo. Is it http://test.com/bar? Yes (https://site.org/page).';
    const urls = extractUrls(text);
    expect(urls).toEqual([
      'https://google.com',
      'http://example.org/foo',
      'http://test.com/bar',
      'https://site.org/page'
    ]);
  });

  it('returns empty array if no URLs are found', () => {
    const text = 'This is just some plain text without any links.';
    expect(extractUrls(text)).toEqual([]);
  });
});
