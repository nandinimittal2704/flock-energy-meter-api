# Engineering Reflection — Flock Take-Home Assignment

## 1. What assumptions did you make?

1. **Session Lifetime Stability:** I assumed the portal's session cookie (`__Secure-better-auth.session_token`) follows its declared `Max-Age=3600` (1 hour) expiration policy, but I designed defensively with a conservative 50-minute proactive refresh window and automatic re-authentication upon encountering HTTP 303/401 redirects.
2. **Read-Only Invariant:** I assumed that all upstream endpoints under `/portal/*` are strictly idempotent and read-only. I ensured my service never issues `POST`, `PUT`, or `DELETE` requests to data endpoints.
3. **Dataset Scale & Freshness:** With 403 meters in the Urja instance, I assumed the asset registry and grid hierarchy change infrequently compared to interval readings. I introduced a 5-minute in-memory cache for full meter hierarchy trees while leaving consumption queries un-cached to ensure real-time telemetry.
4. **Data Model Completeness:** I assumed meters without explicit GPS coordinates in nameplate parameters could have coordinates in the separate `/portal/meters/:id/geo` resource, which proved correct upon investigating the compiled client scripts.

---

## 2. Which part was the most difficult, and how did you get unstuck?

The most difficult challenge was discovering how the portal actually fetched data once the user logged in:

- **The Red Herring:** Fetching `GET /meters` or `GET /meters/__data.json` returned SvelteKit server-rendered HTML and empty user session nodes rather than the 403 meter records displayed in the browser. Initial attempts to query `/api/meters` or `/data/meters` returned 404s.
- **How I Got Unstuck:** Instead of guessing endpoints or attempting blind brute force, I downloaded and inspected the compiled SvelteKit JavaScript bundles served by the portal (`app.03ZTmlg3.js` and component nodes `5.C4dYcCRt.js`, `6.l777LXKL.js`, and `4.2Bgc2kUI.js`). De-minifying those files immediately revealed the true internal API contract:
  - The client-side table calls `fetch('/portal/meters/search?q=' + q + '&page=' + page)`
  - The detail view calls `fetch('/portal/meters/' + id + '/geo')` and `fetch('/portal/meters/' + id + '/energy')`
  - The export button generates an HMAC-SHA256 signature using a secret fetched from `/portal/keys`
  
Extracting the actual JavaScript client code replaced ambiguity with 100% verified certainty.

---

## 3. What would you improve with another day?

1. **Persistent Cache & Invalidation Hooks:** Replace the simple in-memory TTL cache with Redis or an LRU cache with ETag/Conditional GET headers (`If-None-Match`), allowing horizontally scaled API replicas to share cached grid hierarchy data.
2. **Time-Series Downsampling and Aggregation:** The consumption endpoint currently returns raw 30-minute interval readings with optional date-range filtering. With more time, I would add server-side aggregation queries (e.g., hourly averages, daily peak demand in kW, cumulative daily kWh, and power factor calculations) to reduce payload sizes and support dashboard trend views without client-side computation.
3. **Rate Limiting & Circuit Breaker:** Add `express-rate-limit` on the public API and a Circuit Breaker pattern (e.g. Cockatiel or Opossum) around the legacy portal connection to protect the fragile legacy system from upstream stampedes.
4. **Interactive OpenAPI UI:** Mount Swagger UI or Scalar directly on `/docs` so consumers can interactively test API endpoints directly in their web browser.

---

## 4. What mistake did you make while solving this?

When initially testing form submission to `/login`, requests failed with HTTP `403 Forbidden` despite valid credentials and correct urlencoded body data. 

My initial diagnosis was that SvelteKit was expecting a hidden CSRF token or multipart form boundary. In reality, modern SvelteKit implements built-in cross-site request forgery protection that strictly verifies the HTTP `Origin` header against the host header. Once I set `Origin: https://urja-ops.flockenergy.tech` on the POST request, the login succeeded immediately and returned the session token. Recognizing that modern web frameworks enforce strict Origin validation was an important troubleshooting milestone.

---

## 5. If you were reviewing your own submission, what would you criticise?

1. **Coupling of Single-Meter Lookup to Bulk Export Cache:** While caching the 403 meters from the bulk export endpoint provides sub-millisecond response times for `/api/meters/:id` and `/api/network`, in a utility with 500,000 meters, fetching the full export to serve a single meter lookup would not scale. For a production utility of enterprise scale, I would implement direct single-record reads or index records into a search database (Elasticsearch/PostgreSQL).
2. **Lack of Automated Live Smoke Test in CI:** The test suite uses comprehensive mocked unit and integration tests (30 passing tests across 7 test suites) so tests run deterministically in CI without network dependencies. However, adding a flag-triggered live smoke test script (`npm run test:live`) configured with live credentials would allow CI pipelines to verify portal health before deployment.
3. **Absence of Prometheus Metrics:** While structured JSON logging via Pino is implemented, adding a `/metrics` endpoint with Prometheus metrics (e.g. upstream latency histograms, portal error rates, cache hit ratios) would improve operational observability.
