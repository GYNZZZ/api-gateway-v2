const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");
const crypto = require("node:crypto");
const http = require("node:http");

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "api-gateway-v2-test-"));
const usersFile = path.join(tempDirectory, "users.json");
const logsFile = path.join(tempDirectory, "logs.json");
const settingsFile = path.join(tempDirectory, "settings.json");
const providersFile = path.join(tempDirectory, "providers.json");
const modelsFile = path.join(tempDirectory, "models.json");

const initialUsers = [
  { id: 1, name: "test_user_1", apiKey: "user-key-001", balance: 10 },
  { id: 2, name: "test_user_2", apiKey: "user-key-002", balance: 5 },
  { id: 3, name: "empty_user", apiKey: "empty-key-003", balance: 0 },
];

const initialLogs = [
  {
    id: "log-user-1",
    timestamp: "2026-06-14T00:00:00.000Z",
    userId: 1,
    userName: "test_user_1",
    route: "/v1/chat/completions",
    method: "POST",
    apiKey: "user***-001",
    model: "gpt-4.1-mini",
    status: 200,
    charged: 1,
    balanceAfter: 9,
    durationMs: 2,
    mode: "mock",
  },
  {
    id: "log-user-2",
    timestamp: "2026-06-14T00:01:00.000Z",
    userId: 2,
    userName: "test_user_2",
    route: "/v1/chat/completions",
    method: "POST",
    apiKey: "user***-002",
    model: "gpt-4.1-mini",
    status: 200,
    charged: 1,
    balanceAfter: 4,
    durationMs: 3,
    mode: "mock",
  },
];

const initialSettings = {
  maintenanceMode: false,
  defaultModel: "gpt-4.1-mini",
  rateLimitEnabled: true,
  perUserPerMinute: 20,
  globalPerMinute: 100,
};
const initialProviders = [
  { id: "openai", name: "OpenAI Compatible", baseUrl: "https://api.openai.com", apiKeyEnv: "UPSTREAM_API_KEY", enabled: true },
];
const initialModels = [
  { id: "gpt-4.1-mini", name: "GPT 4.1 Mini", providerId: "openai", enabled: true, isDefault: true, priceMultiplier: 1 },
  { id: "disabled-model", name: "Disabled Model", providerId: "openai", enabled: false, isDefault: false, priceMultiplier: 1 },
];

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

process.env.NODE_ENV = "test";
process.env.MOCK_MODE = "true";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.UPSTREAM_API_KEY = "";
process.env.USERS_FILE = usersFile;
process.env.LOGS_FILE = logsFile;
process.env.SETTINGS_FILE = settingsFile;
process.env.PROVIDERS_FILE = providersFile;
process.env.MODELS_FILE = modelsFile;

let app;
let fakeUpstream;
let fakeUpstreamBaseUrl;
let fakeUpstreamCalls = 0;
let fakeUpstreamAuthorization = "";

before(async () => {
  fakeUpstream = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      fakeUpstreamCalls += 1;
      fakeUpstreamAuthorization = req.headers.authorization || "";
      const payload = JSON.parse(body || "{}");
      const scenario = payload.messages?.[0]?.content;
      res.setHeader("content-type", "application/json");
      if (scenario === "fail") {
        res.writeHead(429);
        return res.end(JSON.stringify({ error: { message: "Fake rate limit", type: "rate_limit_error" } }));
      }
      if (scenario === "timeout") {
        return setTimeout(() => {
          if (!res.destroyed) res.end(JSON.stringify({ id: "late-response" }));
        }, 200);
      }
      res.writeHead(200);
      return res.end(JSON.stringify({
        id: "chatcmpl-fake-upstream",
        object: "chat.completion",
        model: payload.model,
        choices: [{ index: 0, message: { role: "assistant", content: "Fake upstream response" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }));
    });
  });
  await new Promise((resolve) => fakeUpstream.listen(0, "127.0.0.1", resolve));
  fakeUpstreamBaseUrl = `http://127.0.0.1:${fakeUpstream.address().port}`;
  app = require("../server");
});

