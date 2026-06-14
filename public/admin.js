const STORAGE_KEY = "adminApiKey";
const LEGACY_STORAGE_KEY = "apiGatewayAdminKey";
const elements = {};
for (const id of ["adminKey","toggleKey","loadButton","refreshButton","logoutButton","connectionBadge","notice","userCount","totalBalance","logCount","successCount","failureCount","todayCount","totalCharged","totalTokens","promptTokens","completionTokens","usersBody","logsBody","usersMeta","logsMeta","createForm","createButton","newName","newBalance","createdKey","createdKeyValue","dismissCreatedKey","topupDialog","topupForm","topupUserName","topupAmount","confirmTopup","closeTopup","cancelTopup","maintenanceToggle","defaultModelSelect","rateLimitToggle","perUserPerMinute","globalPerMinute","saveSettingsButton","providersBody","providerForm","providerId","providerName","providerBaseUrl","providerApiKeyEnv","modelsBody","modelForm","modelId","modelName","modelProviderId","modelIsDefault"]) elements[id] = document.querySelector(`#${id}`);

let users = [], logs = [], providers = [], models = [], settings = {}, selectedUser = null, noticeTimer = null;
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#039;" })[char]); }
function formatNumber(value) { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value) || 0); }
function formatUsd(value) { return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(Number(value) || 0)}`; }
function formatDuration(value) { return Number.isFinite(Number(value)) ? `${Number(value)} ms` : "-"; }
function tokenValue(log, field) { return Number(log?.usage?.[field]) || 0; }
function isSuccess(log) { const status = Number(log.status); return status >= 200 && status < 300; }
function isToday(timestamp) { const value = new Date(timestamp); const now = new Date(); return !Number.isNaN(value.getTime()) && value.getFullYear() === now.getFullYear() && value.getMonth() === now.getMonth() && value.getDate() === now.getDate(); }
function setButtonLoading(button, loading) { button.disabled = loading; button.classList.toggle("loading", loading); }
function setConnection(state, label) { elements.connectionBadge.className = `connection-badge ${state}`; elements.connectionBadge.querySelector("strong").textContent = label; }
function showNotice(message, isError = false, persistent = false) { clearTimeout(noticeTimer); elements.notice.textContent = message; elements.notice.classList.toggle("error", isError); elements.notice.hidden = false; if (!persistent) noticeTimer = setTimeout(() => { elements.notice.hidden = true; }, 4500); }
function showOneTimeKey(apiKey, message) { elements.createdKeyValue.textContent = apiKey; elements.createdKey.hidden = false; showNotice(`${message}。完整 API Key 只显示一次，请立即保存。`, false, true); }

async function api(url, options = {}) {
  const adminKey = elements.adminKey.value.trim();
  if (!adminKey) throw new Error("请先输入管理员 Key。");
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", "x-admin-api-key": adminKey, ...(options.headers || {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || `请求失败（HTTP ${response.status}）。`);
  return body;
}

function renderMetrics() {
  const successful = logs.filter(isSuccess).length;
  const values = {
    userCount: users.length,
    totalBalance: users.reduce((sum, user) => sum + Number(user.balanceUsd ?? user.balance ?? 0), 0),
    logCount: logs.length,
    successCount: successful,
    failureCount: logs.length - successful,
    todayCount: logs.filter((log) => isToday(log.timestamp)).length,
    totalCharged: logs.reduce((sum, log) => sum + Number(log.chargeUsd ?? log.charged ?? 0), 0),
    totalTokens: logs.reduce((sum, log) => sum + tokenValue(log, "total_tokens"), 0),
    promptTokens: logs.reduce((sum, log) => sum + tokenValue(log, "prompt_tokens"), 0),
    completionTokens: logs.reduce((sum, log) => sum + tokenValue(log, "completion_tokens"), 0),
  };
  for (const [id, value] of Object.entries(values)) elements[id].textContent = ["totalBalance", "totalCharged"].includes(id) ? formatUsd(value) : formatNumber(value);
  elements.logoutButton.hidden = false;
}

function renderUsers() {
  elements.usersMeta.textContent = `${users.length} 个用户`;
  elements.usersBody.innerHTML = users.length ? users.map((user) => `<tr><td>#${escapeHtml(user.id)}</td><td><span class="user-name">${escapeHtml(user.name)}</span></td><td><code class="key-chip">${escapeHtml(user.keyPreview || "-")}</code><span class="key-status ${user.apiKeyEnabled ? "enabled" : "disabled"}">${user.apiKeyEnabled ? "已启用" : "已禁用"}</span></td><td><span class="balance">${formatUsd(user.balanceUsd ?? user.balance)}</span></td><td class="align-right"><span class="user-actions"><button class="topup-button" data-action="topup" data-user-id="${user.id}">充值</button><button class="topup-button" data-action="toggle" data-user-id="${user.id}">${user.apiKeyEnabled ? "禁用" : "启用"}</button><button class="topup-button danger" data-action="rotate" data-user-id="${user.id}">轮换 Key</button></span></td></tr>`).join("") : '<tr><td colspan="5"><div class="empty-state">暂无用户</div></td></tr>';
}

