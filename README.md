# api-gateway-v2

一个最小可运行的 OpenAI-compatible AI API Gateway。第一版使用 JSON 文件保存用户、余额和调用日志，适合 Windows 本地开发与产品原型验证。

## 功能

- 用户 API Key 与管理员 API Key 鉴权
- 用户余额查询与成功调用固定扣费（每次 1 点）
- 调用审计日志及 API Key 脱敏
- OpenAI-compatible `POST /v1/chat/completions`
- Mock 回复或真实上游转发
- JSON 文件原子覆盖写入

## 环境要求

- Node.js 18 或更高版本
- Windows CMD 或 PowerShell

## 安装与启动

```cmd
cd api-gateway-v2
copy .env.example .env
npm install
node server.js
```

服务默认运行在 `http://localhost:3000`。

## 鉴权

用户接口支持：

```text
Authorization: Bearer user-key-001
```

也支持 `x-api-key: user-key-001`。

管理员接口支持：

```text
Authorization: Bearer admin-key-001
```

也支持 `x-admin-api-key: admin-key-001`。

## Windows CMD 测试命令

健康检查：

```cmd
curl http://localhost:3000/health
```

聊天请求：

```cmd
curl -X POST http://localhost:3000/v1/chat/completions -H "Authorization: Bearer user-key-001" -H "Content-Type: application/json" -d "{\"model\":\"gpt-4.1-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"
```

当前用户：

```cmd
curl http://localhost:3000/v1/me -H "Authorization: Bearer user-key-001"
```

管理员日志：

```cmd
curl http://localhost:3000/admin/logs -H "Authorization: Bearer admin-key-001"
```

错误用户 Key：

```cmd
curl http://localhost:3000/v1/me -H "Authorization: Bearer wrong-user-key"
```

错误管理员 Key：

```cmd
curl http://localhost:3000/admin/logs -H "Authorization: Bearer wrong-admin-key"
```

余额不足测试：先停止服务，将 `users.json` 中某个用户的 `balance` 临时改为 `0`，重启后用该用户调用聊天接口。

## 上游转发

在 `.env` 中设置：

```dotenv
MOCK_MODE=false
UPSTREAM_BASE_URL=https://api.openai.com
UPSTREAM_API_KEY=你的上游密钥
```

网关会将请求转发到 `${UPSTREAM_BASE_URL}/v1/chat/completions`。只有成功响应才会扣费，上游失败会记录日志但不扣费。

## 第一版限制

JSON 文件适合单进程原型，不适合多实例或高并发。生产版本建议迁移到 PostgreSQL，并使用事务完成余额扣减和日志落库；限流与缓存可再接入 Redis。
