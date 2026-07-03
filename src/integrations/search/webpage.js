import * as cheerio from 'cheerio';
import { safeFetch } from '../../ai/ssrf.js';

export async function fetchWebpage(url, { timeoutMs = 10_000, maxChars = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // safeFetch blocks private/loopback/metadata addresses (and re-checks every
    // redirect hop) — source URLs are tenant-supplied and must not reach
    // internal services.
    const res = await safeFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WrenBot/1.0; +https://discord.com)' },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[webpage] failed ${url}: ${res.status}`);
      return null;
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer, aside, .ad, .advertisement').remove();
    const title = $('title').text() || $('h1').first().text() || 'Webpage';
    let content = '';
    const selectors = ['article', 'main', '[role="main"]', '.content', '.post-content', '.article-content', '#content', '.entry-content'];
    for (const sel of selectors) {
      const el = $(sel).first();
      if (el.length) { content = el.text(); break; }
    }
    if (!content || content.length < 100) content = $('body').text();
    content = content.replace(/\s+/g, ' ').replace(/\n+/g, '\n').trim().substring(0, maxChars);
    if (!content || content.length < 50) return null;
    return { title: title.trim().substring(0, 200), content, url };
  } catch (err) {
    if (err.name === 'AbortError') console.error(`[webpage] timeout ${url}`);
    else console.error(`[webpage] error ${url}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function extractUrls(text) {
  const re = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(re) || [];
  return matches.map((u) => u.replace(/[,.!?;)]+$/, ''));
}