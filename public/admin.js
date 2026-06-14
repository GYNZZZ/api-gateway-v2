const STORAGE_KEY = "apiGatewayAdminKey";

const elements = {
  adminKey: document.querySelector("#adminKey"),
  toggleKey: document.querySelector("#toggleKey"),
  loadButton: document.querySelector("#loadButton"),
  refreshButton: document.querySelector("#refreshButton"),
  connectionBadge: document.querySelector("#connectionBadge"),
  notice: document.querySelector("#notice"),
  userCount: document.querySelector("#userCount"),
  totalBalance: document.querySelector("#totalBalance"),
  logCount: document.querySelector("#logCount"),
  successCount: document.querySelector("#successCount"),
  usersBody: document.querySelector("#usersBody"),
  logsBody: document.querySelector("#logsBody"),
  usersMeta: document.querySelector("#usersMeta"),
  logsMeta: document.querySelector("#logsMeta"),
  createForm: document.querySelector("#createForm"),
  createButton: document.querySelector("#createButton"),
  newName: document.querySelector("#newName"),
  newBalance: document.querySelector("#newBalance"),
  createdKey: document.querySelector("#createdKey"),
  createdKeyValue: document.querySelector("#createdKeyValue"),
  dismissCreatedKey: document.querySelector("#dismissCreatedKey"),
  topupDialog: document.querySelector("#topupDialog"),
  topupForm: document.querySelector("#topupForm"),
  topupUserName: document.querySelector("#topupUserName"),
  topupAmount: document.querySelector("#topupAmount"),
  confirmTopup: document.querySelector("#confirmTopup"),
  closeTopup: document.querySelector("#closeTopup"),
  cancelTopup: document.querySelector("#cancelTopup"),
};

let users = [];
let logs = [];
let selectedUser = null;
let noticeTimer = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character]);
}

function maskApiKey(apiKey) {
  const value = String(apiKey || "");
  if (value.length <= 8) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
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
  window.clearTimeout(noticeTimer);
  elements.notice.textContent = message;
  elements.notice.classList.toggle("error", isError);
  elements.notice.hidden = false;
  if (!persistent) {
    noticeTimer = window.setTimeout(() => { elements.notice.hidden = true; }, 4500);
  }
}

function getAdminKey() {
  return elements.adminKey.value.trim();
}

async function api(path, options = {}) {
  const adminKey = getAdminKey();
  if (!adminKey) throw new Error("请先输入管理员 Key。");

  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-admin-api-key": adminKey,
      ...(options.headers || {}),
    },
  });

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`服务器返回了无法解析的响应（HTTP ${response.status}）。`);
  }

  if (!response.ok) {
    throw new Error(body.error?.message || `请求失败（HTTP ${response.status}）。`);
  }
  return body;
}