beforeEach(() => {
  writeJson(usersFile, initialUsers);
  writeJson(logsFile, initialLogs);
  writeJson(settingsFile, initialSettings);
  writeJson(providersFile, initialProviders);
  writeJson(modelsFile, initialModels);
  process.env.MOCK_MODE = "true";
  process.env.UPSTREAM_API_KEY = "";
  process.env.UPSTREAM_TIMEOUT_MS = "30000";
  fakeUpstreamCalls = 0;
  fakeUpstreamAuthorization = "";
  app.locals.resetRateLimits();
});

after(async () => {
  await new Promise((resolve) => fakeUpstream.close(resolve));
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

function useFakeUpstream() {
  writeJson(providersFile, [{ ...initialProviders[0], baseUrl: fakeUpstreamBaseUrl }]);
  process.env.MOCK_MODE = "false";
  process.env.UPSTREAM_API_KEY = "fake-upstream-secret";
}

test("public pages and health endpoint return 200", async () => {
  for (const endpoint of ["/health", "/", "/docs", "/admin", "/dashboard"]) {
    const response = await request(app).get(endpoint);
    assert.equal(response.status, 200, endpoint);
  }
  const health = await request(app).get("/health");
  assert.equal(health.body.status, "ok");
  assert.equal(health.body.mockMode, true);
});

test("user authentication rejects missing and invalid API keys", async () => {
  const missing = await request(app).get("/v1/me");
  assert.equal(missing.status, 401);

  const invalid = await request(app)
    .get("/v1/me")
    .set("Authorization", "Bearer wrong-key");
  assert.equal(invalid.status, 401);
});

test("valid user API key returns the current user", async () => {
  const response = await request(app)
    .get("/v1/me")
    .set("Authorization", "Bearer user-key-001");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    id: 1, name: "test_user_1", balance: 10,
    keyPreview: "user***-001", apiKeyEnabled: true,
  });
});

test("successful chat completion deducts balance and writes a log", async () => {
  const response = await request(app)
    .post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "Hello" }] });

  assert.equal(response.status, 200);
  assert.match(response.body.id, /^chatcmpl-mock-/);

  const user = readJson(usersFile).find((candidate) => candidate.id === 1);
  assert.equal(user.balance, 9);

  const logs = readJson(logsFile);
  const latestLog = logs.at(-1);
  assert.equal(latestLog.userId, 1);
  assert.equal(latestLog.status, 200);
  assert.equal(latestLog.charged, 1);
  assert.equal(latestLog.mode, "mock");
});

test("insufficient balance returns 402 without deducting balance", async () => {
  const response = await request(app)
    .post("/v1/chat/completions")
    .set("Authorization", "Bearer empty-key-003")
    .send({ messages: [{ role: "user", content: "Hello" }] });

  assert.equal(response.status, 402);
  const user = readJson(usersFile).find((candidate) => candidate.id === 3);
  assert.equal(user.balance, 0);
  const latestLog = readJson(logsFile).at(-1);
  assert.equal(latestLog.userId, 3);
  assert.equal(latestLog.charged, 0);
});

test("user logs are isolated by authenticated user", async () => {
  const userOne = await request(app)
    .get("/v1/logs")
    .set("Authorization", "Bearer user-key-001");
  const userTwo = await request(app)
    .get("/v1/logs")
    .set("Authorization", "Bearer user-key-002");

  assert.equal(userOne.status, 200);
  assert.equal(userTwo.status, 200);
  assert.ok(userOne.body.data.length > 0);
  assert.ok(userTwo.body.data.length > 0);
  assert.ok(userOne.body.data.every((log) => log.userId === 1));
  assert.ok(userTwo.body.data.every((log) => log.userId === 2));
  assert.equal(userOne.body.data.some((log) => log.userId === 2), false);
});

test("admin endpoints reject missing and invalid admin keys", async () => {
  const missing = await request(app).get("/admin/logs");
  const invalid = await request(app)
    .get("/admin/logs")
    .set("x-admin-api-key", "wrong-admin-key");

  assert.equal(missing.status, 401);
  assert.equal(invalid.status, 401);
});

