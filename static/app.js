const state = {
  me: null,
  plans: [],
  users: [],
  panels: [],
  nodes: [],
  rechargeCards: [],
  transactions: [],
  expandedUsers: new Set(),
  settings: {},
  inbounds: [],
  view: "home",
  pendingPlanId: null,
  loadingCount: 0,
  loadingStartedAt: 0,
  loadingTimer: null,
  elapsedTimer: null,
  authReturnFocus: null,
  profilePrefs: { expireReminder: true, trafficReminder: true, autoRenew: false },
  profileAvatar: "",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function beginLoading(action = "正在处理") {
  if (state.loadingCount === 0) {
    state.loadingStartedAt = Date.now();
    state.loadingTimer = window.setTimeout(() => {
      if (!state.loadingCount) return;
      $("#loaderAction").textContent = action;
      updateElapsedTime();
      $("#slowLoader").classList.remove("hidden");
      state.elapsedTimer = window.setInterval(updateElapsedTime, 1000);
    }, 600);
  }
  state.loadingCount += 1;
}

function updateElapsedTime() {
  const elapsed = Math.max(1, Math.floor((Date.now() - state.loadingStartedAt) / 1000));
  $("#loaderElapsed").textContent = `已等待 ${elapsed} 秒`;
}

function endLoading() {
  state.loadingCount = Math.max(0, state.loadingCount - 1);
  if (state.loadingCount) return;
  window.clearTimeout(state.loadingTimer);
  window.clearInterval(state.elapsedTimer);
  state.loadingTimer = null;
  state.elapsedTimer = null;
  $("#slowLoader").classList.add("hidden");
}

async function api(path, options = {}) {
  const { loadingLabel = "正在处理", ...fetchOptions } = options;
  beginLoading(loadingLabel);
  try {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...fetchOptions,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败: ${res.status}`);
    return data;
  } finally {
    endLoading();
  }
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  $$("input[type=checkbox]", form).forEach((input) => {
    data[input.name] = input.checked;
  });
  return data;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)}${units[unit]}`;
}

function quotaGb(plan) {
  return ((Number(plan.quota_bytes || 0) / 1024 ** 3) || 0).toFixed(0);
}

function formatMoney(cents) {
  return `¥${(Number(cents || 0) / 100).toFixed(2)}`;
}

function priceYuan(plan) {
  return (Number(plan.price_cents || 0) / 100).toFixed(2);
}

function toDate(seconds) {
  if (!seconds) return "-";
  return new Date(Number(seconds) * 1000).toLocaleDateString("zh-CN");
}

function toDateTime(seconds) {
  if (!seconds) return "-";
  return new Date(Number(seconds) * 1000).toLocaleString("zh-CN");
}

function statusText(status) {
  return {
    unsubscribed: "未购买",
    pending: "历史待审核",
    active: "已开通",
    disabled: "已停用",
  }[status] || status || "未知";
}

function profileStorageKey(kind) {
  return state.me ? `xui-manager:${kind}:${state.me.id}` : `xui-manager:${kind}:guest`;
}

function profileInitial() {
  const email = state.me?.email || "";
  return (email.trim()[0] || "登").toUpperCase();
}

function loadProfilePrefs() {
  const defaults = { expireReminder: true, trafficReminder: true, autoRenew: false };
  if (!state.me) {
    state.profilePrefs = defaults;
    state.profileAvatar = "";
    return;
  }
  try {
    state.profilePrefs = { ...defaults, ...JSON.parse(localStorage.getItem(profileStorageKey("prefs")) || "{}") };
  } catch {
    state.profilePrefs = defaults;
  }
  state.profileAvatar = localStorage.getItem(profileStorageKey("avatar")) || "";
}

function saveProfilePrefs() {
  if (!state.me) return;
  localStorage.setItem(profileStorageKey("prefs"), JSON.stringify(state.profilePrefs));
}

function setAvatarNode(node, size = "") {
  if (!node) return;
  node.classList.toggle("small", size === "small");
  node.classList.toggle("large", size === "large");
  node.classList.toggle("has-image", Boolean(state.profileAvatar));
  node.style.backgroundImage = state.profileAvatar ? `url("${state.profileAvatar}")` : "";
  node.textContent = state.profileAvatar ? "" : profileInitial();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("头像读取失败")));
    reader.readAsDataURL(file);
  });
}

function provisioningSummary(summary) {
  if (!summary) return "";
  const parts = [];
  if ("provisioned" in summary) parts.push(`开通 ${summary.provisioned || 0}`);
  if ("failed" in summary) parts.push(`失败 ${summary.failed || 0}`);
  if ("pending" in summary) parts.push(`待处理 ${summary.pending || 0}`);
  if ("missing" in summary) parts.push(`缺失 ${summary.missing || 0}`);
  if ("extra" in summary) parts.push(`多余 ${summary.extra || 0}`);
  if ("fixed" in summary) parts.push(`修复 ${summary.fixed || 0}`);
  return parts.join("，") || "无变更";
}

function provisioningErrorSummary(errors) {
  if (!errors?.length) return "";
  return errors
    .map((item) => `${item.panel_name || `面板 ${item.panel_id}`} / 入站 ${item.inbound_id}: ${item.error || "操作失败"}`)
    .join("；");
}

function provisioningNotice(prefix, summary, errors) {
  const details = provisioningErrorSummary(errors);
  return `${prefix}：${provisioningSummary(summary)}${details ? `；失败详情：${details}` : ""}`;
}

function showNotice(message) {
  const box = $("#notice");
  box.textContent = message;
  box.classList.remove("hidden");
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => box.classList.add("hidden"), message.length > 60 ? 9000 : 3200);
}

async function copyTextFromInput(input) {
  const value = input.value || "";
  if (!value) throw new Error("当前还没有可复制的订阅链接");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  input.focus();
  input.select();
  input.setSelectionRange?.(0, value.length);
  const copied = document.execCommand("copy");
  if (!copied) throw new Error("复制失败，请手动选择订阅链接复制");
}

