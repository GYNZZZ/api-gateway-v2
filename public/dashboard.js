const STORAGE_KEY = "userApiKey";
const LEGACY_STORAGE_KEY = "apiGatewayUserKey";
const elements = {
  apiKey: document.querySelector("#apiKey"), toggleKey: document.querySelector("#toggleKey"),
  connectButton: document.querySelector("#connectButton"), refreshButton: document.querySelector("#refreshButton"),
  connectionBadge: document.querySelector("#connectionBadge"), notice: document.querySelector("#notice"),
  userName: document.querySelector("#userName"), balance: document.querySelector("#balance"),
  logCount: document.querySelector("#logCount"), successCount: document.querySelector("#successCount"),
  failureCount: document.querySelector("#failureCount"), totalCharged: document.querySelector("#totalCharged"),
  totalTokens: document.querySelector("#totalTokens"), promptTokens: document.querySelector("#promptTokens"),
  completionTokens: document.querySelector("#completionTokens"), logoutButton: document.querySelector("#logoutButton"),
  modelsMeta: document.querySelector("#modelsMeta"), modelsGrid: document.querySelector("#modelsGrid"),
  selectedModelHint: document.querySelector("#selectedModelHint"), connectModelButton: document.querySelector("#connectModelButton"),
  connectionPanel: document.querySelector("#connection"), baseUrlValue: document.querySelector("#baseUrlValue"),
  authorizationValue: document.querySelector("#authorizationValue"), modelValue: document.querySelector("#modelValue"),
  priceValue: document.querySelector("#priceValue"), curlValue: document.querySelector("#curlValue"),
  logsMeta: document.querySelector("#logsMeta"), logsBody: document.querySelector("#logsBody"),
};

let currentUser = null;
let logs = [];
let models = [];
let selectedModelId = null;
let noticeTimer = null;

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#039;" })[char]); }
function formatNumber(value) { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value) || 0); }
function formatUsd(value) { return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(Number(value) || 0)}`; }
function pricingValues(model) {
  const pricing = model?.pricing || {};
  const saleMultiplier = Number(pricing.saleMultiplier) > 0 ? Number(pricing.saleMultiplier) : 1;
  const baseInput = Number(pricing.baseInput) || 0;
  const baseCachedInput = Number(pricing.baseCachedInput) || 0;
  const baseOutput = Number(pricing.baseOutput) || 0;
  return { pricing, saleMultiplier, baseInput, baseCachedInput, baseOutput };
}
function tokenValue(log, field) { return Number(log?.usage?.[field]) || 0; }
function isSuccess(log) { const status = Number(log.status); return status >= 200 && status < 300; }
function setLoading(loading) { elements.connectButton.disabled = loading; elements.refreshButton.disabled = loading; elements.connectButton.classList.toggle("loading", loading); }
function setConnection(state, label) { elements.connectionBadge.className = `connection-badge ${state}`; elements.connectionBadge.querySelector("strong").textContent = label; }
function showNotice(message, isError = false, persistent = false) { clearTimeout(noticeTimer); elements.notice.textContent = message; elements.notice.classList.toggle("error", isError); elements.notice.hidden = false; if (!persistent) noticeTimer = setTimeout(() => { elements.notice.hidden = true; }, 4500); }

async function api(path) {
  const key = elements.apiKey.value.trim();
  if (!key) throw new Error("请先输入用户 API Key。");
  const response = await fetch(path, { headers: { Authorization: `Bearer ${key}` } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || `请求失败（HTTP ${response.status}）。`);
  return body;
}

function renderAccount() {
  elements.userName.textContent = currentUser?.name || "--";
  elements.balance.textContent = currentUser ? formatUsd(currentUser.balanceUsd ?? currentUser.balance) : "--";
  elements.logCount.textContent = currentUser ? formatNumber(logs.length) : "--";
  const successful = logs.filter(isSuccess).length;
  const metrics = {
    successCount: successful,
    failureCount: logs.length - successful,
    totalCharged: logs.reduce((sum, log) => sum + Number(log.chargeUsd ?? log.charged ?? 0), 0),
    totalTokens: logs.reduce((sum, log) => sum + tokenValue(log, "total_tokens"), 0),
    promptTokens: logs.reduce((sum, log) => sum + tokenValue(log, "prompt_tokens"), 0),
    completionTokens: logs.reduce((sum, log) => sum + tokenValue(log, "completion_tokens"), 0),
  };
  for (const [id, value] of Object.entries(metrics)) elements[id].textContent = currentUser ? (id === "totalCharged" ? formatUsd(value) : formatNumber(value)) : "--";
  elements.logoutButton.hidden = !currentUser;
}

function renderModels() {
  elements.modelsMeta.textContent = `${models.length} 个模型`;
  if (!models.length) {
    elements.modelsGrid.innerHTML = '<div class="empty-state">当前没有可用模型</div>';
    selectedModelId = null;
  } else {
    if (!models.some((model) => model.id === selectedModelId)) selectedModelId = null;
    elements.modelsGrid.innerHTML = models.map((model) => {
      const { saleMultiplier, baseInput, baseCachedInput, baseOutput } = pricingValues(model);
      return `<button class="model-card ${model.id === selectedModelId ? "selected" : ""}" type="button" data-model-id="${escapeHtml(model.id)}">
        <span class="model-card-top"><strong>${escapeHtml(model.name || model.id)}</strong>${model.isDefault ? '<span class="default-badge">默认</span>' : ""}</span>
        <code>${escapeHtml(model.id)}</code>
        <span class="model-details"><span>供应商：${escapeHtml(model.providerId || "-")}</span><b>按 token 用量计费</b></span>
        <span class="pricing-group"><strong>上游成本参考</strong><span>输入成本：${formatUsd(baseInput)} / 1M tokens</span><span>缓存输入成本：${formatUsd(baseCachedInput)} / 1M tokens</span><span>输出成本：${formatUsd(baseOutput)} / 1M tokens</span></span>
        <span class="pricing-group sale"><strong>对用户参考售价</strong><span>销售倍率：${formatNumber(saleMultiplier)} 倍</span><span>输入售价：${formatUsd(baseInput * saleMultiplier)} / 1M tokens</span><span>缓存输入售价：${formatUsd(baseCachedInput * saleMultiplier)} / 1M tokens</span><span>输出售价：${formatUsd(baseOutput * saleMultiplier)} / 1M tokens</span></span>
        <small class="billing-note">实际扣费按 token 用量计算，最终以 usage 为准</small>
      </button>`;
    }).join("");
  }
  const selected = models.find((model) => model.id === selectedModelId);
  elements.selectedModelHint.textContent = selected ? `已选择：${selected.name || selected.id}（按 token 用量计费）` : "请先选择模型";
  elements.connectModelButton.disabled = !selected;
  if (!selected) elements.connectionPanel.hidden = true;
}

function renderLogs() {
  elements.logsMeta.textContent = `${logs.length} 条`;
  if (!logs.length) { elements.logsBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">当前账户暂无调用日志</div></td></tr>'; return; }
  elements.logsBody.innerHTML = logs.map((log) => {
    const success = Number(log.status) >= 200 && Number(log.status) < 300;
    return `<tr><td>${escapeHtml(new Date(log.timestamp).toLocaleString("zh-CN"))}</td><td>${escapeHtml(`${log.method || ""} ${log.route || ""}`.trim())}</td><td>${escapeHtml(log.model || "-")}</td><td><span class="status-pill ${success ? "success" : "error"}">${escapeHtml(log.status)}</span></td><td>${formatUsd(log.chargeUsd ?? log.charged)}</td><td>${log.balanceAfter === undefined ? "-" : formatUsd(log.balanceAfter)}</td><td>${Number.isFinite(Number(log.durationMs)) ? `${log.durationMs} ms` : "-"}</td></tr>`;
  }).join("");
}

function showConnection() {
  const model = models.find((item) => item.id === selectedModelId);
  if (!model || !currentUser) return;
  const baseUrl = `${window.location.origin}/v1`;
  const keyPreview = currentUser.keyPreview || "<你的 API Key>";
  const authorization = `Bearer ${keyPreview}`;
  const curl = `curl ${window.location.origin}/v1/chat/completions \\\n+  -H "Content-Type: application/json" \\\n+  -H "Authorization: Bearer ${keyPreview}" \\\n+  -d '{"model":"${model.id}","messages":[{"role":"user","content":"你好"}]}'`;
  elements.baseUrlValue.textContent = baseUrl;
  elements.authorizationValue.textContent = authorization;
  elements.modelValue.textContent = model.id;
  elements.priceValue.textContent = "按实际 token 用量与模型售价计算";
  elements.curlValue.textContent = curl;
  elements.connectionPanel.hidden = false;
  elements.connectionPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function copyValue(targetId, button) {
  const value = document.querySelector(`#${targetId}`)?.textContent || "";
  try { await navigator.clipboard.writeText(value); button.textContent = "已复制"; setTimeout(() => { button.textContent = targetId === "curlValue" ? "复制 curl" : "复制"; }, 1500); }
  catch { showNotice("复制失败，请手动复制。", true); }
}

