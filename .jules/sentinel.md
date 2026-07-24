## 2024-05-24 - Express JSON Parsing Error Exposes Internal Paths
**Vulnerability:** The default Express error handler was exposing internal server paths and full stack traces via an HTML response when `express.json()` encountered malformed JSON.
**Learning:** `express.json()` throws a `SyntaxError` with status 400 when it fails to parse JSON. If not caught immediately by a custom error handler, this error falls through to the default Express error handler, which generates an HTML page leaking internal node_modules and file paths.
**Prevention:** Always place a custom error handler middleware `app.use((err, req, res, next) => { ... })` immediately following `app.use(express.json())` to catch `err instanceof SyntaxError` with a 400 status code, and return a secure, generic JSON response.
