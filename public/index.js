const loginElements = {
  userForm: document.querySelector("#userLoginForm"),
  userKey: document.querySelector("#userApiKey"),
  userButton: document.querySelector("#userLoginButton"),
  userMessage: document.querySelector("#userLoginMessage"),
  adminForm: document.querySelector("#adminLoginForm"),
  adminKey: document.querySelector("#adminApiKey"),
  adminButton: document.querySelector("#adminLoginButton"),
  adminMessage: document.querySelector("#adminLoginMessage"),
};

function setLoginState(button, message, loading, text = "") {
  button.disabled = loading;
  button.classList.toggle("loading", loading);
  message.hidden = !text;
  message.textContent = text;
}

async function parseError(response, fallback) {
  const body = await response.json().catch(() => null);
  return body?.error?.message || fallback;
}

loginElements.userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = loginElements.userKey.value.trim();
  if (!key) return setLoginState(loginElements.userButton, loginElements.userMessage, false, "请输入用户 API Key。");
  setLoginState(loginElements.userButton, loginElements.userMessage, true, "正在验证用户 API Key...");
  try {
    const response = await fetch("/v1/me", { headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error(await parseError(response, "用户 API Key 不正确。"));
    localStorage.setItem("userApiKey", key);
    localStorage.removeItem("apiGatewayUserKey");
    window.location.assign("/dashboard");
  } catch (error) {
    setLoginState(loginElements.userButton, loginElements.userMessage, false, error.message || "用户 API Key 不正确。");
  }
});

loginElements.adminForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = loginElements.adminKey.value.trim();
  if (!key) return setLoginState(loginElements.adminButton, loginElements.adminMessage, false, "请输入管理员 Key。");
  setLoginState(loginElements.adminButton, loginElements.adminMessage, true, "正在验证管理员 Key...");
  try {
    const response = await fetch("/admin/users", { headers: { "x-admin-api-key": key } });
    if (!response.ok) throw new Error(await parseError(response, "管理员 Key 不正确。"));
    localStorage.setItem("adminApiKey", key);
    localStorage.removeItem("apiGatewayAdminKey");
    window.location.assign("/admin");
  } catch (error) {
    setLoginState(loginElements.adminButton, loginElements.adminMessage, false, error.message || "管理员 Key 不正确。");
  }
});