async function connect() {
  const key = elements.apiKey.value.trim();
  if (!key) return showNotice("请输入用户 API Key 后再连接。", true);
  localStorage.setItem(STORAGE_KEY, key);
  setLoading(true); setConnection("offline", "连接中");
  try {
    const [me, logResult, modelResult] = await Promise.all([api("/v1/me"), api("/v1/logs"), api("/v1/models")]);
    currentUser = me; logs = logResult.data || []; models = modelResult.data || [];
    renderAccount(); renderModels(); renderLogs(); setConnection("online", "已连接"); showNotice(`欢迎回来，${me.name}。`);
  } catch (error) {
    currentUser = null; logs = []; models = []; selectedModelId = null;
    renderAccount(); renderModels(); renderLogs(); setConnection("error", "连接失败"); showNotice(error.message, true, true);
  } finally { setLoading(false); }
}

function logout() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  elements.apiKey.value = "";
  currentUser = null; logs = []; models = []; selectedModelId = null;
  renderAccount(); renderModels(); renderLogs();
  elements.connectionPanel.hidden = true;
  setConnection("offline", "未连接");
  showNotice("已退出登录。");
}

const storedKey = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || "";
if (storedKey) { localStorage.setItem(STORAGE_KEY, storedKey); localStorage.removeItem(LEGACY_STORAGE_KEY); }
elements.apiKey.value = storedKey;
elements.connectButton.addEventListener("click", connect);
elements.refreshButton.addEventListener("click", connect);
elements.apiKey.addEventListener("keydown", (event) => { if (event.key === "Enter") connect(); });
elements.toggleKey.addEventListener("click", () => { const show = elements.apiKey.type === "password"; elements.apiKey.type = show ? "text" : "password"; elements.toggleKey.textContent = show ? "隐藏" : "显示"; });
elements.modelsGrid.addEventListener("click", (event) => { const card = event.target.closest("[data-model-id]"); if (!card) return; selectedModelId = card.dataset.modelId; elements.connectionPanel.hidden = true; renderModels(); });
elements.connectModelButton.addEventListener("click", showConnection);
elements.logoutButton.addEventListener("click", logout);
elements.connectionPanel.addEventListener("click", (event) => { const button = event.target.closest("[data-copy]"); if (button) copyValue(button.dataset.copy, button); });
if (storedKey) connect();