function renderLogs() {
  elements.logsMeta.textContent = `${logs.length} 条`;
  elements.logsBody.innerHTML = logs.length ? logs.map((log) => `<tr><td>${escapeHtml(new Date(log.timestamp).toLocaleString("zh-CN"))}</td><td>${escapeHtml(log.userName || log.userId || "-")}</td><td>${escapeHtml(`${log.method || ""} ${log.route || ""}`.trim())}</td><td>${escapeHtml(log.model || "-")}</td><td><span class="status-pill ${isSuccess(log) ? "success" : "error"}">${escapeHtml(log.status)}</span></td><td>${formatUsd(log.chargeUsd ?? log.charged)}</td><td>${formatNumber(log.totalTokens ?? tokenValue(log, "total_tokens"))}</td><td>${formatDuration(log.durationMs)}</td></tr>`).join("") : '<tr><td colspan="8"><div class="empty-state">暂无调用日志</div></td></tr>';
}

function modelStats(modelId) {
  const matching = logs.filter((log) => log.model === modelId);
  return { calls: matching.length, tokens: matching.reduce((sum, log) => sum + Number(log.totalTokens ?? tokenValue(log, "total_tokens")), 0) };
}

function renderConfiguration() {
  elements.maintenanceToggle.checked = Boolean(settings.maintenanceMode);
  elements.rateLimitToggle.checked = settings.rateLimitEnabled !== false;
  elements.perUserPerMinute.value = settings.perUserPerMinute ?? 20;
  elements.globalPerMinute.value = settings.globalPerMinute ?? 100;
  elements.defaultModelSelect.innerHTML = models.map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === settings.defaultModel ? "selected" : ""}>${escapeHtml(model.name)} (${escapeHtml(model.id)})</option>`).join("");
  elements.modelProviderId.innerHTML = providers.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)} (${escapeHtml(provider.id)})</option>`).join("");
  elements.providersBody.innerHTML = providers.length ? providers.map((provider) => `<tr><td><code>${escapeHtml(provider.id)}</code></td><td>${escapeHtml(provider.name)}</td><td><div class="config-value">${escapeHtml(provider.baseUrl)}</div></td><td><code>${escapeHtml(provider.apiKeyEnv)}</code></td><td><span class="key-status ${provider.enabled ? "enabled" : "disabled"}">${provider.enabled ? "已启用" : "已禁用"}</span></td><td class="align-right"><button class="topup-button" data-provider-action="toggle" data-provider-id="${escapeHtml(provider.id)}">${provider.enabled ? "禁用" : "启用"}</button></td></tr>`).join("") : '<tr><td colspan="6"><div class="empty-state">暂无供应商</div></td></tr>';
  elements.modelsBody.innerHTML = models.length ? models.map((model) => { const stats = modelStats(model.id); const pricing = model.pricing || {}; const input = Number(pricing.baseInput) || 0; const output = Number(pricing.baseOutput) || 0; const multiplier = Number(pricing.saleMultiplier) > 0 ? Number(pricing.saleMultiplier) : 1; return `<tr><td><code>${escapeHtml(model.id)}</code></td><td>${escapeHtml(model.name)}</td><td>${escapeHtml(model.providerId)}</td><td><span class="key-status ${model.enabled ? "enabled" : "disabled"}">${model.enabled ? "是" : "否"}</span></td><td>${model.isDefault ? '<span class="key-status enabled">是</span>' : "否"}</td><td>${formatUsd(input)}</td><td>${formatUsd(output)}</td><td>${formatNumber(multiplier)} 倍</td><td>${formatUsd(input * multiplier)}</td><td>${formatUsd(output * multiplier)}</td><td>${formatNumber(stats.calls)}</td><td>${formatNumber(stats.tokens)}</td><td class="align-right"><span class="user-actions"><button class="topup-button" data-model-action="pricing" data-model-id="${escapeHtml(model.id)}">调整倍率</button><button class="topup-button" data-model-action="toggle" data-model-id="${escapeHtml(model.id)}">${model.enabled ? "禁用" : "启用"}</button><button class="topup-button" data-model-action="default" data-model-id="${escapeHtml(model.id)}">设为默认</button></span></td></tr>`; }).join("") : '<tr><td colspan="13"><div class="empty-state">暂无模型</div></td></tr>';
}

