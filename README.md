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

- Health check: `http://localhost:3000/health`
- Admin page: `http://localhost:3000/admin`

Enter the value of `ADMIN_API_KEY` in the admin page. The page sends it through the `x-admin-api-key` request header.

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

This version stores users and logs in `users.json` and `logs.json`. Render and Railway services may use ephemeral filesystems, so changes can be lost after a restart, redeploy, or instance replacement. A single-instance prototype can use a persistent disk if the platform supports it. For production or multiple instances, migrate these files to PostgreSQL before relying on the data.

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

The upstream base URL comes from the provider's `baseUrl` field in `config/providers.json`; it is not read from an API key environment variable.

Example:

```text
MOCK_MODE=false
UPSTREAM_API_KEY=replace-with-a-real-secret
UPSTREAM_TIMEOUT_MS=30000
```

The gateway charges one point only after an upstream HTTP 2xx response. Upstream errors, timeouts, missing credentials, and insufficient balance do not deduct balance. Streaming and non-chat OpenAI endpoints are not supported in this version.

## Rate Limiting

Chat completion rate limits are operational settings stored in `config/settings.json`. Administrators can enable or disable rate limiting and change the per-user and global requests-per-minute limits directly from the Runtime settings section of `/admin` or through `PATCH /admin/settings`.

This MVP uses in-memory counters. Counters reset each minute and are also reset whenever the Node.js process restarts. They are not shared across multiple service instances. A production deployment should replace this implementation with Redis or a database-backed distributed rate limiter.
