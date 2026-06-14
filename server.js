const express = require("express");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  readSettings,
  readProviders,
  readModels,
  updateSettings,
  saveProviders,
  saveModels,
} = require("./config-store");

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const defaultModel = process.env.DEFAULT_MODEL || "gpt-4.1-mini";
const adminApiKey = process.env.ADMIN_API_KEY || "";
const requestCost = 1;
const rateLimitState = {
  minute: null,
  globalCount: 0,
  userCounts: new Map(),
};

function isMockMode() {
  return String(process.env.MOCK_MODE || "true").toLowerCase() === "true";
}

function getUpstreamTimeoutMs() {
  const timeout = Number(process.env.UPSTREAM_TIMEOUT_MS || 30000);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 30000;
}

function redactSecret(value, secret) {
  if (!value || !secret) return String(value || "");
  return String(value).split(secret).join("[redacted]");
}

function resetRateLimits() {
  rateLimitState.minute = null;
  rateLimitState.globalCount = 0;
  rateLimitState.userCounts.clear();
}

function consumeRateLimit(userId, settings) {
  if (settings.rateLimitEnabled === false) return null;

  const minute = Math.floor(Date.now() / 60000);
  if (rateLimitState.minute !== minute) {
    resetRateLimits();
    rateLimitState.minute = minute;
  }

  const perUserLimit = Number(settings.perUserPerMinute);
  const globalLimit = Number(settings.globalPerMinute);
  const userCount = rateLimitState.userCounts.get(userId) || 0;

  if (Number.isFinite(perUserLimit) && perUserLimit > 0 && userCount >= perUserLimit) {
    return "User rate limit exceeded";
  }
  if (Number.isFinite(globalLimit) && globalLimit > 0 && rateLimitState.globalCount >= globalLimit) {
    return "Global rate limit exceeded";
  }

  rateLimitState.userCounts.set(userId, userCount + 1);
  rateLimitState.globalCount += 1;
  return null;
}

app.locals.resetRateLimits = resetRateLimits;

const usersFile = process.env.USERS_FILE
  ? path.resolve(process.env.USERS_FILE)
  : path.join(__dirname, "users.json");
const logsFile = process.env.LOGS_FILE
  ? path.resolve(process.env.LOGS_FILE)
  : path.join(__dirname, "logs.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempFile, file);
}

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

function createKeyPreview(apiKey) {
  if (!apiKey) return "unknown";
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}***${apiKey.slice(-2)}`;
  return `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`;
}

function generateApiKey() {
  return `sk-gw-${crypto.randomBytes(24).toString("hex")}`;
}

function readUsers() {
  const users = readJson(usersFile);
  let migrated = false;
  const normalizedUsers = users.map((user) => {
    if (!user.apiKey) {
      return { ...user, apiKeyEnabled: user.apiKeyEnabled !== false };
    }

    const { apiKey, ...safeUser } = user;
    migrated = true;
    return {
      ...safeUser,
      apiKeyHash: hashApiKey(apiKey),
      keyPreview: createKeyPreview(apiKey),
      apiKeyEnabled: user.apiKeyEnabled !== false,
    };
  });

  if (migrated) writeJson(usersFile, normalizedUsers);
  return normalizedUsers;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    balance: user.balance,
    keyPreview: user.keyPreview,
    apiKeyEnabled: user.apiKeyEnabled !== false,
  };
}

function extractApiKey(req, alternateHeader) {
  const authorization = req.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return req.get(alternateHeader) || "";
}

function maskApiKey(apiKey) {
  if (!apiKey) return "missing";
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}***${apiKey.slice(-2)}`;
  return `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`;
}

