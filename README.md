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
| `UPSTREAM_BASE_URL` | Upstream OpenAI-compatible API base URL | `https://api.openai.com` |
| `UPSTREAM_API_KEY` | Secret API key for the upstream service | Set in the hosting dashboard |
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
