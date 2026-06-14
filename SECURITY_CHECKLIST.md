# API Gateway Security Checklist

## API Key Storage

- [x] User API keys are stored as SHA-256 hashes instead of plaintext.
- [x] Stored records contain `apiKeyHash`, `keyPreview`, and `apiKeyEnabled`.
- [x] Full keys are returned only once during user creation or key rotation.
- [x] Administrators can disable, re-enable, and rotate user keys.
- [x] `GET /admin/users` returns neither full keys nor hashes.
- [ ] SHA-256 is unsalted. Generated keys have high entropy, but a database-backed production version should use a keyed hash or equivalent secret-aware design.

## Administrator Security

- [x] Admin endpoints require `x-admin-api-key` or Bearer authentication.
- [ ] Replace the single shared administrator key with accounts, sessions, MFA, and RBAC before commercial use.
- [ ] Add audit logs for user creation, balance changes, key rotation, and key enable/disable operations.
- [ ] Use a high-entropy production administrator key and rotate it regularly.

## User Data Isolation

- [x] `/v1/me` derives the user from the authenticated API key.
- [x] `/v1/logs` filters records using the authenticated user's ID.
- [x] Integration tests verify that one user cannot read another user's logs.
- [ ] Enforce tenant filtering in the database layer after PostgreSQL migration.

## Log Safety

- [x] Request logs store masked key previews rather than complete API keys.
- [x] Request message bodies and the upstream API key are not logged.
- [ ] Sanitize third-party error messages before storing them.
- [ ] Add pagination, retention limits, archival, and access auditing.
- [ ] Prevent unauthenticated request floods from exhausting log storage.

## Environment and Git

- [x] `.env` is ignored by Git.
- [x] `.env` is not tracked.
- [x] `render.yaml` does not contain real secrets.
- [ ] Replace example credentials in every production environment.
- [ ] Enable repository secret scanning and rotate any credential that was committed historically.

## Upstream API Key

- [x] `UPSTREAM_API_KEY` is read from the environment.
- [x] Frontend files do not receive the upstream key.
- [ ] Add startup validation, request timeouts, cancellation, and a key rotation procedure.

## Rate Limiting and Abuse Prevention

- [ ] Add IP-level rate limiting.
- [ ] Add user API key rate limiting.
- [ ] Add stricter limits to administrator endpoints.
- [ ] Limit concurrent upstream requests.
- [ ] Add request timeouts and failure backoff.
- [ ] Use Redis-backed distributed limits before multi-instance deployment.

## HTTP and Application Security

- [ ] Add security headers and Content Security Policy.
- [ ] Define a strict CORS policy.
- [ ] Force HTTPS in production.
- [ ] Validate all request bodies with schemas.
- [ ] Use a unified JSON error handler.
- [ ] Configure `trust proxy` correctly on hosted platforms.

## Deployment Gate

- [ ] Confirm `users.json` contains no plaintext `apiKey` fields.
- [ ] Rotate historical demo and production credentials.
- [ ] Configure strong administrator and upstream secrets.
- [ ] Run all integration tests in `MOCK_MODE=true`.
- [ ] Add rate limiting, timeouts, monitoring, backups, and alerts.
- [ ] Migrate balance and logs to PostgreSQL before untrusted commercial traffic.
