## 2026-07-25 - Automated Security Review
**Vulnerability:** Several vulnerabilities including Express JSON malformed parsing, SSRF in Brave/Bloxlink integrations via global `fetch`, and missing X-Powered-By disable in Express API.
**Learning:** In `express.json()` middlewares, `SyntaxError` on malformed bodies can leak stack traces if not caught right after. Third-party integrations making outbound requests using `fetch` risk SSRF if the inputs are influenced by users.
**Prevention:** Use `safeFetch` configured with internal DNS blocklists, disable `x-powered-by`, and catch Express errors early with `app.use((err, req, res, next) => { ... })`.