test("valid admin key can access logs and users", async () => {
  const logs = await request(app)
    .get("/admin/logs")
    .set("x-admin-api-key", "test-admin-key");
  const users = await request(app)
    .get("/admin/users")
    .set("x-admin-api-key", "test-admin-key");

  assert.equal(logs.status, 200);
  assert.equal(logs.body.total, 2);
  assert.equal(users.status, 200);
  assert.equal(users.body.total, 3);
  assert.ok(users.body.data.every((user) => !("apiKey" in user)));
  assert.ok(users.body.data.every((user) => !("apiKeyHash" in user)));
});

test("admin can create a user, top up balance, and authenticate the new key", async () => {
  const created = await request(app)
    .post("/admin/users")
    .set("x-admin-api-key", "test-admin-key")
    .send({ name: "new_test_user", balance: 2 });

  assert.equal(created.status, 201);
  assert.equal(created.body.balance, 2);
  assert.equal(typeof created.body.apiKey, "string");

  const topup = await request(app)
    .post(`/admin/users/${created.body.id}/topup`)
    .set("x-admin-api-key", "test-admin-key")
    .send({ amount: 8 });

  assert.equal(topup.status, 200);
  assert.equal(topup.body.balance, 10);

  const me = await request(app)
    .get("/v1/me")
    .set("Authorization", `Bearer ${created.body.apiKey}`);

  assert.equal(me.status, 200);
  assert.equal(me.body.name, "new_test_user");
  assert.equal(me.body.balance, 10);
});

test("legacy plaintext API keys are migrated and no longer stored", async () => {
  const response = await request(app).get("/v1/me").set("Authorization", "Bearer user-key-001");
  assert.equal(response.status, 200);
  const storedUsers = readJson(usersFile);
  assert.ok(storedUsers.every((user) => !("apiKey" in user)));
  assert.equal(storedUsers[0].apiKeyHash, hashApiKey("user-key-001"));
  assert.equal(storedUsers[0].keyPreview, "user***-001");
});

test("admin can disable and re-enable a user API key", async () => {
  await request(app).get("/v1/me").set("Authorization", "Bearer user-key-001");
  const disabled = await request(app).patch("/admin/users/1/api-key")
    .set("x-admin-api-key", "test-admin-key").send({ enabled: false });
  assert.equal(disabled.status, 200);
  assert.equal((await request(app).get("/v1/me").set("Authorization", "Bearer user-key-001")).status, 401);
  const enabled = await request(app).patch("/admin/users/1/api-key")
    .set("x-admin-api-key", "test-admin-key").send({ enabled: true });
  assert.equal(enabled.status, 200);
  assert.equal((await request(app).get("/v1/me").set("Authorization", "Bearer user-key-001")).status, 200);
});

test("rotating a key invalidates the old key and enables the new key", async () => {
  await request(app).get("/v1/me").set("Authorization", "Bearer user-key-001");
  const rotated = await request(app).post("/admin/users/1/rotate-key")
    .set("x-admin-api-key", "test-admin-key");
  assert.equal(rotated.status, 200);
  assert.equal(typeof rotated.body.apiKey, "string");
  assert.equal((await request(app).get("/v1/me").set("Authorization", "Bearer user-key-001")).status, 401);
  assert.equal((await request(app).get("/v1/me").set("Authorization", `Bearer ${rotated.body.apiKey}`)).status, 200);
  const storedUser = readJson(usersFile).find((user) => user.id === 1);
  assert.equal("apiKey" in storedUser, false);
  assert.equal(storedUser.apiKeyHash, hashApiKey(rotated.body.apiKey));
});

test("models endpoint returns only enabled models with enabled providers", async () => {
  const response = await request(app).get("/v1/models").set("Authorization", "Bearer user-key-001");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map((model) => model.id), ["gpt-4.1-mini"]);
});

test("disabled models are hidden and rejected by chat completions", async () => {
  const response = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ model: "disabled-model", messages: [{ role: "user", content: "Hello" }] });
  assert.equal(response.status, 400);
  const models = await request(app).get("/v1/models").set("Authorization", "Bearer user-key-001");
  assert.equal(models.body.data.some((model) => model.id === "disabled-model"), false);
});

