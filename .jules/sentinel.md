## 2024-08-03 - Express Error Handling and Information Disclosure
**Vulnerability:** Express default error handlers return HTML stack traces for unhandled exceptions (like `SyntaxError` on malformed JSON).
**Learning:** In API environments, a custom error handler must immediately follow `express.json()` to catch `SyntaxError` and respond with JSON. Furthermore, a global error handler at the end of the route middleware chain is required to catch generic unhandled exceptions.
**Prevention:** Always implement both a specific `SyntaxError` handler for `express.json()` and a global `500` catch-all error handler at the end of route declarations before sending the application response. Use `app.disable('x-powered-by')` over overriding the header.
