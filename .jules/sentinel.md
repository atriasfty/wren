## 2024-05-24 - [Express JSON SyntaxError Information Exposure]
**Vulnerability:** Express.js default error handler exposes HTML stack traces for malformed JSON payloads.
**Learning:** `express.json()` throws a SyntaxError (status 400) when parsing invalid JSON. Without a custom error handler placed immediately after it, Express's default error handler catches this and sends an HTML response containing the full stack trace, which can expose internal file paths and application structure.
**Prevention:** Always add a custom error handler immediately after `express.json()` (and similar body parsers) to catch `SyntaxError` (status 400) and return a generic JSON error response instead, ensuring `next(err)` is called for other errors.
