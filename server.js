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

const usersFile = path.join(__dirname, "users.json");
const logsFile = path.join(__dirname, "logs.json");

app.use(express.json({ limit: "1mb" }));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempFile, file);
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
  const users = readJson(usersFile);
  const user = users.find((candidate) => candidate.apiKey === apiKey);

  if (!user) {
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

app.get("/v1/me", userAuth, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, balance: req.user.balance });
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

    const users = readJson(usersFile);
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

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } });
  }
  return next(error);
});

app.listen(port, () => {
  console.log(`api-gateway-v2 listening on http://localhost:${port}`);
  console.log(`MOCK_MODE=${mockMode}`);
});