test("maintenance mode blocks chat and disabling it restores chat", async () => {
  const enabled = await request(app).patch("/admin/settings")
    .set("x-admin-api-key", "test-admin-key").send({ maintenanceMode: true });
  assert.equal(enabled.status, 200);
  const blocked = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ messages: [{ role: "user", content: "Hello" }] });
  assert.equal(blocked.status, 503);
  await request(app).patch("/admin/settings")
    .set("x-admin-api-key", "test-admin-key").send({ maintenanceMode: false });
  const restored = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ messages: [{ role: "user", content: "Hello" }] });
  assert.equal(restored.status, 200);
});

test("chat uses the configured default model when model is omitted", async () => {
  const response = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ messages: [{ role: "user", content: "Hello" }] });
  assert.equal(response.status, 200);
  assert.equal(response.body.model, "gpt-4.1-mini");
});

test("disabling a provider makes its models unavailable", async () => {
  const updated = await request(app).patch("/admin/providers/openai")
    .set("x-admin-api-key", "test-admin-key").send({ enabled: false });
  assert.equal(updated.status, 200);
  const models = await request(app).get("/v1/models").set("Authorization", "Bearer user-key-001");
  assert.equal(models.body.data.length, 0);
  const chat = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ messages: [{ role: "user", content: "Hello" }] });
  assert.equal(chat.status, 400);
});

test("admin can create and update providers and models", async () => {
  const provider = await request(app).post("/admin/providers")
    .set("x-admin-api-key", "test-admin-key")
    .send({ id: "demo", name: "Demo Provider", baseUrl: "https://example.invalid", apiKeyEnv: "DEMO_API_KEY" });
  assert.equal(provider.status, 201);
  const providerUpdate = await request(app).patch("/admin/providers/demo")
    .set("x-admin-api-key", "test-admin-key").send({ enabled: false });
  assert.equal(providerUpdate.body.enabled, false);

  const model = await request(app).post("/admin/models")
    .set("x-admin-api-key", "test-admin-key")
    .send({ id: "demo-model", name: "Demo Model", providerId: "demo", enabled: true, priceMultiplier: 2 });
  assert.equal(model.status, 201);
  const modelUpdate = await request(app).patch("/admin/models/demo-model")
    .set("x-admin-api-key", "test-admin-key").send({ enabled: false, isDefault: true });
  assert.equal(modelUpdate.body.enabled, false);
  const settings = await request(app).get("/admin/settings").set("x-admin-api-key", "test-admin-key");
  assert.equal(settings.body.defaultModel, "demo-model");
});

test("MOCK_MODE=true never calls the configured upstream", async () => {
  writeJson(providersFile, [{ ...initialProviders[0], baseUrl: fakeUpstreamBaseUrl }]);
  process.env.UPSTREAM_API_KEY = "fake-upstream-secret";
  const response = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "success" }] });
  assert.equal(response.status, 200);
  assert.match(response.body.id, /^chatcmpl-mock-/);
  assert.equal(fakeUpstreamCalls, 0);
});

test("MOCK_MODE=false forwards to fake upstream and charges on success", async () => {
  useFakeUpstream();
  const response = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ messages: [{ role: "user", content: "success" }] });
  assert.equal(response.status, 200);
  assert.equal(response.body.id, "chatcmpl-fake-upstream");
  assert.equal(response.body.model, "gpt-4.1-mini");
  assert.equal(fakeUpstreamCalls, 1);
  assert.equal(fakeUpstreamAuthorization, "Bearer fake-upstream-secret");
  assert.equal(readJson(usersFile).find((user) => user.id === 1).balance, 9);
  const latestLog = readJson(logsFile).at(-1);
  assert.equal(latestLog.mode, "upstream");
  assert.deepEqual(latestLog.usage, { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 });
  assert.equal(JSON.stringify(latestLog).includes("fake-upstream-secret"), false);
});

test("upstream HTTP failure is returned and does not charge", async () => {
  useFakeUpstream();
  const response = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "fail" }] });
  assert.equal(response.status, 429);
  assert.equal(response.body.error.message, "Fake rate limit");
  assert.equal(readJson(usersFile).find((user) => user.id === 1).balance, 10);
  assert.equal(readJson(logsFile).at(-1).charged, 0);
});