function appendLog(entry) {
  const logs = readJson(logsFile);
  logs.push({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  writeJson(logsFile, logs);
}

function userAuth(req, res, next) {
  const apiKey = extractApiKey(req, "x-api-key");
  const users = readUsers();
  const apiKeyHash = apiKey ? hashApiKey(apiKey) : "";
  const user = users.find((candidate) => candidate.apiKeyHash === apiKeyHash);

  if (!user || user.apiKeyEnabled === false) {
    appendLog({
      route: req.originalUrl,
      method: req.method,
      apiKey: maskApiKey(apiKey),
      status: 401,
      charged: 0,
      error: "Invalid user API key",
    });
    return res.status(401).json({ error: { message: "Invalid user API key", type: "authentication_error" } });
  }

  req.user = user;
  req.userApiKey = apiKey;
  next();
}

function adminAuth(req, res, next) {
  const apiKey = extractApiKey(req, "x-admin-api-key");
  if (!adminApiKey || apiKey !== adminApiKey) {
    return res.status(401).json({ error: { message: "Invalid admin API key", type: "authentication_error" } });
  }
  next();
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", mockMode: isMockMode(), timestamp: new Date().toISOString() });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/docs", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "docs.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/v1/me", userAuth, (req, res) => {
  res.json(publicUser(req.user));
});

app.get("/v1/logs", userAuth, (req, res) => {
  const logs = readJson(logsFile).filter((log) => log.userId === req.user.id);
  res.json({ total: logs.length, data: logs.slice().reverse() });
});

app.get("/v1/models", userAuth, (req, res) => {
  const enabledProviders = new Set(
    readProviders().filter((provider) => provider.enabled).map((provider) => provider.id)
  );
  const models = readModels()
    .filter((model) => model.enabled && enabledProviders.has(model.providerId))
    .map(({ id, name, providerId, isDefault, priceMultiplier }) => ({
      id,
      name,
      providerId,
      isDefault: Boolean(isDefault),
      priceMultiplier,
    }));
  res.json({ object: "list", data: models });
});

app.post("/v1/chat/completions", userAuth, async (req, res) => {
  const startedAt = Date.now();
  const settings = readSettings();
  const model = req.body.model || settings.defaultModel || defaultModel;
  const modelConfig = readModels().find((candidate) => candidate.id === model);
  const provider = modelConfig
    ? readProviders().find((candidate) => candidate.id === modelConfig.providerId)
    : null;

  if (settings.maintenanceMode) {
    return res.status(503).json({ error: { message: "Service is under maintenance", type: "maintenance_error" } });
  }
  if (!modelConfig || !modelConfig.enabled) {
    return res.status(400).json({ error: { message: "Model is not available", type: "invalid_model" } });
  }
  if (!provider || !provider.enabled) {
    return res.status(400).json({ error: { message: "Provider is not available", type: "invalid_provider" } });
  }

  if (!Array.isArray(req.body.messages) || req.body.messages.length === 0) {
    appendLog({
      userId: req.user.id,
      userName: req.user.name,
      route: req.originalUrl,
      method: req.method,
      apiKey: maskApiKey(req.userApiKey),
      model,
      status: 400,
      charged: 0,
      error: "messages must be a non-empty array",
    });
    return res.status(400).json({ error: { message: "messages must be a non-empty array", type: "invalid_request_error" } });
  }

  if (req.user.balance < requestCost) {
    appendLog({
      userId: req.user.id,
      userName: req.user.name,
      route: req.originalUrl,
      method: req.method,
      apiKey: maskApiKey(req.userApiKey),
      model,
      status: 402,
      charged: 0,
      balance: req.user.balance,
      error: "Insufficient balance",
    });
    return res.status(402).json({ error: { message: "Insufficient balance", type: "insufficient_balance" } });
  }

  const rateLimitError = consumeRateLimit(req.user.id, settings);
  if (rateLimitError) {
    appendLog({
      userId: req.user.id,
      userName: req.user.name,
      route: req.originalUrl,
      method: req.method,
      apiKey: maskApiKey(req.userApiKey),
      model,
      status: 429,
      charged: 0,
      balance: req.user.balance,
      error: rateLimitError,
    });
    return res.status(429).json({ error: { message: rateLimitError, type: "rate_limit_error" } });
  }

  try {
    let responseBody;
    let responseStatus = 200;
    const mockMode = isMockMode();

    if (mockMode) {
      responseBody = {
        id: `chatcmpl-mock-${crypto.randomUUID()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "This is a mock response from api-gateway-v2." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    } else {
      const upstreamApiKey = process.env[provider.apiKeyEnv];
      if (!upstreamApiKey) {
        appendLog({
          userId: req.user.id,
          userName: req.user.name,
          route: req.originalUrl,
          method: req.method,
          apiKey: maskApiKey(req.userApiKey),
          model,
          providerId: provider.id,
          status: 502,
          charged: 0,
          durationMs: Date.now() - startedAt,
          mode: "upstream",
          error: `Missing upstream credential environment variable: ${provider.apiKeyEnv}`,
        });
        return res.status(502).json({ error: { message: "Upstream provider is not configured", type: "upstream_configuration_error" } });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), getUpstreamTimeoutMs());
      let upstreamResponse;
      try {
        upstreamResponse = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${upstreamApiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...req.body, model }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error.name === "AbortError") {
          appendLog({
            userId: req.user.id,
            userName: req.user.name,
            route: req.originalUrl,
            method: req.method,
            apiKey: maskApiKey(req.userApiKey),
            model,
            providerId: provider.id,
            status: 504,
            charged: 0,
            durationMs: Date.now() - startedAt,
            mode: "upstream",
            error: "Upstream request timed out",
          });
          return res.status(504).json({ error: { message: "Upstream request timed out", type: "upstream_timeout" } });
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }

      responseStatus = upstreamResponse.status;
      const responseText = await upstreamResponse.text();
      try {
        responseBody = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseBody = { error: { message: "Upstream returned a non-JSON response", type: "upstream_error" } };
      }

      if (!upstreamResponse.ok) {
        const upstreamMessage = redactSecret(
          responseBody?.error?.message || `Upstream request failed with HTTP ${responseStatus}`,
          upstreamApiKey
        );
        appendLog({
          userId: req.user.id,
          userName: req.user.name,
          route: req.originalUrl,
          method: req.method,
          apiKey: maskApiKey(req.userApiKey),
          model,
          providerId: provider.id,
          status: responseStatus,
          charged: 0,
          durationMs: Date.now() - startedAt,
          mode: "upstream",
          error: upstreamMessage,
        });
        return res.status(responseStatus).json({
          error: {
            message: upstreamMessage,
            type: responseBody?.error?.type || "upstream_error",
          },
        });
      }
    }

    const users = readUsers();
    const currentUser = users.find((candidate) => candidate.id === req.user.id);
    if (!currentUser || currentUser.balance < requestCost) {
      throw new Error("User balance changed during request");
    }
    currentUser.balance -= requestCost;
    writeJson(usersFile, users);

    appendLog({
      userId: currentUser.id,
      userName: currentUser.name,
      route: req.originalUrl,
      method: req.method,
      apiKey: maskApiKey(req.userApiKey),
      model,
      status: responseStatus,
      charged: requestCost,
      balanceAfter: currentUser.balance,
      durationMs: Date.now() - startedAt,
      mode: mockMode ? "mock" : "upstream",
      providerId: provider.id,
      usage: responseBody.usage,
    });

    return res.status(responseStatus).json(responseBody);
  } catch (error) {
    appendLog({
      userId: req.user.id,
      userName: req.user.name,
      route: req.originalUrl,
      method: req.method,
      apiKey: maskApiKey(req.userApiKey),
      model,
      status: 502,
      charged: 0,
      durationMs: Date.now() - startedAt,
      error: error.message,
    });
    return res.status(502).json({ error: { message: "Upstream request failed", type: "upstream_error" } });
  }
});

app.get("/admin/logs", adminAuth, (req, res) => {
  const logs = readJson(logsFile);
  res.json({ total: logs.length, data: logs.slice().reverse() });
});

app.get("/admin/users", adminAuth, (req, res) => {
  const users = readUsers();
  res.json({ total: users.length, data: users.map(publicUser) });
});

app.get("/admin/settings", adminAuth, (req, res) => {
  res.json(readSettings());
});

app.patch("/admin/settings", adminAuth, (req, res) => {
  const changes = {};
  if (typeof req.body.maintenanceMode === "boolean") changes.maintenanceMode = req.body.maintenanceMode;
  if (typeof req.body.rateLimitEnabled === "boolean") changes.rateLimitEnabled = req.body.rateLimitEnabled;
  if (typeof req.body.defaultModel === "string" && req.body.defaultModel.trim()) {
    changes.defaultModel = req.body.defaultModel.trim();
  }
  for (const field of ["perUserPerMinute", "globalPerMinute"]) {
    if (req.body[field] !== undefined) {
      const value = Number(req.body[field]);
      if (!Number.isInteger(value) || value < 1) {
        return res.status(400).json({ error: { message: `${field} must be a positive integer`, type: "invalid_request_error" } });
      }
      changes[field] = value;
    }
  }
  res.json(updateSettings(changes));
});

app.get("/admin/providers", adminAuth, (req, res) => {
  const providers = readProviders();
  res.json({ total: providers.length, data: providers });
});

app.post("/admin/providers", adminAuth, (req, res) => {
  const providers = readProviders();
  const provider = {
    id: String(req.body.id || "").trim(),
    name: String(req.body.name || "").trim(),
    baseUrl: String(req.body.baseUrl || "").trim(),
    apiKeyEnv: String(req.body.apiKeyEnv || "UPSTREAM_API_KEY").trim(),
    enabled: req.body.enabled !== false,
  };
  if (!provider.id || !provider.name || !provider.baseUrl) {
    return res.status(400).json({ error: { message: "id, name and baseUrl are required", type: "invalid_request_error" } });
  }
  if (providers.some((item) => item.id === provider.id)) {
    return res.status(409).json({ error: { message: "Provider already exists", type: "conflict_error" } });
  }
  providers.push(provider);
  saveProviders(providers);
  return res.status(201).json(provider);
});

app.patch("/admin/providers/:id", adminAuth, (req, res) => {
  const providers = readProviders();
  const provider = providers.find((item) => item.id === req.params.id);
  if (!provider) return res.status(404).json({ error: { message: "Provider not found", type: "not_found_error" } });
  for (const field of ["name", "baseUrl", "apiKeyEnv", "enabled"]) {
    if (req.body[field] !== undefined) provider[field] = req.body[field];
  }
  saveProviders(providers);
  res.json(provider);
});

app.get("/admin/models", adminAuth, (req, res) => {
  const models = readModels();
  res.json({ total: models.length, data: models });
});

app.post("/admin/models", adminAuth, (req, res) => {
  const models = readModels();
  const model = {
    id: String(req.body.id || "").trim(),
    name: String(req.body.name || "").trim(),
    providerId: String(req.body.providerId || "").trim(),
    enabled: req.body.enabled !== false,
    isDefault: Boolean(req.body.isDefault),
    priceMultiplier: Number(req.body.priceMultiplier ?? 1),
  };
  if (!model.id || !model.name || !model.providerId) {
    return res.status(400).json({ error: { message: "id, name and providerId are required", type: "invalid_request_error" } });
  }
  if (models.some((item) => item.id === model.id)) {
    return res.status(409).json({ error: { message: "Model already exists", type: "conflict_error" } });
  }
  if (model.isDefault) models.forEach((item) => { item.isDefault = false; });
  models.push(model);
  saveModels(models);
  if (model.isDefault) updateSettings({ defaultModel: model.id });
  return res.status(201).json(model);
});

app.patch("/admin/models/:id", adminAuth, (req, res) => {
  const models = readModels();
  const model = models.find((item) => item.id === req.params.id);
  if (!model) return res.status(404).json({ error: { message: "Model not found", type: "not_found_error" } });
  for (const field of ["name", "providerId", "enabled", "isDefault", "priceMultiplier"]) {
    if (req.body[field] !== undefined) model[field] = req.body[field];
  }
  if (model.isDefault) {
    models.forEach((item) => { if (item.id !== model.id) item.isDefault = false; });
    updateSettings({ defaultModel: model.id });
  }
  saveModels(models);
  res.json(model);
});

app.post("/admin/users", adminAuth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const balance = Number(req.body.balance ?? 0);

  if (!name) {
    return res.status(400).json({ error: { message: "name is required", type: "invalid_request_error" } });
  }
  if (!Number.isFinite(balance) || balance < 0) {
    return res.status(400).json({ error: { message: "balance must be a non-negative number", type: "invalid_request_error" } });
  }

  const users = readUsers();
  const apiKey = generateApiKey();

  const user = {
    id: users.reduce((maxId, candidate) => Math.max(maxId, Number(candidate.id) || 0), 0) + 1,
    name,
    balance,
    apiKeyHash: hashApiKey(apiKey),
    keyPreview: createKeyPreview(apiKey),
    apiKeyEnabled: true,
  };
  users.push(user);
  writeJson(usersFile, users);
  return res.status(201).json({ ...publicUser(user), apiKey });
});

app.post("/admin/users/:id/topup", adminAuth, (req, res) => {
  const userId = Number(req.params.id);
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: { message: "amount must be greater than 0", type: "invalid_request_error" } });
  }

  const users = readUsers();
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) {
    return res.status(404).json({ error: { message: "User not found", type: "not_found_error" } });
  }

  user.balance += amount;
  writeJson(usersFile, users);
  return res.json({ id: user.id, name: user.name, balance: user.balance });
});

app.post("/admin/users/:id/rotate-key", adminAuth, (req, res) => {
  const userId = Number(req.params.id);
  const users = readUsers();
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) {
    return res.status(404).json({ error: { message: "User not found", type: "not_found_error" } });
  }

  const apiKey = generateApiKey();
  user.apiKeyHash = hashApiKey(apiKey);
  user.keyPreview = createKeyPreview(apiKey);
  user.apiKeyEnabled = true;
  writeJson(usersFile, users);
  return res.json({ ...publicUser(user), apiKey });
});

app.patch("/admin/users/:id/api-key", adminAuth, (req, res) => {
  const userId = Number(req.params.id);
  if (typeof req.body.enabled !== "boolean") {
    return res.status(400).json({ error: { message: "enabled must be a boolean", type: "invalid_request_error" } });
  }

  const users = readUsers();
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) {
    return res.status(404).json({ error: { message: "User not found", type: "not_found_error" } });
  }

  user.apiKeyEnabled = req.body.enabled;
  writeJson(usersFile, users);
  return res.json(publicUser(user));
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } });
  }
  return next(error);
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`api-gateway-v2 listening on http://localhost:${port}`);
    console.log(`MOCK_MODE=${isMockMode()}`);
  });
}

module.exports = app;
