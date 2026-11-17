## 2024-07-23 - Prevent Express HTML Stack Traces
**Vulnerability:** Express app exposed HTML stack traces when a malformed JSON payload was submitted.
**Learning:** `express.json()` will throw a `SyntaxError` (status 400) if the payload is malformed. If no custom error handler is placed immediately after `express.json()`, the default Express error handler will catch it and return an HTML page containing the stack trace.
**Prevention:** Always place a custom error handler immediately after `express.json()` to catch `SyntaxError` (status 400) and return a clean JSON error response instead of exposing internal details. Ensure the handler calls `next(err)` for non-matching errors so it doesn't swallow other application errors.
