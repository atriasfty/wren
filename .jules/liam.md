## 2024-07-11 - Error Handling Exposing Internal Details
**Vulnerability:** Express default error handler returning HTML stack traces on malformed JSON bodies.
**Learning:** `express.json()` can throw `SyntaxError` on malformed input. If uncaught, Express's default error handler returns a generic HTML page that may leak internals or create noise.
**Prevention:** Add a custom error handler directly after `app.use(express.json())` that specifically checks for `err instanceof SyntaxError && err.status === 400` to return a safe JSON response and `next(err)` otherwise.
