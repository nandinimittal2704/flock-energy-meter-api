# Urja Meter Ops — Legacy Portal Protocol Specification

> **Status:** Fully Reverse-Engineered & Verified Live  
> **Target Portal:** `https://urja-ops.flockenergy.tech`  
> **Investigation Method:** Network DevTools inspection, SvelteKit client bundle disassembly (`app.03ZTmlg3.js`, `5.C4dYcCRt.js`, `6.l777LXKL.js`, `4.2Bgc2kUI.js`), and live HTTP probing.  
> **Security Notice:** No credentials, cookies, tokens, or signing keys are recorded in this document.

---

## 1. Overview & Architecture of the Legacy Portal

The **Urja Meter Ops** portal is an internal web application used by utility field and operations staff to query smart meters, grid distribution hierarchy, and electrical interval consumption.

Behind the scenes:
- **Framework:** SvelteKit (client-side rendered SPA with initial server-side hydration).
- **Authentication Framework:** `better-auth`.
- **Session Mechanism:** Cookie-based session token (`__Secure-better-auth.session_token`).
- **Internal REST API:** Hidden behind `/portal/*` path prefix.
- **Crypto Signing:** HMAC-SHA256 authenticated bulk export endpoint.

The portal provides no public documentation or API keys. However, normal authenticated user sessions interact with an internal REST API that can be consumed directly by an automated client.

---

## 2. Authentication & Session Flow

### Login Request
```http
POST /login HTTP/1.1
Host: urja-ops.flockenergy.tech
Content-Type: application/x-www-form-urlencoded
Origin: https://urja-ops.flockenergy.tech
Referer: https://urja-ops.flockenergy.tech/login

email=operator%40urja.local&password=<REDACTED>
```

### Critical Quirks Discovered
1. **SvelteKit CSRF Verification:** SvelteKit rejects form submissions with HTTP `403 Forbidden` if the `Origin` header is omitted or does not match the portal host.
2. **Success Response:** The portal responds with HTTP `200 OK` (or `303 See Other`) and body:
   ```json
   { "type": "redirect", "status": 303, "location": "/meters" }
   ```
3. **Session Cookie:** The response contains a `Set-Cookie` header:
   ```http
   Set-Cookie: __Secure-better-auth.session_token=<TOKEN>; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax
   ```
   - **Name:** `__Secure-better-auth.session_token`
   - **Lifetime:** 1 hour (`Max-Age=3600`)
   - **Security flags:** `HttpOnly`, `Secure`, `SameSite=Lax`
   - Because of the `__Secure-` prefix, the cookie is only transmitted over HTTPS.

### Session Validation & Expiration
- Endpoint `GET /api/auth/get-session` returns the logged-in user profile and session expiration timestamp.
- When an expired session cookie is sent to the portal, the portal returns:
  - HTTP `303 See Other` with `Location: /login`, or
  - HTTP `401 Unauthorized`
- Our client detects this response, discards the cached token, re-authenticates automatically, and transparently retries the in-flight request.

---

## 3. Discovered Internal Endpoints

All authenticated portal data requests communicate through the following verified endpoints:

### Endpoint 1: Meter Search & Pagination
- **URL:** `GET /portal/meters/search?q={query}&page={page}`
- **Authentication:** `Cookie: __Secure-better-auth.session_token=...`
- **Behavior:**
  - `q`: Query string matching meter ID or serial number (case-insensitive substring match).
  - `page`: 1-indexed page number.
  - Page size is fixed at `20` records per page.
  - Total records available in dataset: **403 meters**.
- **Response Format (`application/json`):**
  ```json
  {
    "data": [
      {
        "meterId": "J100000",
        "serialNo": "SE33962",
        "make": "HPL",
        "phaseType": "single",
        "installStatus": "Decommissioned",
        "dtCode": "DT-001"
      }
    ],
    "total": 403
  }
  ```

### Endpoint 2: Meter Geographic Coordinates
- **URL:** `GET /portal/meters/{meterId}/geo`
- **Authentication:** `Cookie: __Secure-better-auth.session_token=...`
- **Response Format (`application/json`):**
  ```json
  {
    "data": {
      "latitude": "26.938961002479868",
      "longitude": "75.83095696146852"
    }
  }
  ```
- **Error Behavior:** If `{meterId}` does not exist, returns HTTP `404 Not Found`:
  ```json
  { "error": "not_found", "message": "Meter not found" }
  ```

### Endpoint 3: Interval Consumption & Energy Time-Series
- **URL:** `GET /portal/meters/{meterId}/energy`
- **Authentication:** `Cookie: __Secure-better-auth.session_token=...`
- **Response Format (`application/json`):**
  ```json
  {
    "data": [
      {
        "timestamp": "23/06/2026 23:30",
        "kwh": "48438.74",
        "kvah": "52313.84",
        "voltR": "226"
      }
    ]
  }
  ```
