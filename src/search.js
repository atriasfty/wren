import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Search the web using DuckDuckGo Instant Answer API
 */
export async function webSearch(query, maxResults = 5) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&t=garminbot`;

    // Add 10-second timeout to prevent hanging
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`DuckDuckGo error: ${res.status}`);
    const data = await res.json();

    const results = [];
    if (data.AbstractText) {
      results.push({
        title: data.Heading || 'DuckDuckGo',
        snippet: data.AbstractText,
        url: data.AbstractURL || ''
      });
    }

    // Related topics
    if (data.RelatedTopics && data.RelatedTopics.length) {
      for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
        if (topic.Text) {
          results.push({
            title: topic.Text.split(' - ')[0],
            snippet: topic.Text,
            url: topic.FirstURL || ''
          });
        } else if (topic.Topics) {
          for (const t of topic.Topics.slice(0, maxResults - results.length)) {
            results.push({
              title: t.Text.split(' - ')[0],
              snippet: t.Text,
              url: t.FirstURL || ''
            });
          }
        }
      }
    }

    return results.slice(0, maxResults);
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('webSearch timeout: DuckDuckGo API took too long');
    } else {
      console.error('webSearch error:', error);
    }
    return [];
  }
}

/**
 * Search Discord messages in the server using Discord's search API
 * Returns relevant messages that might help answer the question
 */
export async function searchDiscordMessages(guild, query, maxResults = 10, allowedChannelIds = null) {
  try {
    console.log(`🔍 Searching Discord messages for: "${query}"`);

    // Get channels to search
    let channels = guild.channels.cache.filter(ch => ch.isTextBased() && ch.permissionsFor(guild.members.me).has('ReadMessageHistory'));

    // Filter by allowed channel IDs if provided
    if (allowedChannelIds && allowedChannelIds.length > 0) {
      channels = channels.filter(ch => allowedChannelIds.includes(ch.id));
      console.log(`🔍 Limiting search to ${channels.size} specific channels`);
    }

    // Pre-process query once
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2); // Lowered from 3 to 2

    // Search all channels in parallel for speed
    const searchPromises = Array.from(channels.values()).map(async (channel) => {
      try {
        // Fetch fewer messages per channel (50 instead of 100) to speed up
        const messages = await channel.messages.fetch({ limit: 50 });

        const matched = [];
        for (const msg of messages.values()) {
          // Skip bot messages
          if (msg.author.bot) continue;

          const content = msg.content.toLowerCase();

          // Score the match: how many query words appear in the message
          let matchScore = 0;
          for (const word of queryWords) {
            if (content.includes(word)) matchScore++;
          }

          // Only include messages that match at least one query word
          if (matchScore > 0) {
            matched.push({
              author: msg.author.username,
              content: msg.content,
              timestamp: msg.createdAt.toISOString(),
              channel: channel.name,
              url: msg.url,
              score: matchScore,
              relevance: matchScore / queryWords.length // Percentage of query words matched
            });
          }
        }

        return matched;
      } catch (err) {
        console.log(`⚠️ Could not search channel ${channel.name}:`, err.message);
        return [];
      }
    });

    // Wait for all channel searches to complete
    const allResults = await Promise.all(searchPromises);

    // Flatten and sort by relevance score
    const results = allResults
      .flat()
      .sort((a, b) => b.score - a.score) // Sort by score (higher is better)
      .slice(0, maxResults);

    console.log(`✓ Found ${results.length} relevant Discord messages (searched ${channels.size} channels in parallel)`);
    return results;

  } catch (error) {
    console.error('searchDiscordMessages error:', error);
    return [];
  }
}

/**
 * Fetch and extract main content from a webpage
 * @param {string} url - The URL to fetch
 * @returns {Promise<{title: string, content: string, url: string}>}
 */
export async function fetchWebpage(url) {
  try {
    console.log(`🌐 Fetching webpage: ${url}`);

    // Add timeout and headers
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GarminBot/1.0; +https://discord.com)'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`Failed to fetch ${url}: ${res.status}`);
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Remove scripts, styles, and nav elements
    $('script, style, nav, header, footer, aside, .ad, .advertisement').remove();

    // Extract title
    const title = $('title').text() || $('h1').first().text() || 'Webpage';

    // Try to find main content
    let content = '';

    // Try common content containers
    const contentSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '.article-content',
      '#content',
      '.entry-content'
    ];

    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length) {
        content = element.text();
        break;
      }
    }

    // Fallback to body if no content found
    if (!content || content.length < 100) {
      content = $('body').text();
    }

    // Clean up whitespace
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim()
      .substring(0, 5000); // Limit to 5000 chars

    if (!content || content.length < 50) {
      console.error(`Insufficient content extracted from ${url}`);
      return null;
    }

    console.log(`✓ Extracted ${content.length} characters from ${url}`);

    return {
      title: title.trim().substring(0, 200),
      content,
      url
    };

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`Timeout fetching ${url}`);
    } else {
      console.error(`Error fetching webpage ${url}:`, error.message);
    }
    return null;
  }
}

/**
 * Extract URLs from a message
 * @param {string} message - The message to extract URLs from
 * @returns {string[]} - Array of URLs found
 */
export function extractUrls(message) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = message.match(urlRegex) || [];
  return matches.map(url => url.replace(/[,.!?;)]$/, '')); // Remove trailing punctuation
}