test("upstream timeout returns 504 and does not charge", async () => {
  useFakeUpstream();
  process.env.UPSTREAM_TIMEOUT_MS = "30";
  const response = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "timeout" }] });
  assert.equal(response.status, 504);
  assert.equal(response.body.error.type, "upstream_timeout");
  assert.equal(readJson(usersFile).find((user) => user.id === 1).balance, 10);
  assert.equal(readJson(logsFile).at(-1).charged, 0);
});

test("insufficient balance does not call upstream", async () => {
  useFakeUpstream();
  const response = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer empty-key-003")
    .send({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "success" }] });
  assert.equal(response.status, 402);
  assert.equal(fakeUpstreamCalls, 0);
  assert.equal(readJson(usersFile).find((user) => user.id === 3).balance, 0);
});

test("missing provider credential returns an error without calling upstream or charging", async () => {
  useFakeUpstream();
  delete process.env.UPSTREAM_API_KEY;
  const response = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "success" }] });
  assert.equal(response.status, 502);
  assert.equal(response.body.error.type, "upstream_configuration_error");
  assert.equal(fakeUpstreamCalls, 0);
  assert.equal(readJson(usersFile).find((user) => user.id === 1).balance, 10);
  assert.equal(readJson(logsFile).at(-1).charged, 0);
});

test("rate limiting is enabled by default", async () => {
  const response = await request(app).get("/admin/settings").set("x-admin-api-key", "test-admin-key");
  assert.equal(response.status, 200);
  assert.equal(response.body.rateLimitEnabled, true);
  assert.equal(response.body.perUserPerMinute, 20);
  assert.equal(response.body.globalPerMinute, 100);
});

test("per-user rate limit returns 429 without charging or calling upstream", async () => {
  useFakeUpstream();
  writeJson(settingsFile, { ...initialSettings, perUserPerMinute: 1, globalPerMinute: 10 });

  const first = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ messages: [{ role: "user", content: "success" }] });
  const second = await request(app).post("/v1/chat/completions")
    .set("Authorization", "Bearer user-key-001")
    .send({ messages: [{ role: "user", content: "success" }] });

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(second.body.error.type, "rate_limit_error");
  assert.equal(fakeUpstreamCalls, 1);
  assert.equal(readJson(usersFile).find((user) => user.id === 1).balance, 9);
  const latestLog = readJson(logsFile).at(-1);
  assert.equal(latestLog.status, 429);
  assert.equal(latestLog.charged, 0);
});

test("global rate limit applies across users", async () => {
  writeJson(settingsFile, { ...initialSettings, perUserPerMinute: 10, globalPerMinute: 2 });
  const call = (apiKey) => request(app).post("/v1/chat/completions")
    .set("Authorization", `Bearer ${apiKey}`)
    .send({ messages: [{ role: "user", content: "Hello" }] });

  assert.equal((await call("user-key-001")).status, 200);
  assert.equal((await call("user-key-002")).status, 200);
  const limited = await call("user-key-001");
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.message, "Global rate limit exceeded");
  assert.equal(readJson(usersFile).find((user) => user.id === 1).balance, 9);
});

test("admin can update rate limit settings", async () => {
  const response = await request(app).patch("/admin/settings")
    .set("x-admin-api-key", "test-admin-key")
    .send({ rateLimitEnabled: true, perUserPerMinute: 7, globalPerMinute: 33 });
  assert.equal(response.status, 200);
  assert.equal(response.body.rateLimitEnabled, true);
  assert.equal(response.body.perUserPerMinute, 7);
  assert.equal(response.body.globalPerMinute, 33);
  assert.deepEqual(readJson(settingsFile), { ...initialSettings, perUserPerMinute: 7, globalPerMinute: 33 });
});

test("disabling rate limiting removes request limits", async () => {
  writeJson(settingsFile, { ...initialSettings, rateLimitEnabled: false, perUserPerMinute: 1, globalPerMinute: 1 });
  for (let index = 0; index < 3; index += 1) {
    const response = await request(app).post("/v1/chat/completions")
      .set("Authorization", "Bearer user-key-001")
      .send({ messages: [{ role: "user", content: "Hello" }] });
    assert.equal(response.status, 200);
  }
  assert.equal(readJson(usersFile).find((user) => user.id === 1).balance, 7);
});
