## 2025-02-18 - Avoid O(N) database queries and O(N) API calls before determining relevance
**Learning:** Found a major architectural bottleneck where the Discord message event handler executed an O(N) database query (`enforceBan`) for every single message received by a server, and an O(replies) Discord API message fetch to determine the author of replied messages before it even determined if the message was relevant (mentions the bot, or in a source channel).
**Action:** Always check the fastest and cheapest preconditions (like `directlyMentioned`, `isSourceChannel`, or using cached objects / checking `mentions.repliedUser`) first. Delay expensive database queries and API calls until you are confident the data needs to be acted upon.
## 2024-05-18 - Fast precondition evaluation for discord events
**Learning:** In the discord.js (v14) implementation, `guildId` and `channelId` are always present, even on `PartialMessage` objects.
**Action:** When handling Discord message events, always evaluate fast preconditions (like relevance based on channel/guild IDs) before invoking expensive API operations like `newMessage.fetch()`.
