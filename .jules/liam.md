## 2024-05-18 - Prevent Express Information Leakage on Malformed JSON
**Vulnerability:** Information Leakage via Express' body-parser on Malformed JSON Requests
**Learning:** By default, Express' body-parser will throw a `SyntaxError` when it encounters malformed JSON, bubbling the error up to the default Express error handler, which often returns the stack trace in a 500 or 400 response. This leaks internal code paths and package versions.
**Prevention:** In Express servers, always insert an error handling middleware `app.use((err, req, res, next) => { ... })` specifically checking for `err instanceof SyntaxError` immediately after the `express.json()` middleware. This safely intercepts parsing errors without affecting normal application error flows.