function subscriptionUrlForFormat(format) {
  const urls = state.me?.subscription_urls || {};
  if (format === "clash") return urls.clash || state.me?.subscription_url || "";
  if (format === "base64") return urls.base64 || "";
  if (format === "singbox") return urls.singbox || "";
  return state.me?.subscription_url || urls.clash || "";
}

const importClients = {
  "clash-verge": {
    format: "clash",
    label: "Clash Verge",
    build: (url) => "clash://install-config?url=" + encodeURIComponent(url),
  },
  mihomo: {
    format: "clash",
    label: "Mihomo",
    build: (url) => "clash://install-config?url=" + encodeURIComponent(url),
  },
  clash: {
    format: "clash",
    label: "Clash",
    build: (url) => "clash://install-config?url=" + encodeURIComponent(url),
  },
  shadowrocket: {
    format: "base64",
    label: "Shadowrocket",
    build: (url) => "shadowrocket://add/sub://" + encodeURIComponent(url),
  },
  singbox: {
    format: "singbox",
    label: "sing-box",
    build: (url) => "sing-box://import-remote-profile?url=" + encodeURIComponent(url),
    copyFallback: true,
  },
  v2rayng: {
    format: "base64",
    label: "v2rayNG",
    build: (url) => "v2rayng://install-config?url=" + encodeURIComponent(url),
    copyFallback: true,
  },
  hiddify: {
    format: "base64",
    label: "Hiddify",
    build: (url) => "hiddify://import/" + encodeURIComponent(url),
    copyFallback: true,
  },
};

function subscriptionUrlForClient(client) {
  const config = importClients[client];
  if (!config) return "";
  return (
    subscriptionUrlForFormat(config.format) ||
    subscriptionUrlForFormat("clash") ||
    subscriptionUrlForFormat("base64") ||
    subscriptionUrlForFormat("singbox")
  );
}

function importUrlForClient(client) {
  const config = importClients[client];
  const url = subscriptionUrlForClient(client);
  return config && url ? config.build(url) : "";
}

function renderImportButtons() {
  const active = Boolean(state.me && state.me.status === "active");
  $$('[data-import-client]').forEach((button) => {
    button.disabled = !active || !subscriptionUrlForClient(button.dataset.importClient);
  });
}

async function copySubscriptionUrl(url) {
  if (!url) throw new Error("当前还没有可复制的订阅链接");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }
  const helper = $("#subscriptionUrl") || $("#profileSubscriptionUrl");
  if (!helper) throw new Error("复制失败，请手动复制订阅链接");
  const previous = helper.value;
  helper.value = url;
  try {
    await copyTextFromInput(helper);
  } finally {
    helper.value = previous;
  }
}

async function launchImport(client) {
  if (!state.me) {
    openAuth("login");
    return;
  }
  if (state.me.status !== "active") throw new Error("订阅开通后才能一键导入客户端");

  const config = importClients[client];
  const rawUrl = subscriptionUrlForClient(client);
  const targetUrl = importUrlForClient(client);
  if (!config || !rawUrl || !targetUrl) throw new Error("当前还没有可导入的订阅链接");

  if (config.copyFallback) await copySubscriptionUrl(rawUrl);
  window.location.href = targetUrl;
  showNotice(config.copyFallback ? "已复制订阅链接，并尝试打开 " + config.label : "正在打开 " + config.label);
}

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason?.message || String(reason || "请求失败");
  showNotice(message);
  event.preventDefault();
});

async function withSubmitState(event, action) {
  event.preventDefault();
  return withFormState(event.currentTarget, action);
}