async function refreshData() {
  const key = elements.adminKey.value.trim(); if (!key) return showNotice("请输入管理员 Key 后再连接。", true);
  localStorage.setItem(STORAGE_KEY, key); setButtonLoading(elements.loadButton, true); elements.refreshButton.disabled = true; setConnection("offline", "连接中");
  try { const [u,l,s,p,m] = await Promise.all([api("/admin/users"),api("/admin/logs"),api("/admin/settings"),api("/admin/providers"),api("/admin/models")]); users=u.data||[]; logs=l.data||[]; settings=s.data||s||{}; providers=p.data||[]; models=m.data||[]; renderUsers(); renderLogs(); renderMetrics(); renderConfiguration(); setConnection("online","已连接"); showNotice("数据已刷新。"); }
  catch (error) { setConnection("error","连接失败"); showNotice(error.message,true,true); }
  finally { setButtonLoading(elements.loadButton,false); elements.refreshButton.disabled=false; }
}
async function loadUsers() { const result=await api("/admin/users"); users=result.data||[]; renderUsers(); renderMetrics(); }
async function loadConfiguration() { const [s,p,m]=await Promise.all([api("/admin/settings"),api("/admin/providers"),api("/admin/models")]); settings=s.data||s||{}; providers=p.data||[]; models=m.data||[]; renderConfiguration(); }
async function saveSettings() { setButtonLoading(elements.saveSettingsButton,true); try { const perUserPerMinute=Number(elements.perUserPerMinute.value), globalPerMinute=Number(elements.globalPerMinute.value); if(!Number.isInteger(perUserPerMinute)||perUserPerMinute<1||!Number.isInteger(globalPerMinute)||globalPerMinute<1) throw new Error("限流值必须是正整数。"); settings=await api("/admin/settings",{method:"PATCH",body:JSON.stringify({maintenanceMode:elements.maintenanceToggle.checked,defaultModel:elements.defaultModelSelect.value,rateLimitEnabled:elements.rateLimitToggle.checked,perUserPerMinute,globalPerMinute})}); renderConfiguration(); showNotice("系统设置已保存。"); } catch(e){showNotice(e.message,true,true);} finally{setButtonLoading(elements.saveSettingsButton,false);} }
async function createProvider(event){event.preventDefault();try{await api("/admin/providers",{method:"POST",body:JSON.stringify({id:elements.providerId.value.trim(),name:elements.providerName.value.trim(),baseUrl:elements.providerBaseUrl.value.trim(),apiKeyEnv:elements.providerApiKeyEnv.value.trim(),enabled:true})});elements.providerForm.reset();await loadConfiguration();showNotice("供应商已创建。");}catch(e){showNotice(e.message,true,true);}}
async function createModel(event){event.preventDefault();try{await api("/admin/models",{method:"POST",body:JSON.stringify({id:elements.modelId.value.trim(),name:elements.modelName.value.trim(),providerId:elements.modelProviderId.value,enabled:true,isDefault:elements.modelIsDefault.checked,priceMultiplier:1})});elements.modelForm.reset();await loadConfiguration();showNotice("模型已创建。");}catch(e){showNotice(e.message,true,true);}}
async function toggleProvider(provider){try{await api(`/admin/providers/${encodeURIComponent(provider.id)}`,{method:"PATCH",body:JSON.stringify({enabled:!provider.enabled})});await loadConfiguration();showNotice("供应商状态已更新。");}catch(e){showNotice(e.message,true,true);}}
async function updateModel(model,changes){try{await api(`/admin/models/${encodeURIComponent(model.id)}`,{method:"PATCH",body:JSON.stringify(changes)});await loadConfiguration();showNotice("模型已更新。");}catch(e){showNotice(e.message,true,true);}}
async function adjustModelPricing(model){const current=Number(model.pricing?.saleMultiplier)||1;const value=window.prompt(`请输入 ${model.name} 的销售倍率（必须大于 0）`,String(current));if(value===null)return;const saleMultiplier=Number(value);if(!Number.isFinite(saleMultiplier)||saleMultiplier<=0)return showNotice("销售倍率必须是大于 0 的数字。",true);await updateModel(model,{pricing:{saleMultiplier}});}
async function createUser(event){event.preventDefault();setButtonLoading(elements.createButton,true);try{const user=await api("/admin/users",{method:"POST",body:JSON.stringify({name:elements.newName.value.trim(),balanceUsd:Number(elements.newBalance.value)})});elements.createForm.reset();elements.newBalance.value="0";showOneTimeKey(user.apiKey,`用户 ${user.name} 已创建`);await loadUsers();}catch(e){showNotice(e.message,true,true);}finally{setButtonLoading(elements.createButton,false);}}
function openTopup(user){selectedUser=user;elements.topupUserName.textContent=user.name;elements.topupAmount.value="10";elements.topupDialog.showModal();} function closeTopup(){selectedUser=null;elements.topupDialog.close();}
async function submitTopup(event){event.preventDefault();if(!selectedUser)return;const amount=Number(elements.topupAmount.value);if(!Number.isFinite(amount)||amount<=0)return showNotice("充值金额必须大于 0 USD。",true);setButtonLoading(elements.confirmTopup,true);try{const user=await api(`/admin/users/${selectedUser.id}/topup`,{method:"POST",body:JSON.stringify({amount})});closeTopup();showNotice(`${user.name} 的余额已更新为 ${formatUsd(user.balanceUsd ?? user.balance)}。`);await loadUsers();}catch(e){showNotice(e.message,true,true);}finally{setButtonLoading(elements.confirmTopup,false);}}
async function toggleKey(user){try{await api(`/admin/users/${user.id}/api-key`,{method:"PATCH",body:JSON.stringify({enabled:!user.apiKeyEnabled})});showNotice(`${user.name} 的 API Key 已${user.apiKeyEnabled?"禁用":"启用"}。`);await loadUsers();}catch(e){showNotice(e.message,true,true);}}
async function rotateKey(user){if(!window.confirm(`轮换 ${user.name} 的 API Key？旧 Key 将立即失效。`))return;try{const result=await api(`/admin/users/${user.id}/rotate-key`,{method:"POST"});showOneTimeKey(result.apiKey,`${user.name} 的 API Key 已轮换`);await loadUsers();}catch(e){showNotice(e.message,true,true);}}

