## 2025-02-18 - Avoid O(N) database queries and O(N) API calls before determining relevance
**Learning:** Found a major architectural bottleneck where the Discord message event handler executed an O(N) database query (`enforceBan`) for every single message received by a server, and an O(replies) Discord API message fetch to determine the author of replied messages before it even determined if the message was relevant (mentions the bot, or in a source channel).
**Action:** Always check the fastest and cheapest preconditions (like `directlyMentioned`, `isSourceChannel`, or using cached objects / checking `mentions.repliedUser`) first. Delay expensive database queries and API calls until you are confident the data needs to be acted upon.

## 2026-07-04 - Batch independent database queries and API calls on hot paths
**Learning:** The Discord message processing hot path executed three independent database checks (`global_state`, `global_bans`, `user_agreements`) and potentially a Discord API fetch sequentially. Since they did not depend on each other, they were blocking the processing of valid requests.
**Action:** Use `Promise.all()` to concurrently fetch independent conditions that determine whether a request can be processed. Ensure independent promises fail gracefully instead of breaking the entire chain.
