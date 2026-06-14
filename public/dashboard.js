const STORAGE_KEY = "apiGatewayUserKey";
const elements = {
  apiKey: document.querySelector("#apiKey"), toggleKey: document.querySelector("#toggleKey"),
  connectButton: document.querySelector("#connectButton"), refreshButton: document.querySelector("#refreshButton"),
  connectionBadge: document.querySelector("#connectionBadge"), notice: document.querySelector("#notice"),
  userName: document.querySelector("#userName"), balance: document.querySelector("#balance"),
  logCount: document.querySelector("#logCount"), successCount: document.querySelector("#successCount"),
  apiKeyDisplay: document.querySelector("#apiKeyDisplay"), copyKeyButton: document.querySelector("#copyKeyButton"),
  logsMeta: document.querySelector("#logsMeta"), logsBody: document.querySelector("#logsBody"),
};
let currentUser = null;
let logs = [];
let noticeTimer = null;

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#039;" })[char]); }
function formatNumber(value) { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value) || 0); }
function formatDuration(value) { return Number.isFinite(Number(value)) ? `${Number(value)} ms` : "-"; }
function setLoading(loading) { elements.connectButton.disabled = loading; elements.refreshButton.disabled = loading; elements.connectButton.classList.toggle("loading", loading); }
function setConnection(state, label) { elements.connectionBadge.className = `connection-badge ${state}`; elements.connectionBadge.querySelector("strong").textContent = label; }
function showNotice(message, isError = false, persistent = false) { clearTimeout(noticeTimer); elements.notice.textContent = message; elements.notice.classList.toggle("error", isError); elements.notice.hidden = false; if (!persistent) noticeTimer = setTimeout(() => { elements.notice.hidden = true; }, 4500); }
function getApiKey() { return elements.apiKey.value.trim(); }

async function api(path) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("请先输入用户 API Key。");
  const response = await fetch(path, { headers: { Authorization: `Bearer ${apiKey}` } });
  let body;
  try { body = await response.json(); } catch { throw new Error(`服务器返回了无法解析的响应（HTTP ${response.status}）。`); }
  if (!response.ok) throw new Error(body.error?.message || `请求失败（HTTP ${response.status}）。`);
  return body;
}

function renderAccount() {
  elements.userName.textContent = currentUser?.name || "--";
  elements.balance.textContent = currentUser ? formatNumber(currentUser.balance) : "--";
  elements.logCount.textContent = currentUser ? formatNumber(logs.length) : "--";
  elements.successCount.textContent = currentUser ? formatNumber(logs.filter((log) => Number(log.status) >= 200 && Number(log.status) < 300).length) : "--";
  elements.apiKeyDisplay.textContent = currentUser ? getApiKey() : "连接后显示";
  elements.copyKeyButton.disabled = !currentUser;
}

function renderLogs() {
  elements.logsMeta.textContent = `${logs.length} logs`;
  if (!logs.length) { elements.logsBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">当前账户暂无调用日志</div></td></tr>'; return; }
  elements.logsBody.innerHTML = logs.map((log) => {
    const success = Number(log.status) >= 200 && Number(log.status) < 300;
    return `<tr><td>${escapeHtml(new Date(log.timestamp).toLocaleString("zh-CN"))}</td><td>${escapeHtml(`${log.method || ""} ${log.route || ""}`.trim() || "-")}</td><td>${escapeHtml(log.model || "-")}</td><td><span class="status-pill ${success ? "success" : "error"}">${escapeHtml(log.status ?? "-")}</span></td><td>${formatNumber(log.charged)}</td><td>${escapeHtml(log.balanceAfter ?? log.balance ?? "-")}</td><td>${formatDuration(log.durationMs)}</td></tr>`;
  }).join("");
}

async function connect() {
  const key = getApiKey();
  if (!key) { showNotice("请输入用户 API Key 后再连接。", true); elements.apiKey.focus(); return; }
  localStorage.setItem(STORAGE_KEY, key);
  setLoading(true); setConnection("offline", "连接中");
  elements.logsBody.innerHTML = '<tr><td colspan="7"><div class="loading-row">正在加载账户数据</div></td></tr>';
  try {
    const [me, logResult] = await Promise.all([api("/v1/me"), api("/v1/logs")]);
    currentUser = me; logs = Array.isArray(logResult.data) ? logResult.data : [];
    renderAccount(); renderLogs(); setConnection("online", "已连接"); showNotice(`欢迎回来，${me.name}。`);
  } catch (error) {
    currentUser = null; logs = []; renderAccount(); renderLogs(); setConnection("error", "连接失败"); showNotice(error.message, true, true);
  } finally { setLoading(false); }
}

elements.apiKey.value = localStorage.getItem(STORAGE_KEY) || "";
elements.connectButton.addEventListener("click", connect);
elements.refreshButton.addEventListener("click", connect);
elements.apiKey.addEventListener("keydown", (event) => { if (event.key === "Enter") connect(); });
elements.toggleKey.addEventListener("click", () => { const show = elements.apiKey.type === "password"; elements.apiKey.type = show ? "text" : "password"; elements.toggleKey.textContent = show ? "隐藏" : "显示"; });
elements.copyKeyButton.addEventListener("click", async () => { if (!currentUser) return; try { await navigator.clipboard.writeText(getApiKey()); showNotice("API Key 已复制到剪贴板。") } catch { showNotice("浏览器未允许复制，请手动选择 API Key。", true); } });
document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => { document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active")); link.classList.add("active"); }));