- **Observations:**
  - Contains **337 interval readings** (approx. 7 days of 30-minute interval smart-meter profile data).
  - Units: Active Energy in **kWh**, Apparent Energy in **kVAh**, Phase Voltage in **Volts (R-phase)**.
  - Values are transmitted as strings from the database and must be parsed into floats while preserving decimal precision.

### Endpoint 4: Distribution Transformers (DTs)
- **URL:** `GET /portal/dts?page={page}`
- **Authentication:** `Cookie: __Secure-better-auth.session_token=...`
- **Behavior:**
  - Returns **40 total DT records** (20 per page across 2 pages).
- **Response Format (`application/json`):**
  ```json
  {
    "data": [
      {
        "code": "DT-001",
        "name": "Malviya Nagar DT 1",
        "feederCode": "F-001",
        "capacityKva": 100
      }
    ],
    "total": 40
  }
  ```

### Endpoint 5 & 6: Cryptographic Bulk Export with HMAC-SHA256 Signing
Inspection of `nodes/4.2Bgc2kUI.js` revealed that the portal's "Export all meters" button executes a signed HTTP request:

1. **Step 1: Obtain Signing Secret**
   - **URL:** `GET /portal/keys`
   - **Response:**
     ```json
     { "data": { "signingSecret": "<HMAC_SECRET>" } }
     ```

2. **Step 2: Sign the Request**
   - Canonical message format:
     ```text
     GET
     /portal/export
     page=1
     {unix_timestamp_seconds}
     ```
   - Signature: `HMAC-SHA256(canonicalMessage, signingSecret)` in hexadecimal encoding.

3. **Step 3: Execute Export**
   - **URL:** `GET /portal/export?page=1`
   - **Headers:**
     - `x-timestamp`: `{unix_timestamp_seconds}`
     - `x-signature`: `{hex_signature}`
   - **Response Format:**
     Returns **all 403 meters** enriched with their complete network hierarchy and coordinates:
     ```json
     {
       "data": [
         {
           "meterId": "J100000",
           "serialNo": "SE33962",
           "make": "HPL",
           "phaseType": "single",
           "installStatus": "Decommissioned",
           "installType": "Whole Current",
           "build": "legacy",
           "dtCode": "DT-001",
           "hierarchy": {
             "zone": { "name": "Jaipur Zone 1", "code": "Z-01" },
             "circle": { "name": "Circle 1", "code": "C-01" },
             "division": { "name": "Division 1", "code": "D-01" },
             "subdivision": { "name": "Subdivision 1", "code": "SD-01" },
             "substation": { "name": "Substation 1", "code": "SS-01" },
             "feeder": { "name": "Feeder 1", "code": "F-001" },
             "dt": { "name": "Malviya Nagar DT 1", "code": "DT-001" }
           },
           "geo": {
             "lat": 26.938961002479868,
             "lng": 75.83095696146852
           }
         }
       ],
       "total": 403
     }
     ```

---

## 4. Grid Hierarchy Model

The portal model organizes electrical assets in a 7-tier strict hierarchy:

$$\text{Zone} \longrightarrow \text{Circle} \longrightarrow \text{Division} \longrightarrow \text{Subdivision} \longrightarrow \text{Substation} \longrightarrow \text{Feeder} \longrightarrow \text{Distribution Transformer (DT)} \longrightarrow \text{Smart Meter}$$

Verified statistics across the dataset:
- **3 Zones:** Jaipur Zone 1, Jaipur Zone 2, Jaipur Zone 3
- **7 Circles**
- **10 Divisions**
- **19 Substations**
- **29 Feeders**
- **40 Distribution Transformers**
- **403 Smart Meters**

---

## 5. Summary of Upstream Errors & Client Mapping

| Portal Upstream Behavior | Root Cause | Client Adapter Mapping | HTTP Status Returned |
|---|---|---|---|
| HTTP 403 Forbidden on `/login` | Missing `Origin` header | Automatic `Origin: https://urja-ops.flockenergy.tech` | Resolved internally |
| HTTP 303 Redirect to `/login` | Session token expired | Invalidate cached token, re-login, retry | Resolved transparently |
| HTTP 401 Unauthorized | Invalid credentials or expired cookie | Re-login; if credentials bad, throw `AuthenticationError` | `502 Bad Gateway` |
| HTTP 404 with JSON message | Meter or route does not exist | Throw `NotFoundError` | `404 Not Found` |
| Network Timeout / 5xx | Transient upstream failure | Exponential backoff retry (up to 2 retries) | `502 Bad Gateway` (if exhausted) |
