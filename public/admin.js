const STORAGE_KEY = "apiGatewayAdminKey";

const elements = {
  adminKey: document.querySelector("#adminKey"), toggleKey: document.querySelector("#toggleKey"),
  loadButton: document.querySelector("#loadButton"), refreshButton: document.querySelector("#refreshButton"),
  connectionBadge: document.querySelector("#connectionBadge"), notice: document.querySelector("#notice"),
  userCount: document.querySelector("#userCount"), totalBalance: document.querySelector("#totalBalance"),
  logCount: document.querySelector("#logCount"), successCount: document.querySelector("#successCount"),
  usersBody: document.querySelector("#usersBody"), logsBody: document.querySelector("#logsBody"),
  usersMeta: document.querySelector("#usersMeta"), logsMeta: document.querySelector("#logsMeta"),
  createForm: document.querySelector("#createForm"), createButton: document.querySelector("#createButton"),
  newName: document.querySelector("#newName"), newBalance: document.querySelector("#newBalance"),
  createdKey: document.querySelector("#createdKey"), createdKeyValue: document.querySelector("#createdKeyValue"),
  dismissCreatedKey: document.querySelector("#dismissCreatedKey"), topupDialog: document.querySelector("#topupDialog"),
  topupForm: document.querySelector("#topupForm"), topupUserName: document.querySelector("#topupUserName"),
  topupAmount: document.querySelector("#topupAmount"), confirmTopup: document.querySelector("#confirmTopup"),
  closeTopup: document.querySelector("#closeTopup"), cancelTopup: document.querySelector("#cancelTopup"),
};

let users = [];
let logs = [];
let selectedUser = null;
let noticeTimer = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
  })[character]);
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDuration(value) {
  return Number.isFinite(Number(value)) ? `${Number(value)} ms` : "-";
}

function setButtonLoading(button, loading) {
  button.disabled = loading;
  button.classList.toggle("loading", loading);
}

function setConnection(state, label) {
  elements.connectionBadge.className = `connection-badge ${state}`;
  elements.connectionBadge.querySelector("strong").textContent = label;
}

function showNotice(message, isError = false, persistent = false) {
  clearTimeout(noticeTimer);
  elements.notice.textContent = message;
  elements.notice.classList.toggle("error", isError);
  elements.notice.hidden = false;
  if (!persistent) noticeTimer = setTimeout(() => { elements.notice.hidden = true; }, 4500);
}

function showOneTimeKey(apiKey, message) {
  elements.createdKeyValue.textContent = apiKey;
  elements.createdKey.hidden = false;
  showNotice(`${message}。完整 API Key 只显示一次，请立即保存。`, false, true);
}

async function api(url, options = {}) {
  const adminKey = elements.adminKey.value.trim();
  if (!adminKey) throw new Error("请先输入管理员 Key。");
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", "x-admin-api-key": adminKey, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || `请求失败（HTTP ${response.status}）。`);
  return body;
}

function renderMetrics() {
  elements.userCount.textContent = formatNumber(users.length);
  elements.totalBalance.textContent = formatNumber(users.reduce((sum, user) => sum + Number(user.balance || 0), 0));
  elements.logCount.textContent = formatNumber(logs.length);
  elements.successCount.textContent = formatNumber(logs.filter((log) => Number(log.status) >= 200 && Number(log.status) < 300).length);
}

function renderUsers() {
  elements.usersMeta.textContent = `${users.length} users`;
  if (!users.length) {
    elements.usersBody.innerHTML = '<tr><td colspan="5"><div class="empty-state">暂无用户</div></td></tr>';
    return;
  }
  elements.usersBody.innerHTML = users.map((user) => `
    <tr>
      <td>#${escapeHtml(user.id)}</td>
      <td><span class="user-name">${escapeHtml(user.name)}</span></td>
      <td><code class="key-chip">${escapeHtml(user.keyPreview || "-")}</code><span class="key-status ${user.apiKeyEnabled ? "enabled" : "disabled"}">${user.apiKeyEnabled ? "已启用" : "已禁用"}</span></td>
      <td><span class="balance">${formatNumber(user.balance)}</span></td>
      <td class="align-right"><span class="user-actions"><button class="topup-button" data-action="topup" data-user-id="${user.id}">充值</button><button class="topup-button" data-action="toggle" data-user-id="${user.id}">${user.apiKeyEnabled ? "禁用 Key" : "启用 Key"}</button><button class="topup-button danger" data-action="rotate" data-user-id="${user.id}">轮换 Key</button></span></td>
    </tr>`).join("");
}

function renderLogs() {
  elements.logsMeta.textContent = `${logs.length} logs`;
  if (!logs.length) {
    elements.logsBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">暂无调用日志</div></td></tr>';
    return;
  }
  elements.logsBody.innerHTML = logs.map((log) => {
    const success = Number(log.status) >= 200 && Number(log.status) < 300;
    return `<tr><td>${escapeHtml(new Date(log.timestamp).toLocaleString("zh-CN"))}</td><td>${escapeHtml(log.userName || log.userId || "-")}</td><td>${escapeHtml(`${log.method || ""} ${log.route || ""}`.trim())}</td><td>${escapeHtml(log.model || "-")}</td><td><span class="status-pill ${success ? "success" : "error"}">${escapeHtml(log.status)}</span></td><td>${formatNumber(log.charged)}</td><td>${formatDuration(log.durationMs)}</td></tr>`;
  }).join("");
}

