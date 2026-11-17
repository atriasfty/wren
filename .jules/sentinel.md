## 2026-07-11 - Automated Security Review fixes
**Vulnerability:** Path Traversal via custom `fetch` for `file://` URLs in `src/discord/voice/manager.js`.
**Learning:** Overriding global fetch to support `file://` URLs allows reading arbitrary local files if user input controls the URL.
**Prevention:** Always validate that resolved file paths start with the intended root directory using `path.resolve` and checking `startsWith` against the allowed directory.