function logout(){
  localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_STORAGE_KEY); elements.adminKey.value="";
  users=[]; logs=[]; providers=[]; models=[]; settings={};
  for(const id of ["userCount","totalBalance","logCount","successCount","failureCount","todayCount","totalCharged","totalTokens","promptTokens","completionTokens"]) elements[id].textContent="--";
  elements.usersMeta.textContent="0 个用户"; elements.logsMeta.textContent="0 条";
  elements.usersBody.innerHTML='<tr><td colspan="5"><div class="empty-state">连接后加载用户数据</div></td></tr>';
  elements.logsBody.innerHTML='<tr><td colspan="8"><div class="empty-state">连接后加载调用日志</div></td></tr>';
  elements.providersBody.innerHTML='<tr><td colspan="6"><div class="empty-state">连接后加载供应商</div></td></tr>';
  elements.modelsBody.innerHTML='<tr><td colspan="13"><div class="empty-state">连接后加载模型</div></td></tr>';
  elements.logoutButton.hidden=true; setConnection("offline","未连接"); showNotice("已退出登录。");
}

const storedKey=localStorage.getItem(STORAGE_KEY)||localStorage.getItem(LEGACY_STORAGE_KEY)||"";
if(storedKey){localStorage.setItem(STORAGE_KEY,storedKey);localStorage.removeItem(LEGACY_STORAGE_KEY);}
elements.adminKey.value=storedKey;
elements.loadButton.addEventListener("click",refreshData); elements.refreshButton.addEventListener("click",refreshData); elements.adminKey.addEventListener("keydown",e=>{if(e.key==="Enter")refreshData();});
elements.toggleKey.addEventListener("click",()=>{const show=elements.adminKey.type==="password";elements.adminKey.type=show?"text":"password";elements.toggleKey.textContent=show?"隐藏":"显示";});
elements.logoutButton.addEventListener("click",logout);
elements.createForm.addEventListener("submit",createUser); elements.topupForm.addEventListener("submit",submitTopup); elements.closeTopup.addEventListener("click",closeTopup); elements.cancelTopup.addEventListener("click",closeTopup);
elements.dismissCreatedKey.addEventListener("click",()=>{elements.createdKey.hidden=true;elements.createdKeyValue.textContent="";}); elements.saveSettingsButton.addEventListener("click",saveSettings); elements.providerForm.addEventListener("submit",createProvider); elements.modelForm.addEventListener("submit",createModel);
elements.usersBody.addEventListener("click",e=>{const b=e.target.closest("[data-action]");if(!b)return;const u=users.find(x=>String(x.id)===b.dataset.userId);if(!u)return;if(b.dataset.action==="topup")openTopup(u);if(b.dataset.action==="toggle")toggleKey(u);if(b.dataset.action==="rotate")rotateKey(u);});
elements.providersBody.addEventListener("click",e=>{const b=e.target.closest("[data-provider-action]");if(!b)return;const p=providers.find(x=>x.id===b.dataset.providerId);if(p)toggleProvider(p);});
elements.modelsBody.addEventListener("click",e=>{const b=e.target.closest("[data-model-action]");if(!b)return;const m=models.find(x=>x.id===b.dataset.modelId);if(!m)return;if(b.dataset.modelAction==="pricing")adjustModelPricing(m);if(b.dataset.modelAction==="toggle")updateModel(m,{enabled:!m.enabled});if(b.dataset.modelAction==="default")updateModel(m,{isDefault:true});});
if(storedKey)refreshData();