async function loadUsers() {
  const result = await api("/admin/users");
  users = Array.isArray(result.data) ? result.data : [];
  renderUsers(); renderMetrics();
}

async function refreshData() {
  const key = elements.adminKey.value.trim();
  if (!key) return showNotice("请输入管理员 Key 后再连接。", true);
  localStorage.setItem(STORAGE_KEY, key);
  setButtonLoading(elements.loadButton, true); elements.refreshButton.disabled = true; setConnection("offline", "连接中");
  try {
    const [usersResult, logsResult] = await Promise.all([api("/admin/users"), api("/admin/logs")]);
    users = usersResult.data || []; logs = logsResult.data || [];
    renderUsers(); renderLogs(); renderMetrics(); setConnection("online", "已连接"); showNotice("数据已刷新。");
  } catch (error) { setConnection("error", "连接失败"); showNotice(error.message, true, true); }
  finally { setButtonLoading(elements.loadButton, false); elements.refreshButton.disabled = false; }
}

async function createUser(event) {
  event.preventDefault(); setButtonLoading(elements.createButton, true);
  try {
    const user = await api("/admin/users", { method: "POST", body: JSON.stringify({ name: elements.newName.value.trim(), balance: Number(elements.newBalance.value) }) });
    elements.createForm.reset(); elements.newBalance.value = "0"; showOneTimeKey(user.apiKey, `用户 ${user.name} 已创建`); await loadUsers();
  } catch (error) { showNotice(error.message, true, true); }
  finally { setButtonLoading(elements.createButton, false); }
}

function openTopup(user) {
  selectedUser = user; elements.topupUserName.textContent = user.name; elements.topupAmount.value = "10"; elements.topupDialog.showModal();
}

function closeTopup() { selectedUser = null; elements.topupDialog.close(); }

async function submitTopup(event) {
  event.preventDefault(); if (!selectedUser) return;
  const amount = Number(elements.topupAmount.value);
  if (!Number.isFinite(amount) || amount <= 0) return showNotice("充值金额必须大于 0。", true);
  setButtonLoading(elements.confirmTopup, true);
  try { const user = await api(`/admin/users/${selectedUser.id}/topup`, { method: "POST", body: JSON.stringify({ amount }) }); closeTopup(); showNotice(`${user.name} 的余额已更新为 ${formatNumber(user.balance)}。`); await loadUsers(); }
  catch (error) { showNotice(error.message, true, true); }
  finally { setButtonLoading(elements.confirmTopup, false); }
}

async function toggleKey(user) {
  try { await api(`/admin/users/${user.id}/api-key`, { method: "PATCH", body: JSON.stringify({ enabled: !user.apiKeyEnabled }) }); showNotice(`${user.name} 的 API Key 已${user.apiKeyEnabled ? "禁用" : "启用"}。`); await loadUsers(); }
  catch (error) { showNotice(error.message, true, true); }
}

async function rotateKey(user) {
  if (!window.confirm(`轮换 ${user.name} 的 API Key？旧 Key 将立即失效。`)) return;
  try { const result = await api(`/admin/users/${user.id}/rotate-key`, { method: "POST" }); showOneTimeKey(result.apiKey, `${user.name} 的 API Key 已轮换`); await loadUsers(); }
  catch (error) { showNotice(error.message, true, true); }
}

elements.adminKey.value = localStorage.getItem(STORAGE_KEY) || "";
elements.loadButton.addEventListener("click", refreshData); elements.refreshButton.addEventListener("click", refreshData);
elements.createForm.addEventListener("submit", createUser); elements.topupForm.addEventListener("submit", submitTopup);
elements.closeTopup.addEventListener("click", closeTopup); elements.cancelTopup.addEventListener("click", closeTopup);
elements.dismissCreatedKey.addEventListener("click", () => { elements.createdKey.hidden = true; elements.createdKeyValue.textContent = ""; });
elements.toggleKey.addEventListener("click", () => { const show = elements.adminKey.type === "password"; elements.adminKey.type = show ? "text" : "password"; elements.toggleKey.textContent = show ? "隐藏" : "显示"; });
elements.usersBody.addEventListener("click", (event) => { const button = event.target.closest("[data-action]"); if (!button) return; const user = users.find((item) => String(item.id) === button.dataset.userId); if (!user) return; if (button.dataset.action === "topup") openTopup(user); if (button.dataset.action === "toggle") toggleKey(user); if (button.dataset.action === "rotate") rotateKey(user); });
elements.adminKey.addEventListener("keydown", (event) => { if (event.key === "Enter") refreshData(); });
