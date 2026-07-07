## 2025-02-18 - Avoid O(N) database queries and O(N) API calls before determining relevance
**Learning:** Found a major architectural bottleneck where the Discord message event handler executed an O(N) database query (`enforceBan`) for every single message received by a server, and an O(replies) Discord API message fetch to determine the author of replied messages before it even determined if the message was relevant (mentions the bot, or in a source channel).
**Action:** Always check the fastest and cheapest preconditions (like `directlyMentioned`, `isSourceChannel`, or using cached objects / checking `mentions.repliedUser`) first. Delay expensive database queries and API calls until you are confident the data needs to be acted upon.

## 2025-02-18 - Optimization of cosine similarity function
**Learning:** Found that `@xenova/transformers` generates vector embeddings with magnitude 1 (unit length) by default when `normalize: true` is set. As a result, calculating the magnitudes for cosine similarity in the `cosine` function is a redundant and computationally expensive operation.
**Action:** Replaced the full cosine similarity formula with a much faster simple dot product calculation for normalized vectors.