async function withFormState(form, action) {
  if (form.dataset.submitting === "true") return;
  const button = form.querySelector("button[type=submit]");
  const originalText = button?.textContent || "";
  form.dataset.submitting = "true";
  if (button) {
    button.disabled = true;
    button.textContent = "处理中…";
  }
  try {
    await action(form);
  } catch (error) {
    showNotice(error?.message || "操作失败");
  } finally {
    delete form.dataset.submitting;
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function handleDynamicSubmit(event) {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  if (!form) return;
  if (form.matches("[data-user-balance-form]")) {
    event.preventDefault();
    await withFormState(form, async () => {
      await api("/api/admin/users/balance", {
        method: "POST",
        body: JSON.stringify({ ...formData(form), user_id: form.dataset.userBalanceForm }),
        loadingLabel: "正在调整用户余额",
      });
      await refreshAdmin();
      showNotice("用户余额已更新");
    });
  }
  if (form.matches("[data-user-note-form]")) {
    event.preventDefault();
    await withFormState(form, async () => {
      await api("/api/admin/users/note", {
        method: "POST",
        body: JSON.stringify({ ...formData(form), user_id: form.dataset.userNoteForm }),
        loadingLabel: "正在保存用户备注",
      });
      await refreshAdmin();
      showNotice("用户备注已保存");
    });
  }
}

function setView(view) {
  if (["account", "profile"].includes(view) && !state.me) {
    openAuth("login");
    return;
  }
  if (["admin", "nodes", "settings"].includes(view) && state.me?.role !== "admin") {
    view = "home";
  }
  state.view = view;
  $$('[data-view]').forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  $$(".view").forEach((node) => node.classList.add("hidden"));
  const target = $(`#${view}View`);
  if (target) target.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function refreshPublic() {
  const data = await api("/api/plans", { loadingLabel: "正在读取套餐" });
  state.plans = data.plans || [];
  renderPlanCatalog();
}

async function refreshMe() {
  const data = await api("/api/me", { loadingLabel: "正在读取账号" });
  state.me = data.user;
  if (state.me?.role === "user") await refreshBalanceTransactions();
  renderAuth();
  if (state.me?.role === "admin") await refreshAdmin();
}

async function refreshAdmin() {
  const [users, plans, panels, nodes, settings, rechargeCards] = await Promise.all([
    api("/api/admin/users", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/plans", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/panels", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/nodes", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/settings", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/recharge-cards", { loadingLabel: "正在读取后台数据" }),
  ]);
  state.users = users.users || [];
  state.plans = plans.plans || state.plans;
  state.panels = panels.panels || [];
  state.nodes = nodes.nodes || [];
  state.settings = settings.settings || {};
  state.rechargeCards = rechargeCards.cards || [];
  renderAdmin();
  renderPlanCatalog();
}

async function refreshBalanceTransactions() {
  const data = await api("/api/balance/transactions", { loadingLabel: "正在读取余额记录" });
  state.transactions = data.transactions || [];
}

function renderAuth() {
  const loggedIn = Boolean(state.me);
  const isAdmin = state.me?.role === "admin";
  loadProfilePrefs();
  $("#sessionEmail").textContent = loggedIn ? state.me.email : "游客";
  $("#loginBtn").classList.toggle("hidden", loggedIn);
  $("#registerBtn").classList.toggle("hidden", loggedIn);
  $("#refreshBtn").classList.toggle("hidden", !loggedIn);
  $("#logoutBtn").classList.toggle("hidden", !loggedIn);
  $$(".admin-only").forEach((node) => node.classList.toggle("hidden", !isAdmin));
  $$(".user-only").forEach((node) => node.classList.toggle("hidden", !loggedIn || isAdmin));
  const mobileAccount = $("#mobileAccountBtn");
  const mobileAccountLabel = $("#mobileAccountLabel");
  mobileAccountLabel.textContent = loggedIn ? "个人中心" : "登录";
  mobileAccount.setAttribute("aria-label", loggedIn ? `个人中心：${state.me.email}` : "登录账号");
  $("#profileEntryLabel").textContent = loggedIn ? `个人中心：${state.me.email}` : "登录账号";
  $("#profileEntryBtn").setAttribute("aria-label", loggedIn ? `个人中心：${state.me.email}` : "登录账号");
  setAvatarNode($("#profileEntryAvatar"));
  setAvatarNode($("#mobileAvatar"), "small");
  setAvatarNode($("#profileHeroAvatar"), "large");
  if (!loggedIn) {
    renderProfile();
    renderImportButtons();
    renderPlanCatalog();
    return;
  }

  const statusMessages = {
    unsubscribed: "尚未购买套餐，可充值余额后在商城即时开通。",
    pending: "该账号来自旧版审核流程，可直接购买新套餐。",
    active: "账号已开通，可按客户端复制对应订阅链接。",
    disabled: "账号已停用，如有疑问请联系管理员。",
  };
  $("#accountStatus").textContent = statusMessages[state.me.status] || "账号状态未知。";
  $("#quotaText").textContent = formatBytes(state.me.quota_bytes);
  $("#usedText").textContent = formatBytes(state.me.used_bytes);
  $("#remainText").textContent = formatBytes(state.me.remaining_bytes);
  $("#expireText").textContent = toDate(state.me.expire_at);
  $("#balanceText").textContent = formatMoney(state.me.balance_cents);
  const clashSubscriptionUrl = subscriptionUrlForFormat("clash");
  $("#subscriptionUrl").value = clashSubscriptionUrl;
  $("#base64SubscriptionUrl").value = subscriptionUrlForFormat("base64");
  $("#singboxSubscriptionUrl").value = subscriptionUrlForFormat("singbox");
  $("#copySubBtn").disabled = state.me.status !== "active" || !clashSubscriptionUrl;
  renderTransactions();
  renderProfile();
  renderImportButtons();
  renderPlanCatalog();
}

function renderProfile() {
  const loggedIn = Boolean(state.me);
  $("#profileHeroSummary").textContent = loggedIn
    ? `${state.me.email} · ${state.me.role === "admin" ? "管理员" : statusText(state.me.status)}`
    : "登录后管理账号资料与订阅偏好。";
  $("#profileEmail").textContent = loggedIn ? state.me.email : "-";
  $("#profileCreatedAt").textContent = loggedIn ? toDateTime(state.me.created_at) : "-";
  $("#profileGiftCardBalance").textContent = loggedIn ? formatMoney(state.me.balance_cents) : "¥0.00";
  $("#expireReminderToggle").checked = Boolean(state.profilePrefs.expireReminder);
  $("#trafficReminderToggle").checked = Boolean(state.profilePrefs.trafficReminder);
  $("#autoRenewToggle").checked = Boolean(state.profilePrefs.autoRenew);
  const subscriptionUrl = subscriptionUrlForFormat("clash");
  const plan = state.plans.find((item) => Number(item.id) === Number(state.me?.plan_id));
  $("#profileSubscriptionInfo").textContent = loggedIn
    ? `${plan?.name || "当前未选择套餐"} · ${formatBytes(state.me.quota_bytes)} 总量`
    : "登录后展示订阅信息。";
  $("#profileSubStatus").textContent = loggedIn ? statusText(state.me.status) : "-";
  $("#profileSubExpire").textContent = loggedIn ? toDate(state.me.expire_at) : "-";
  $("#profileSubRemain").textContent = loggedIn ? formatBytes(state.me.remaining_bytes) : "-";
  $("#profileSubscriptionUrl").value = subscriptionUrl;
  $$("[data-copy-profile-sub]").forEach((button) => {
    button.disabled = !subscriptionUrl || state.me?.status !== "active";
  });
  renderImportButtons();
  setAvatarNode($("#profileEntryAvatar"));
  setAvatarNode($("#mobileAvatar"), "small");
  setAvatarNode($("#profileHeroAvatar"), "large");
}

function renderTransactions() {
  const target = $("#balanceTransactions");
  if (!target) return;
  target.innerHTML = state.transactions.length
    ? state.transactions.slice(0, 8).map((item) => `<div class="transaction-item"><span><strong>${escapeHtml(item.note || item.kind)}</strong><small>${new Date(item.created_at * 1000).toLocaleString("zh-CN")}</small></span><b class="${item.amount_cents >= 0 ? "credit" : "debit"}">${item.amount_cents >= 0 ? "+" : ""}${formatMoney(item.amount_cents)}</b></div>`).join("")
    : '<span class="meta">暂无余额记录</span>';
}

function planAction(plan) {
  if (!state.me) return { label: "登录购买", disabled: false };
  if (state.me.role === "admin") return { label: "管理员不可购买", disabled: true };
  if (state.me.status === "disabled") return { label: "账号已停用", disabled: true };
  if (Number(state.me.balance_cents || 0) < Number(plan.price_cents || 0)) return { label: "余额不足", disabled: true };
  if (state.me.status === "active") return { label: "续费 / 更换", disabled: false };
  return { label: "余额购买", disabled: false };
}

function renderPlanCatalog() {
  const catalog = $("#planCatalog");
  if (!catalog) return;
  if (!state.plans.length) {
    catalog.innerHTML = '<div class="empty-state">当前暂无可申请套餐，请稍后再来。</div>';
    return;
  }
  catalog.innerHTML = state.plans
    .filter((plan) => plan.enabled !== false)
    .map((plan, index) => {
      const action = planAction(plan);
      return `<article class="plan-card">
        <div>
          <span class="plan-index">PLAN ${String(index + 1).padStart(2, "0")}</span>
          <h3>${escapeHtml(plan.name)}</h3>
          <p class="plan-price">${formatMoney(plan.price_cents)}</p>
          <p class="plan-quota">${escapeHtml(formatBytes(plan.quota_bytes))}</p>
          <div class="plan-meta">
            <span>${plan.duration_days} 天有效</span>
            <span>余额即时开通</span>
          </div>
        </div>
        <button type="button" data-apply-plan="${plan.id}" ${action.disabled ? "disabled" : ""}>${action.label}</button>
      </article>`;
    })
    .join("");
}

function renderAdmin() {
  renderUsers();
  renderPlans();
  renderPanels();
  renderNodes();
  renderRechargeCards();
  renderUsageOptions();
  renderSettings();
}

function userActionButtons(user) {
  if (user.role === "admin") return '<span class="meta">系统管理员</span>';
  const plannedActions = user.plan_id
    ? `<button class="ghost" data-retry-provision="${user.id}">重试开通</button>
       <button class="ghost" data-reconcile-user="${user.id}">对账</button>`
    : "";
  const lifecycle = user.status === "disabled"
    ? `<button data-status="${user.id}" data-value="active">启用</button>
       <button class="danger" data-delete-user="${user.id}" data-user-email="${escapeHtml(user.email)}">永久删除</button>`
    : `<button class="danger" data-status="${user.id}" data-value="disabled">停用</button>`;
  return plannedActions + lifecycle;
}

function filteredUsers() {
  const query = ($("#userSearch")?.value || "").trim().toLowerCase();
  const status = $("#userStatusFilter")?.value || "";
  const role = $("#userRoleFilter")?.value || "";
  const priority = $("#priorityFilter")?.value || "";
  return state.users.filter((user) => {
    const searchable = `${user.email || ""} ${user.admin_note || ""}`.toLowerCase();
    return (!query || searchable.includes(query))
      && (!status || user.status === status)
      && (!role || user.role === role)
      && (!priority || user.is_priority);
  });
}

function userDetail(user) {
  const errorText = provisioningErrorSummary(user.provisioning_errors);
  if (user.role === "admin") return `<div class="user-detail"><p class="meta">系统管理员账号不参与套餐购买和余额运营。</p></div>`;
  return `<div class="user-detail">
    <div class="user-detail-summary">
      <span><small>开通状态</small><strong>${escapeHtml(provisioningSummary(user.provisioning) || "-")}</strong></span>
      <span><small>备注</small><strong>${escapeHtml(user.admin_note || "暂无备注")}</strong></span>
      ${errorText ? `<p class="error-text">${escapeHtml(errorText)}</p>` : ""}
    </div>
    <form class="inline-form" data-user-balance-form="${user.id}">
      <label>余额调整（元）<input name="amount_yuan" type="number" step="0.01" placeholder="增加填正数，扣减填负数" required></label>
      <label>原因<input name="note" maxlength="120" placeholder="充值、补偿或退款" required></label>
      <button type="submit">调整余额</button>
    </form>
    <form class="inline-form note-form" data-user-note-form="${user.id}">
      <label>用户备注<input name="note" maxlength="500" value="${escapeHtml(user.admin_note || "")}" placeholder="记录来源、偏好或跟进信息"></label>
      <label class="check"><input name="is_priority" type="checkbox" ${user.is_priority ? "checked" : ""}>标为重点用户</label>
      <button type="submit" class="ghost">保存备注</button>
    </form>
    <div class="actions">${userActionButtons(user)}</div>
  </div>`;
}

function renderUsers() {
  const users = filteredUsers();
  $("#userResultCount").textContent = `显示 ${users.length} / ${state.users.length} 位用户`;
  const rows = users.map((user) => {
    const plan = state.plans.find((item) => item.id === user.plan_id);
    const expanded = state.expandedUsers.has(Number(user.id));
    return `<tr class="user-row ${user.is_priority ? "priority-user" : ""}">
      <td><strong>${user.is_priority ? "★ " : ""}${escapeHtml(user.email)}</strong>${user.admin_note ? `<small class="user-note-preview">${escapeHtml(user.admin_note)}</small>` : ""}</td>
      <td><span class="status ${user.status}">${statusText(user.status)}</span></td>
      <td>${user.role === "admin" ? "管理员" : "普通用户"}</td>
      <td>${escapeHtml(plan?.name || "未选择")}</td>
      <td>${formatMoney(user.balance_cents)}</td>
      <td>${formatBytes(user.used_bytes)} / ${formatBytes(user.quota_bytes)}</td>
      <td>${toDate(user.expire_at)}</td>
      <td><button class="ghost" data-toggle-user="${user.id}" aria-expanded="${expanded}">${expanded ? "收起" : "详情"}</button></td>
    </tr><tr class="user-detail-row ${expanded ? "" : "hidden"}"><td colspan="8">${userDetail(user)}</td></tr>`;
  }).join("");
  $("#userRows").innerHTML = rows;
  $("#userCardList").innerHTML = users.map((user) => {
    const plan = state.plans.find((item) => item.id === user.plan_id);
    const expanded = state.expandedUsers.has(Number(user.id));
    return `<article class="user-card ${user.is_priority ? "priority-user" : ""}">
      <header><h3>${user.is_priority ? "★ " : ""}${escapeHtml(user.email)}</h3><span class="status ${user.status}">${statusText(user.status)}</span></header>
      <div class="user-card-meta"><span>${escapeHtml(plan?.name || "未选择套餐")}</span><span>${formatMoney(user.balance_cents)}</span><span>${formatBytes(user.used_bytes)} / ${formatBytes(user.quota_bytes)}</span></div>
      <button class="ghost" data-toggle-user="${user.id}" aria-expanded="${expanded}">${expanded ? "收起详情" : "展开详情"}</button>
      ${expanded ? userDetail(user) : ""}
    </article>`;
  }).join("");
}

function renderPlans() {
  $("#planList").innerHTML = state.plans
    .map((plan) => `<article class="row-card">
      <header><strong>${escapeHtml(plan.name)}</strong><span class="row-actions"><button data-edit-plan="${plan.id}" class="ghost">编辑</button><button data-delete-plan="${plan.id}" class="danger">删除</button></span></header>
      <span class="meta">${formatMoney(plan.price_cents)} / ${formatBytes(plan.quota_bytes)} / ${plan.duration_days} 天 / 标签：${escapeHtml((plan.allowed_tags || []).join(",") || "全部")}</span>
    </article>`)
    .join("");
}

function renderRechargeCards() {
  const target = $("#rechargeCardList");
  if (!target) return;
  target.innerHTML = state.rechargeCards.length
    ? state.rechargeCards.map((card) => `<article class="row-card"><header><strong>${escapeHtml(card.masked_code)}</strong><span class="status ${card.status === "used" ? "disabled" : "active"}">${card.status === "used" ? "已使用" : "未使用"}</span></header><span class="meta">${formatMoney(card.amount_cents)}${card.redeemed_by_email ? ` / ${escapeHtml(card.redeemed_by_email)}` : ""} / ${new Date(card.created_at * 1000).toLocaleString("zh-CN")}</span></article>`).join("")
    : '<div class="empty-state">尚未生成充值卡</div>';
}

function renderPanels() {
  $("#panelList").innerHTML = state.panels
    .map((panel) => `<article class="row-card">
      <header><strong>${escapeHtml(panel.name)}</strong><span class="row-actions"><button data-test-panel="${panel.id}" class="ghost">测试</button><button data-fetch-inbounds="${panel.id}" class="ghost">入站</button><button data-edit-panel="${panel.id}" class="ghost">编辑</button><button data-delete-panel="${panel.id}" class="danger">删除</button></span></header>
      <span class="meta">${escapeHtml(panel.base_url)}${panel.has_password ? " / 已保存密码" : " / 未保存密码"}</span>
    </article>`)
    .join("");
  $("#nodePanel").innerHTML = '<option value="">不绑定</option>' + state.panels.map((panel) => `<option value="${panel.id}">${escapeHtml(panel.name)}</option>`).join("");
}

function renderNodes() {
  $("#nodeList").innerHTML = state.nodes
    .map((node) => `<article class="row-card">
      <header><strong>${escapeHtml(node.name)}</strong><span class="row-actions"><button data-edit-node="${node.id}" class="ghost">编辑</button><button data-delete-node="${node.id}" class="danger">删除</button></span></header>
      <span class="meta">${node.mode === "managed" ? "托管" : "静态"} / 入站 ${node.inbound_id || 0} / 倍率 ${node.rate} / 标签：${escapeHtml((node.tags || []).join(",") || "无")}</span>
      <span class="meta">${escapeHtml(String(node.source_url || "").slice(0, 150))}</span>
    </article>`)
    .join("");
}

function renderSettings() {
  const form = $("#settingsForm");
  if (!form) return;
  form.elements.sync_interval_seconds.value = state.settings.sync_interval_seconds || "300";
  form.elements.subscription_title.value = state.settings.subscription_title || "";
}

function renderInboundOptions(inbounds) {
  state.inbounds = inbounds || [];
  $("#inboundOptions").innerHTML = state.inbounds
    .map((item) => `<option value="${item.id}" label="${escapeHtml(`${item.remark || "入站"} / ${item.protocol || "-"} / ${item.port || "-"}`)}"></option>`)
    .join("");
}

function renderUsageOptions() {
  $("#usageUser").innerHTML = state.users.filter((user) => user.role !== "admin").map((user) => `<option value="${user.id}">${escapeHtml(user.email)}</option>`).join("");
  $("#usageNode").innerHTML = state.nodes.map((node) => `<option value="${node.id}">${escapeHtml(node.name)}</option>`).join("");
}

function fillForm(form, data) {
  Object.entries(data || {}).forEach(([key, value]) => {
    const input = form.elements[key];
    if (!input) return;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (Array.isArray(value)) input.value = value.join(",");
    else if (key === "quota_bytes") input.value = Number(value || 0) / 1024 ** 3;
    else input.value = value ?? "";
  });
}

function setFormMode(form, title, submit, label, data) {
  form.reset();
  fillForm(form, data);
  form.dataset.mode = "edit";
  title.textContent = `编辑${label}：${data.name}`;
  submit.textContent = "保存修改";
}

function resetFormMode(form, title, submit, label, submitText) {
  form.reset();
  form.elements.id.value = "";
  form.dataset.mode = "create";
  title.textContent = `新建${label}`;
  submit.textContent = submitText;
}

function resetPlanForm() {
  resetFormMode($("#planForm"), $("#planFormTitle"), $("#planSubmitBtn"), "套餐", "保存套餐");
  $("#planForm").elements.enabled.checked = true;
}

function resetPanelForm() {
  resetFormMode($("#panelForm"), $("#panelFormTitle"), $("#panelSubmitBtn"), " X-UI 面板", "保存面板");
  $("#panelPasswordHelp").textContent = "新建面板时请填写密码；编辑已有面板时留空保留已保存密码。";
}

function resetNodeForm() {
  $("#nodeForm").reset();
  $("#nodeForm").elements.enabled.checked = true;
  $("#nodeForm").elements.rate.value = "1";
  $("#nodeForm").elements.inbound_id.value = "0";
  $("#nodeForm").elements.mode.value = "managed";
}

async function fetchInboundsForPanel(panelId) {
  if (!panelId) throw new Error("请先选择 X-UI 面板");
  const data = await api("/api/admin/panels/inbounds", {
    method: "POST",
    body: JSON.stringify({ panel_id: panelId }),
    loadingLabel: "正在拉取入站",
  });
  renderInboundOptions(data.inbounds || []);
  if (state.inbounds.length === 1) $("#nodeForm").elements.inbound_id.value = state.inbounds[0].id;
  return state.inbounds.length;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showAuthTab(tab) {
  $$('[data-auth-tab]').forEach((button) => {
    const active = button.dataset.authTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$('[data-auth-panel]').forEach((panel) => panel.classList.toggle("hidden", panel.dataset.authPanel !== tab));
  window.setTimeout(() => $(`[data-auth-panel="${tab}"] input`)?.focus(), 0);
}

function openModalDialog(dialog) {
  if (!dialog) return;
  if (dialog.open) return;
  dialog.classList.remove("dialog-fallback-open");
  if (typeof dialog.showModal === "function") {
    try {
      if (!dialog.open) dialog.showModal();
      return;
    } catch (_) {
      // Some mobile WebViews expose showModal but reject it; fall back to an open dialog.
    }
  }
  dialog.setAttribute("open", "");
  dialog.classList.add("dialog-fallback-open");
}

function closeModalDialog(dialog) {
  if (!dialog) return;
  dialog.classList.remove("dialog-fallback-open");
  if (typeof dialog.close === "function") {
    try {
      if (dialog.open) dialog.close();
      return;
    } catch (_) {
      // Fall through to attribute cleanup for non-native dialog implementations.
    }
  }
  dialog.removeAttribute("open");
}

function openAuth(tab = "login") {
  if (state.me) {
    setView(state.me.role === "admin" ? "admin" : "account");
    return;
  }
  state.authReturnFocus = document.activeElement;
  showAuthTab(tab);
  $("#authContext").textContent = state.pendingPlanId ? "登录或注册后，将继续购买所选套餐。" : "登录后继续管理你的订阅。";
  const dialog = $("#authDialog");
  openModalDialog(dialog);
}

function closeAuth(discardPending = false) {
  const dialog = $("#authDialog");
  closeModalDialog(dialog);
  if (discardPending) state.pendingPlanId = null;
  state.authReturnFocus?.focus?.();
  state.authReturnFocus = null;
}

async function requestPurchase(planId) {
  state.pendingPlanId = Number(planId);
  if (!state.me) {
    openAuth("login");
    return;
  }
  await submitPurchase();
}

async function submitPurchase() {
  if (!state.pendingPlanId) return;
  const plan = state.plans.find((item) => Number(item.id) === Number(state.pendingPlanId));
  if (!plan) throw new Error("套餐不存在");
  if (!window.confirm(`确认使用余额 ${formatMoney(plan.price_cents)} 购买「${plan.name}」吗？购买后立即生效。`)) {
    state.pendingPlanId = null;
    return;
  }
  const data = await api("/api/purchases", {
    method: "POST",
    body: JSON.stringify({ plan_id: state.pendingPlanId }),
    loadingLabel: "正在购买并开通套餐",
  });
  state.pendingPlanId = null;
  state.me = data.user;
  await refreshBalanceTransactions();
  renderAuth();
  closeAuth(false);
  setView("account");
  showNotice(provisioningNotice("套餐购买成功", data.provisioning, data.errors));
}

async function finishAuthentication(user) {
  state.me = user;
  renderAuth();
  if (state.me?.role === "admin") await refreshAdmin();
  closeAuth(false);
  if (state.pendingPlanId && state.me?.role === "user") await submitPurchase();
  else setView(state.me?.role === "admin" ? "admin" : "account");
}

async function handleDocumentClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const viewButton = target.closest("[data-view]");
  if (viewButton) {
    setView(viewButton.dataset.view);
    return;
  }
  const authButton = target.closest("[data-open-auth]");
  if (authButton) {
    openAuth(authButton.dataset.openAuth);
    return;
  }
  if (target.closest("[data-close-auth]")) {
    closeAuth(true);
    return;
  }
  const authTab = target.closest("[data-auth-tab]");
  if (authTab) {
    showAuthTab(authTab.dataset.authTab);
    return;
  }
  const passwordToggle = target.closest("[data-toggle-password]");
  if (passwordToggle) {
    const input = passwordToggle.parentElement.querySelector("input");
    input.type = input.type === "password" ? "text" : "password";
    passwordToggle.textContent = input.type === "password" ? "显示" : "隐藏";
    return;
  }
  if (target.closest("[data-scroll-plans]")) {
    setView("storefront");
    window.setTimeout(() => $("#plansSection")?.scrollIntoView({ behavior: "smooth" }), 0);
    return;
  }
  const applyButton = target.closest("[data-apply-plan]");
  if (applyButton) {
    await requestPurchase(applyButton.dataset.applyPlan);
    return;
  }

  const importButton = target.closest("[data-import-client]");
  if (importButton) {
    await launchImport(importButton.dataset.importClient);
    return;
  }

  const copySubscription = target.closest("[data-copy-sub]");
  if (copySubscription) {
    await copyTextFromInput($(`[data-sub-format="${copySubscription.dataset.copySub}"]`));
    showNotice("订阅链接已复制");
    return;
  }
  if (target.closest("[data-copy-profile-sub]")) {
    await copyTextFromInput($("#profileSubscriptionUrl"));
    showNotice("订阅链接已复制");
    return;
  }

  const closeDialog = target.closest("[data-close-dialog]");
  if (closeDialog) {
    $("#" + closeDialog.dataset.closeDialog)?.close();
    return;
  }

  const action = target.closest("button");
  if (!action) return;
  if (action.dataset.toggleUser) {
    const id = Number(action.dataset.toggleUser);
    if (state.expandedUsers.has(id)) state.expandedUsers.delete(id);
    else state.expandedUsers.add(id);
    renderUsers();
    return;
  }
  if (action.dataset.approve) {
    const result = await api("/api/admin/users/approve", { method: "POST", body: JSON.stringify({ user_id: action.dataset.approve }), loadingLabel: "正在审核用户" });
    await refreshAdmin();
    showNotice(provisioningNotice("用户已通过", result.provisioning, result.errors));
  }
  if (action.dataset.retryProvision) {
    const result = await api("/api/admin/users/provision/retry", { method: "POST", body: JSON.stringify({ user_id: action.dataset.retryProvision }), loadingLabel: "正在重试开通" });
    await refreshAdmin();
    showNotice(provisioningNotice("重试完成", result.provisioning, result.errors));
  }
  if (action.dataset.reconcileUser) {
    const result = await api("/api/admin/users/reconcile", { method: "POST", body: JSON.stringify({ user_id: action.dataset.reconcileUser, apply: true }), loadingLabel: "正在对账" });
    await refreshAdmin();
    showNotice(provisioningNotice("对账完成", result.reconcile, result.errors));
  }
  if (action.dataset.status) {
    await api("/api/admin/users/status", { method: "POST", body: JSON.stringify({ user_id: action.dataset.status, status: action.dataset.value }), loadingLabel: "正在更新用户状态" });
    await refreshAdmin();
    showNotice("用户状态已更新");
  }
  if (action.dataset.deleteUser) {
    const email = action.dataset.userEmail || "该用户";
    if (!window.confirm(`确定永久删除 ${email} 吗？系统会先清理全部 X-UI 客户端，此操作不可恢复。`)) return;
    await api("/api/admin/users/delete", { method: "POST", body: JSON.stringify({ user_id: action.dataset.deleteUser }), loadingLabel: "正在清理用户与节点" });
    await refreshAdmin();
    showNotice("用户及其 X-UI 客户端已删除");
  }
  if (action.dataset.deletePlan) {
    if (!window.confirm("确定删除这个套餐吗？")) return;
    await api("/api/admin/plans/delete", { method: "POST", body: JSON.stringify({ id: action.dataset.deletePlan }) });
    await refreshAdmin();
    showNotice("套餐已删除");
  }
  if (action.dataset.deletePanel) {
    if (!window.confirm("确定删除这个面板吗？")) return;
    await api("/api/admin/panels/delete", { method: "POST", body: JSON.stringify({ id: action.dataset.deletePanel }) });
    await refreshAdmin();
    showNotice("面板已删除");
  }
  if (action.dataset.deleteNode) {
    if (!window.confirm("确定删除这个节点吗？")) return;
    await api("/api/admin/nodes/delete", { method: "POST", body: JSON.stringify({ id: action.dataset.deleteNode }) });
    await refreshAdmin();
    showNotice("节点已删除");
  }
  if (action.dataset.testPanel) {
    const result = await api("/api/admin/panels/test", { method: "POST", body: JSON.stringify({ panel_id: action.dataset.testPanel }), loadingLabel: "正在测试面板" });
    showNotice(`面板连接正常：${result.inbound_count || 0} 个入站`);
  }
  if (action.dataset.fetchInbounds) {
    const panelId = action.dataset.fetchInbounds === "selected" ? $("#nodePanel").value : action.dataset.fetchInbounds;
    if (action.dataset.fetchInbounds !== "selected") {
      $("#nodePanel").value = panelId;
      setView("nodes");
    }
    const count = await fetchInboundsForPanel(panelId);
    showNotice(`已拉取 ${count} 个入站`);
  }
  if (action.dataset.editPlan) {
    const plan = state.plans.find((item) => String(item.id) === action.dataset.editPlan);
    setFormMode($("#planForm"), $("#planFormTitle"), $("#planSubmitBtn"), "套餐", { ...plan, price_yuan: priceYuan(plan), quota_gb: quotaGb(plan), allowed_tags: plan.allowed_tags || [] });
    $("#planDialog").showModal();
  }
  if (action.dataset.editPanel) {
    const panel = state.panels.find((item) => String(item.id) === action.dataset.editPanel);
    setFormMode($("#panelForm"), $("#panelFormTitle"), $("#panelSubmitBtn"), " X-UI 面板", panel);
    $("#panelPasswordHelp").textContent = panel.has_password ? "已保存密码；留空会继续使用原密码，填写新密码才会替换。" : "当前没有保存密码，请填写新密码。";
    $("#panelDialog").showModal();
  }
  if (action.dataset.editNode) {
    fillForm($("#nodeForm"), state.nodes.find((item) => String(item.id) === action.dataset.editNode));
    setView("nodes");
  }
}

async function handleDocumentChange(event) {
  const target = event.target instanceof HTMLInputElement ? event.target : null;
  if (!target) return;
  if (target.matches("[data-profile-setting]")) {
    state.profilePrefs[target.dataset.profileSetting] = target.checked;
    saveProfilePrefs();
    showNotice("个人中心设置已保存");
    return;
  }
  if (target.id === "profileAvatarInput") {
    const file = target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) throw new Error("请选择图片文件作为头像");
    if (file.size > 1024 * 1024) throw new Error("头像图片不能超过 1MB");
    state.profileAvatar = String(await readFileAsDataUrl(file));
    localStorage.setItem(profileStorageKey("avatar"), state.profileAvatar);
    renderProfile();
    showNotice("头像已更新");
    target.value = "";
  }
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    handleDocumentClick(event).catch((error) => showNotice(error?.message || "操作失败"));
  });
  document.addEventListener("change", (event) => {
    handleDocumentChange(event).catch((error) => showNotice(error?.message || "操作失败"));
  });
  document.addEventListener("submit", (event) => {
    handleDynamicSubmit(event).catch((error) => showNotice(error?.message || "操作失败"));
  });
  $("#authDialog").addEventListener("cancel", () => {
    state.pendingPlanId = null;
  });
  $("#mobileAccountBtn").addEventListener("click", () => {
    if (state.me) setView("profile");
    else openAuth("login");
  });
  $("#refreshBtn").addEventListener("click", async () => {
    await refreshPublic();
    await refreshMe();
    showNotice("已刷新");
  });
  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    state.me = null;
    state.users = [];
    state.panels = [];
    state.nodes = [];
    state.transactions = [];
    state.pendingPlanId = null;
    state.profileAvatar = "";
    $("#loginForm").reset();
    $("#registerForm").reset();
    setView("home");
    renderAuth();
    showNotice("已退出登录");
  });
  $("#newPlanBtn").addEventListener("click", () => {
    resetPlanForm();
    $("#planDialog").showModal();
  });
  $("#newPanelBtn").addEventListener("click", () => {
    resetPanelForm();
    $("#panelDialog").showModal();
  });
  ["userSearch", "userStatusFilter", "userRoleFilter", "priorityFilter"].forEach((id) => {
    $("#" + id).addEventListener(id === "userSearch" ? "input" : "change", renderUsers);
  });
  $("#toggleUserListBtn").addEventListener("click", (event) => {
    const region = $("#userListRegion");
    const collapsed = region.classList.toggle("collapsed");
    event.currentTarget.textContent = collapsed ? "展开列表" : "折叠列表";
    event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
  });
  $("#syncUsageBtn").addEventListener("click", async () => {
    const result = await api("/api/admin/sync-usage", { method: "POST", body: "{}", loadingLabel: "正在同步 X-UI 用量" });
    await refreshAdmin();
    showNotice(`同步完成：更新 ${result.synced || 0} 条，停用 ${result.disabled || 0} 个客户端${result.errors?.length ? "，有错误请检查面板配置" : ""}`);
  });
  $("#copySubBtn").addEventListener("click", async () => {
    await copyTextFromInput($("#subscriptionUrl"));
    showNotice("订阅链接已复制");
  });

  $("#profilePasswordForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const data = formData(form);
    if (data.new_password !== data.confirm_password) throw new Error("两次输入的新密码不一致");
    const result = await api("/api/me/password", { method: "POST", body: JSON.stringify(data), loadingLabel: "正在修改密码" });
    state.me = result.user;
    form.reset();
    renderAuth();
    showNotice("密码已修改");
  }));

  $("#profileGiftCardForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const data = await api("/api/recharge", { method: "POST", body: JSON.stringify(formData(form)), loadingLabel: "正在兑换礼品卡" });
    state.me = data.user;
    form.reset();
    if (state.me?.role === "user") await refreshBalanceTransactions();
    renderAuth();
    showNotice("礼品卡兑换成功，余额已到账");
  }));

  $("#loginForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const data = await api("/api/login", { method: "POST", body: JSON.stringify(formData(form)), loadingLabel: "正在登录" });
    await finishAuthentication(data.user);
    showNotice("登录成功");
  }));

  $("#rechargeForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const data = await api("/api/recharge", { method: "POST", body: JSON.stringify(formData(form)), loadingLabel: "正在兑换充值卡" });
    state.me = data.user;
    form.reset();
    await refreshBalanceTransactions();
    renderAuth();
    showNotice("充值成功，余额已到账");
  }));

  $("#rechargeCardForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const data = await api("/api/admin/recharge-cards", { method: "POST", body: JSON.stringify(formData(form)), loadingLabel: "正在生成充值卡" });
    const codes = (data.cards || []).map((card) => `${card.code}    ${formatMoney(card.amount_cents)}`);
    $("#generatedCardCodes").textContent = codes.join("\n");
    $("#generatedCardCodes").classList.toggle("hidden", !codes.length);
    await refreshAdmin();
    showNotice(`已生成 ${codes.length} 张充值卡，请立即保存`);
  }));

  $("#registerForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const data = await api("/api/register", { method: "POST", body: JSON.stringify(formData(form)), loadingLabel: "正在创建账号" });
    form.reset();
    await finishAuthentication(data.user);
    showNotice("账号创建成功");
  }));

  $("#planForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const editing = form.dataset.mode === "edit";
    await api("/api/admin/plans", { method: "POST", body: JSON.stringify(formData(form)) });
    $("#planDialog").close();
    resetPlanForm();
    await refreshAdmin();
    showNotice(editing ? "套餐修改已保存" : "新套餐已添加");
  }));

  $("#panelForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const editing = form.dataset.mode === "edit";
    await api("/api/admin/panels", { method: "POST", body: JSON.stringify(formData(form)) });
    $("#panelDialog").close();
    resetPanelForm();
    await refreshAdmin();
    showNotice(editing ? "面板修改已保存" : "新面板已添加");
  }));

  $("#nodeForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    await api("/api/admin/nodes", { method: "POST", body: JSON.stringify(formData(form)) });
    resetNodeForm();
    await refreshAdmin();
    showNotice("节点已保存");
  }));

  $("#settingsForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const data = await api("/api/admin/settings", { method: "POST", body: JSON.stringify(formData(form)) });
    state.settings = data.settings || {};
    renderSettings();
    showNotice("设置已保存");
  }));

  $("#usageForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    await api("/api/admin/usage", { method: "POST", body: JSON.stringify(formData(form)) });
    await refreshAdmin();
    showNotice("用量已保存");
  }));
}

async function boot() {
  bindEvents();
  resetPlanForm();
  resetPanelForm();
  resetNodeForm();
  await refreshPublic();
  await refreshMe();
  setView("storefront");
}

boot().catch((error) => showNotice(error.message));
