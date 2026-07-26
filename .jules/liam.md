## 2026-07-26 - Express Stack Trace Leakage via JSON SyntaxError
**Vulnerability:** Unhandled JSON SyntaxError (e.g. from express.json) and generic unhandled exceptions leak internal HTML stack traces instead of failing securely.
**Learning:** The default Express error handler reveals stack traces to clients when `next(err)` is called, especially when middleware like `express.json()` throws a SyntaxError on malformed input. This bypasses typical route logic.
**Prevention:** Always add a custom error handler immediately after body parsers to trap SyntaxErrors and return generic JSON, and add a global error handler at the end of the app definition.
