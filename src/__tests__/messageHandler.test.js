import { describe, it, expect, vi, beforeEach } from 'vitest';
import { splitForDiscord } from '../discord/messageHandler.js';

const mocks = {
  resolveTenantByGuildId: vi.fn(),
  runAssistantPipeline: vi.fn(),
  enforceBan: vi.fn(),
};

vi.mock('../tenant/resolve.js', () => ({
  resolveTenantByGuildId: (...args) => mocks.resolveTenantByGuildId(...args),
}));

vi.mock('../ai/pipeline.js', () => ({
  runAssistantPipeline: (...args) => mocks.runAssistantPipeline(...args),
}));

// We mock guards.js with the path relative to the test file
vi.mock('../discord/guards.js', () => ({
  enforceBan: (...args) => mocks.enforceBan(...args),
}));

describe('messageHandler and helpers', () => {
  let attachMessageHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const mod = await import('../discord/messageHandler.js');
    attachMessageHandler = mod.attachMessageHandler;
  });

  describe('splitForDiscord', () => {
    it('returns empty array with single empty string for empty input', () => {
      expect(splitForDiscord('')).toEqual(['']);
      expect(splitForDiscord(null)).toEqual(['']);
    });

    it('returns single element if text length <= limit', () => {
      expect(splitForDiscord('hello', 10)).toEqual(['hello']);
    });

    it('splits text at last newline within limit', () => {
      const text = 'line one\nline two\nline three';
      // limit = 18 covers "line one\nline two" (17 chars). "line three" starts after newline.
      expect(splitForDiscord(text, 18)).toEqual([
        'line one\nline two',
        'line three'
      ]);
    });

    it('splits text at last space within limit if newline is too far back', () => {
      const text = 'word1 word2 word3';
      // limit = 12 covers "word1 word2" (11 chars).
      expect(splitForDiscord(text, 12)).toEqual([
        'word1 word2',
        'word3'
      ]);
    });

    it('force-splits at limit if no space or newline is found within the limit window', () => {
      const text = 'abcdefghijk';
      expect(splitForDiscord(text, 5)).toEqual([
        'abcde',
        'fghij',
        'k'
      ]);
    });
  });

  describe('messageCreate event processing', () => {
    let client, mockMessage, mockChannel;

    beforeEach(() => {
      mockChannel = {
        isTextBased: () => true,
        messages: {
          fetch: vi.fn().mockResolvedValue(new Map()),
        },
        sendTyping: vi.fn().mockResolvedValue(true),
        send: vi.fn().mockResolvedValue(true),
      };

      mockMessage = {
        guild: { id: 'guild-123', name: 'Test Guild' },
        author: { id: 'user-456', username: 'TestUser', bot: false },
        member: { id: 'user-456' },
        channel: mockChannel,
        content: '<@bot-123> what is the rules?',
        mentions: {
          users: {
            has: vi.fn((id) => id === 'bot-123'),
          },
        },
        attachments: {
          values: () => [],
        },
        reply: vi.fn().mockResolvedValue(true),
        react: vi.fn().mockResolvedValue(true),
      };

      client = {
        user: { id: 'bot-123' },
        on: vi.fn(),
      };

      mocks.resolveTenantByGuildId.mockResolvedValue({
        tenantId: 'guild-123',
        tenant: {},
      });
      mocks.enforceBan.mockResolvedValue(false);
      mocks.runAssistantPipeline.mockResolvedValue({ text: 'This is the answer.' });
    });

    it('subscribes to messageCreate on attachMessageHandler', () => {
      attachMessageHandler(client);
      expect(client.on).toHaveBeenCalledWith('messageCreate', expect.any(Function));
    });

    it('ignores messages from the bot itself or other bots', async () => {
      attachMessageHandler(client);
      const handler = client.on.mock.calls[0][1];

      // Bot author
      mockMessage.author.id = 'bot-123';
      await handler(mockMessage);
      expect(mocks.resolveTenantByGuildId).not.toHaveBeenCalled();

      // Another bot
      mockMessage.author.id = 'other-bot';
      mockMessage.author.bot = true;
      await handler(mockMessage);
      expect(mocks.resolveTenantByGuildId).not.toHaveBeenCalled();
    });

    it('ignores messages not in a guild', async () => {
      attachMessageHandler(client);
      const handler = client.on.mock.calls[0][1];

      mockMessage.guild = null;
      await handler(mockMessage);
      expect(mocks.resolveTenantByGuildId).not.toHaveBeenCalled();
    });

    it('replies warning if guild is not configured as tenant and bot is mentioned', async () => {
      attachMessageHandler(client);
      const handler = client.on.mock.calls[0][1];

      mocks.resolveTenantByGuildId.mockResolvedValue(null);
      await handler(mockMessage);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.stringContaining('This server is not configured with Wren yet')
      );
    });

    it('applies ban checks and blocks user if banned', async () => {
      attachMessageHandler(client);
      const handler = client.on.mock.calls[0][1];

      mocks.enforceBan.mockResolvedValue(true);
      await handler(mockMessage);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.stringContaining('You are blocked from using this bot')
      );
      expect(mocks.runAssistantPipeline).not.toHaveBeenCalled();
    });

    it('ignores message if not mentioned and not a reply to the bot', async () => {
      attachMessageHandler(client);
      const handler = client.on.mock.calls[0][1];

      mockMessage.content = 'Just random chatter';
      mockMessage.mentions.users.has.mockReturnValue(false);
      mockMessage.reference = null;

      await handler(mockMessage);
      expect(mocks.runAssistantPipeline).not.toHaveBeenCalled();
    });

    it('processes messages that are replies to the bot', async () => {
      attachMessageHandler(client);
      const handler = client.on.mock.calls[0][1];

      mockMessage.content = 'Follow-up question';
      mockMessage.mentions.users.has.mockReturnValue(false);
      mockMessage.reference = { messageId: 'msg-999' };
      mockChannel.messages.fetch.mockResolvedValueOnce({
        author: { id: 'bot-123' },
      });

      await handler(mockMessage);
      expect(mocks.runAssistantPipeline).toHaveBeenCalled();
    });

    it('guards against concurrent requests (inFlight map)', async () => {
      attachMessageHandler(client);
      const handler = client.on.mock.calls[0][1];

      // Set up pipeline mock to delay so request remains inFlight
      let resolvePipeline;
      const pipelinePromise = new Promise((resolve) => {
        resolvePipeline = resolve;
      });
      mocks.runAssistantPipeline.mockReturnValueOnce(pipelinePromise);

      // Trigger first message (will remain inFlight)
      const promise1 = handler(mockMessage);

      // Yield event loop to let the first call reach the inFlight register and pause on pipeline run
      await new Promise((r) => setTimeout(r, 10));

      // Trigger second message from same user concurrently
      await handler(mockMessage);

      expect(mockMessage.react).toHaveBeenCalledWith('\u23f3'); // sandglass reaction for rate-limit
      expect(mocks.runAssistantPipeline).toHaveBeenCalledTimes(1);

      // Clean up first call
      resolvePipeline({ text: 'Finally done' });
      await promise1;
    });

    it('splits long response text into multiple Discord messages', async () => {
      attachMessageHandler(client);
      const handler = client.on.mock.calls[0][1];

      const longAnswer = 'A'.repeat(2500) + '\n' + 'B'.repeat(1000);
      mocks.runAssistantPipeline.mockResolvedValue({ text: longAnswer });

      await handler(mockMessage);

      expect(mockMessage.reply).toHaveBeenCalledTimes(1);
      // Second chunk should be sent via send()
      expect(mockChannel.send).toHaveBeenCalledTimes(1);
    });

    it('replies with error message if assistant pipeline crashes', async () => {
      attachMessageHandler(client);
      const handler = client.on.mock.calls[0][1];

      mocks.runAssistantPipeline.mockRejectedValue(new Error('Mistral quota exceeded'));

      await handler(mockMessage);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.stringContaining('Sorry, something went wrong: Mistral quota exceeded')
      );
    });
  });
});
