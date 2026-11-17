## 2026-07-12 - Secure Express error handling and Headers
**Vulnerability:** Express app throwing SyntaxError on malformed JSON payload returned a full HTML stack trace, causing information leakage. Additionally, 'x-powered-by' was enabled by default.
**Learning:** `app.disable('x-powered-by')` should be called once globally on the app instance, rather than inside a middleware where it executes on every request. Catching body-parser SyntaxErrors correctly requires a 4-argument middleware immediately after the parser.
**Prevention:** Add explicit `app.disable('x-powered-by')` during app initialization. Always add a targeted error-handler middleware after `express.json()` to intercept and normalize `SyntaxError`s before they hit the default error handler.