function renderMetrics() {
  elements.userCount.textContent = formatNumber(users.length);
  elements.totalBalance.textContent = formatNumber(users.reduce((sum, user) => sum + (Number(user.balance) || 0), 0));
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
      <td><code class="key-chip" title="已脱敏">${escapeHtml(maskApiKey(user.apiKey))}</code></td>
      <td><span class="balance">${formatNumber(user.balance)}</span></td>
      <td class="align-right"><button class="topup-button" type="button" data-topup-id="${escapeHtml(user.id)}">充值</button></td>
    </tr>
  `).join("");
}

function renderLogs() {
  elements.logsMeta.textContent = `${logs.length} logs`;
  if (!logs.length) {
    elements.logsBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">暂无调用日志</div></td></tr>';
    return;
  }

  elements.logsBody.innerHTML = logs.map((log) => {
    const success = Number(log.status) >= 200 && Number(log.status) < 300;
    return `
      <tr>
        <td>${escapeHtml(new Date(log.timestamp).toLocaleString("zh-CN"))}</td>
        <td>${escapeHtml(log.userName || log.userId || "-")}</td>
        <td>${escapeHtml(`${log.method || ""} ${log.route || ""}`.trim() || "-")}</td>
        <td>${escapeHtml(log.model || "-")}</td>
        <td><span class="status-pill ${success ? "success" : "error"}">${escapeHtml(log.status ?? "-")}</span></td>
        <td>${formatNumber(log.charged)}</td>
        <td>${formatDuration(log.durationMs)}</td>
      </tr>
    `;
  }).join("");
}

function showTableLoading() {
  elements.usersBody.innerHTML = '<tr><td colspan="5"><div class="loading-row">正在加载用户</div></td></tr>';
  elements.logsBody.innerHTML = '<tr><td colspan="7"><div class="loading-row">正在加载日志</div></td></tr>';
}

async function refreshData() {
  const key = getAdminKey();
  if (!key) {
    setConnection("offline", "未连接");
    showNotice("请输入管理员 Key 后再连接。", true);
    elements.adminKey.focus();
    return;
  }

  localStorage.setItem(STORAGE_KEY, key);
  setButtonLoading(elements.loadButton, true);
  elements.refreshButton.disabled = true;
  setConnection("offline", "连接中");
  showTableLoading();

  try {
    const [usersResult, logsResult] = await Promise.all([
      api("/admin/users"),
      api("/admin/logs"),
    ]);
    users = Array.isArray(usersResult.data) ? usersResult.data : [];
    logs = Array.isArray(logsResult.data) ? logsResult.data : [];
    renderUsers();
    renderLogs();
    renderMetrics();
    setConnection("online", "已连接");
    showNotice("用户与日志数据已刷新。");
  } catch (error) {
    users = [];
    logs = [];
    renderUsers();
    renderLogs();
    renderMetrics();
    setConnection("error", "连接失败");
    showNotice(error.message, true, true);
  } finally {
    setButtonLoading(elements.loadButton, false);
    elements.refreshButton.disabled = false;
  }
}

async function createUser(event) {
  event.preventDefault();
  setButtonLoading(elements.createButton, true);
  try {
    const user = await api("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        name: elements.newName.value.trim(),
        balance: Number(elements.newBalance.value),
      }),
    });
    elements.createForm.reset();
    elements.newBalance.value = "0";
    elements.createdKeyValue.textContent = user.apiKey;
    elements.createdKey.hidden = false;
    showNotice(`用户 ${user.name} 已创建。请妥善保存新 API Key。`);
    const usersResult = await api("/admin/users");
    users = Array.isArray(usersResult.data) ? usersResult.data : [];
    renderUsers();
    renderMetrics();
  } catch (error) {
    showNotice(error.message, true, true);
  } finally {
    setButtonLoading(elements.createButton, false);
  }
}

function openTopup(userId) {
  selectedUser = users.find((user) => String(user.id) === String(userId));
  if (!selectedUser) return;
  elements.topupUserName.textContent = selectedUser.name;
  elements.topupAmount.value = "10";
  elements.topupDialog.showModal();
}

function closeTopup() {
  selectedUser = null;
  elements.topupDialog.close();
}

async function submitTopup(event) {
  event.preventDefault();
  if (!selectedUser) return;
  const amount = Number(elements.topupAmount.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showNotice("充值金额必须大于 0。", true);
    return;
  }

  setButtonLoading(elements.confirmTopup, true);
  try {
    const updatedUser = await api(`/admin/users/${selectedUser.id}/topup`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    });
    closeTopup();
    showNotice(`${updatedUser.name} 的余额已更新为 ${formatNumber(updatedUser.balance)}。`);
    const usersResult = await api("/admin/users");
    users = Array.isArray(usersResult.data) ? usersResult.data : [];
    renderUsers();
    renderMetrics();
  } catch (error) {
    showNotice(error.message, true, true);
  } finally {
    setButtonLoading(elements.confirmTopup, false);
  }
}

elements.adminKey.value = localStorage.getItem(STORAGE_KEY) || "";
elements.loadButton.addEventListener("click", refreshData);
elements.refreshButton.addEventListener("click", refreshData);
elements.createForm.addEventListener("submit", createUser);
elements.topupForm.addEventListener("submit", submitTopup);
elements.closeTopup.addEventListener("click", closeTopup);
elements.cancelTopup.addEventListener("click", closeTopup);
elements.dismissCreatedKey.addEventListener("click", () => {
  elements.createdKey.hidden = true;
  elements.createdKeyValue.textContent = "";
});
elements.toggleKey.addEventListener("click", () => {
  const show = elements.adminKey.type === "password";
  elements.adminKey.type = show ? "text" : "password";
  elements.toggleKey.textContent = show ? "隐藏" : "显示";
});
elements.usersBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-topup-id]");
  if (button) openTopup(button.dataset.topupId);
});
elements.adminKey.addEventListener("keydown", (event) => {
  if (event.key === "Enter") refreshData();
});

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});
