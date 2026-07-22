
## 2024-05-01 - Express JSON Body Parsing Stack Trace Leak
**Vulnerability:** Malformed JSON bodies sent to `express.json()` would cause the default Express error handler to trigger, returning a 400 status but exposing the full HTML stack trace to the client.
**Learning:** By default, if `express.json()` fails to parse (e.g. `SyntaxError`), it throws an error that falls through to Express's built-in error handler. This handler renders an HTML page with the stack trace, which leaks internal application details.
**Prevention:** Always place a custom error handler immediately after `express.json()` (or other body parsers) to catch `SyntaxError` with status 400, returning a generic JSON error response and passing other errors to `next(err)`.
