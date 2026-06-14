# api-gateway-v2

A minimal OpenAI-compatible API Gateway built with Node.js and Express. It includes API key authentication, user balances, request charging, JSON audit logs, upstream forwarding, and a simple browser-based admin page.

## Requirements

- Node.js 18 or newer
- npm

## Local Setup

Windows CMD:

```cmd
cd C:\Users\gyn15\Desktop\api-gateway-v2
copy .env.example .env
npm install
npm start
```

The service listens on `process.env.PORT` or port `3000` by default.

Local URLs:

- Home and Key login: `http://localhost:3000/`
- User dashboard: `http://localhost:3000/dashboard`
- Health check: `http://localhost:3000/health`
- Admin page: `http://localhost:3000/admin`

The home page provides two lightweight login entries. Users enter an existing user API key and administrators enter the configured `ADMIN_API_KEY`. The browser validates the key against the existing API, stores it in local storage, and then opens the corresponding dashboard.

This is an MVP key-login flow, not an email/password account system. It does not provide registration, passwords, verification codes, or password recovery.

The user dashboard displays account-specific call, charge, and token usage. The admin dashboard displays aggregate usage across users and per-model call/token statistics. Token totals come from the upstream response `usage` object; logs without `usage` count as zero tokens.

## Environment Variables

| Variable | Description | Example |
| --- | --- | --- |
| `MOCK_MODE` | Return mock responses instead of calling the upstream API | `true` |
| `UPSTREAM_API_KEY` | Secret API key for the upstream service | Set in the hosting dashboard |
| `UPSTREAM_TIMEOUT_MS` | Upstream request timeout in milliseconds | `30000` |
| `DEFAULT_MODEL` | Model used when a request does not specify one | `gpt-4.1-mini` |
| `ADMIN_API_KEY` | Secret key used by admin APIs and the admin page | Set in the hosting dashboard |

The platform supplies `PORT` automatically. Do not hard-code it in production.

## Deploy to Render

You can create a Web Service manually or use the included `render.yaml` Blueprint.

Manual Render configuration:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /health
```

Add all environment variables listed above in the Render dashboard. Keep `UPSTREAM_API_KEY` and `ADMIN_API_KEY` secret and never commit their real values.

After deployment, replace `<your-service-url>` with the public Render URL:

- `https://<your-service-url>/health`
- `https://<your-service-url>/admin`
- `https://<your-service-url>/v1/chat/completions`
- `https://<your-service-url>/v1/me`
- `https://<your-service-url>/admin/logs`
- `https://<your-service-url>/admin/users`

## API Authentication

User endpoints accept either:

```text
Authorization: Bearer <user-api-key>
x-api-key: <user-api-key>
```

Admin endpoints accept either:

```text
Authorization: Bearer <admin-api-key>
x-admin-api-key: <admin-api-key>
```

## Important Storage Note

This MVP stores users and logs in `users.json` and `logs.json`. User balances are denominated in USD through `balanceUsd`; legacy `balance` values are migrated at a temporary 1:1 ratio and retained as a compatibility field. Render and Railway services may use ephemeral filesystems, so changes can be lost after a restart, redeploy, or instance replacement. A single-instance prototype can use a persistent disk if the platform supports it. For production or multiple instances, replace JSON storage with durable shared storage.

## Main Endpoints

- `GET /health`
- `GET /admin`
- `POST /v1/chat/completions`
- `GET /v1/me`
- `GET /admin/logs`
- `GET /admin/users`
- `POST /admin/users`
- `POST /admin/users/:id/topup`

## Automated Tests

Install dependencies and run the integration test suite:

```cmd
npm install
npm test
```

The tests use Node.js's built-in test runner with Supertest. Most tests use `MOCK_MODE=true`; upstream forwarding tests use a temporary local fake server with `MOCK_MODE=false`. They never call an external upstream API or modify the project's `users.json` and `logs.json` files.

`USERS_FILE` and `LOGS_FILE` can also be configured through environment variables when a custom JSON data location is needed.

## API Key Security

User API keys are stored as SHA-256 hashes in `users.json`. Stored records contain `apiKeyHash`, a masked `keyPreview`, and `apiKeyEnabled`; they do not retain the complete key.

The complete API key is returned only once when an administrator creates a user or rotates a key. Save it immediately. Administrators can disable, re-enable, or rotate a user's key, and rotating a key invalidates the previous key immediately.

## Provider and Model Configuration

Gateway settings are stored in `config/settings.json`, providers in `config/providers.json`, and models in `config/models.json`. Administrators can manage these values through `/admin/settings`, `/admin/providers`, and `/admin/models`.

`GET /v1/models` returns models that are enabled and belong to an enabled provider. Chat requests use `settings.defaultModel` when no model is supplied. Maintenance mode and disabled model/provider checks happen before charging the user.

With `MOCK_MODE=true`, chat completions are generated locally and no upstream request is made. With `MOCK_MODE=false`, the gateway finds the requested model and provider, then forwards the request to `<provider.baseUrl>/v1/chat/completions`.

Each provider's `apiKeyEnv` field contains only an environment variable name, such as `UPSTREAM_API_KEY`. Put the real credential in that environment variable through `.env` for local development or the hosting platform's secret settings. Never place a real upstream key in `providers.json`, source code, logs, or browser pages.

### Model Pricing Reference

Each model can store a `pricing` object in `config/models.json`. The administrator manually maintains upstream input, cached-input, and output costs in USD per 1M tokens, along with a `saleMultiplier`.

The dashboards calculate reference selling prices with this formula:

```text
reference selling price = upstream cost price x saleMultiplier
```

The gateway calculates the user-facing token prices by multiplying each upstream cost by `saleMultiplier`. Successful chat responses are charged from the returned OpenAI-compatible `usage` object:

```text
input charge = non-cached prompt tokens / 1,000,000 x input selling price
cached input charge = cached prompt tokens / 1,000,000 x cached-input selling price
output charge = completion tokens / 1,000,000 x output selling price
total USD charge = input charge + cached input charge + output charge
```

Charges are rounded to at most six decimal places. A positive calculated charge below USD 0.000001 is billed as USD 0.000001. If the upstream response has no `usage`, the charge is zero and the audit log records `usageMissing: true`.

The upstream base URL comes from the provider's `baseUrl` field in `config/providers.json`; it is not read from an API key environment variable.

Example:

```text
MOCK_MODE=false
UPSTREAM_API_KEY=replace-with-a-real-secret
UPSTREAM_TIMEOUT_MS=30000
```

The gateway only charges after an upstream HTTP 2xx response. Accounts with a USD balance of zero or less are rejected before an upstream call. Because actual usage is known only after a successful response, this MVP allows a balance to become temporarily negative instead of implementing complex preauthorization. Upstream errors, timeouts, and missing credentials do not deduct balance.

There is no payment integration, currency conversion, or automatic official-price synchronization. Administrators manually maintain model costs and top up USD balances. Streaming and non-chat OpenAI endpoints are not supported in this version.

## Rate Limiting

Chat completion rate limits are operational settings stored in `config/settings.json`. Administrators can enable or disable rate limiting and change the per-user and global requests-per-minute limits directly from the Runtime settings section of `/admin` or through `PATCH /admin/settings`.

This MVP uses in-memory counters. Counters reset each minute and are also reset whenever the Node.js process restarts. They are not shared across multiple service instances. A production deployment should replace this implementation with Redis or a database-backed distributed rate limiter.
