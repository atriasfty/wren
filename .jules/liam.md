## 2024-07-22 - Prevented stack trace leakage on malformed JSON
**Vulnerability:** Express.js default error handler exposes HTML stack traces when `express.json()` encounters malformed JSON, leaking internal structure.
**Learning:** In Express APIs, always add a custom error handler immediately after body parsing middleware to catch `SyntaxError` exceptions and return a sanitized JSON response.
**Prevention:** Apply a `(err, req, res, next)` middleware that intercepts 400 SyntaxErrors specifically, returning a safe generic message before the default handler is triggered.
