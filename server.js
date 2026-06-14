const express = require("express");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const mockMode = String(process.env.MOCK_MODE || "true").toLowerCase() === "true";
const upstreamBaseUrl = (process.env.UPSTREAM_BASE_URL || "https://api.openai.com").replace(/\/$/, "");
const upstreamApiKey = process.env.UPSTREAM_API_KEY || "";
const defaultModel = process.env.DEFAULT_MODEL || "gpt-4.1-mini";
const adminApiKey = process.env.ADMIN_API_KEY || "";
const requestCost = 1;

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
  res.json({ status: "ok", mockMode, timestamp: new Date().toISOString() });
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

app.post("/v1/chat/completions", userAuth, async (req, res) => {
  const startedAt = Date.now();
  const model = req.body.model || defaultModel;

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

  try {
    let responseBody;
    let responseStatus = 200;

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
      if (!upstreamApiKey) throw new Error("UPSTREAM_API_KEY is not configured");
      const upstreamResponse = await fetch(`${upstreamBaseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${upstreamApiKey}`,
        },
        body: JSON.stringify({ ...req.body, model }),
      });
      responseStatus = upstreamResponse.status;
      responseBody = await upstreamResponse.json();

      if (!upstreamResponse.ok) {
        appendLog({
          userId: req.user.id,
          userName: req.user.name,
          route: req.originalUrl,
          method: req.method,
          apiKey: maskApiKey(req.userApiKey),
          model,
          status: responseStatus,
          charged: 0,
          durationMs: Date.now() - startedAt,
          error: "Upstream request failed",
        });
        return res.status(responseStatus).json(responseBody);
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
    console.log(`MOCK_MODE=${mockMode}`);
  });
}

module.exports = app;
