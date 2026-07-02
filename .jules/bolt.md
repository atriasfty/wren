## 2025-02-18 - Avoid O(N) database queries and O(N) API calls before determining relevance
**Learning:** Found a major architectural bottleneck where the Discord message event handler executed an O(N) database query (`enforceBan`) for every single message received by a server, and an O(replies) Discord API message fetch to determine the author of replied messages before it even determined if the message was relevant (mentions the bot, or in a source channel).
**Action:** Always check the fastest and cheapest preconditions (like `directlyMentioned`, `isSourceChannel`, or using cached objects / checking `mentions.repliedUser`) first. Delay expensive database queries and API calls until you are confident the data needs to be acted upon.

## 2025-07-02 - Redundant magnitude calculation in cosine similarity
**Learning:** The `@xenova/transformers` library pipeline configured with `{ normalize: true }` returns L2 normalized embeddings (magnitude of 1). Therefore, calculating the vector magnitudes via `Math.sqrt()` and diving by them in the cosine similarity loop is a completely redundant and costly operation compared to a pure dot product.
**Action:** When working with machine learning embeddings, verify if the model output is already normalized. If so, optimize vector similarity comparisons by using a pure dot product instead of the full cosine similarity formula.
