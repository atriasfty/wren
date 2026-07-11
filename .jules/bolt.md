## 2025-02-18 - Avoid O(N) database queries and O(N) API calls before determining relevance
**Learning:** Found a major architectural bottleneck where the Discord message event handler executed an O(N) database query (`enforceBan`) for every single message received by a server, and an O(replies) Discord API message fetch to determine the author of replied messages before it even determined if the message was relevant (mentions the bot, or in a source channel).
**Action:** Always check the fastest and cheapest preconditions (like `directlyMentioned`, `isSourceChannel`, or using cached objects / checking `mentions.repliedUser`) first. Delay expensive database queries and API calls until you are confident the data needs to be acted upon.

## 2025-02-18 - Defer Discord API message fetch based on partial message state
**Learning:** In discord.js, `guildId` and `channelId` properties are always available even on `PartialMessage` objects in the `messageUpdate` event handler. This means relevance logic (like checking if a channel is configured as a source channel) can be done *before* doing an expensive `newMessage.fetch()` API call.
**Action:** Use `newMessage.guildId` and `newMessage.channelId` early to discard irrelevant events before resolving the full `newMessage.guild` and `newMessage.channel` or calling `newMessage.fetch()`.
