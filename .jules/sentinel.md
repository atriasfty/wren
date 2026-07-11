## 2026-07-11 - JSON SyntaxError DoS and Expensive DB Queries
**Vulnerability:** Express app swallowing or exposing stack traces on malformed JSON via body-parser. Discord message handler executing expensive DB checks before fast preconditions.
**Learning:** Middleware order and early returns are critical for application resilience against DoS and memory exhaustion attacks.
**Prevention:** Always place custom SyntaxError handlers directly after express.json(), and evaluate fast/cheap logical preconditions before hitting the database or external APIs.
