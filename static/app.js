const state = {
  me: null,
  plans: [],
  users: [],
  panels: [],
  nodes: [],
  nodeStatuses: [],
  tutorials: [],
  adminTutorials: [],
  rechargeCards: [],
  transactions: [],
  checkin: null,
  checkinSettings: {},
  tickets: [],
  adminTickets: [],
  revealedCards: {},
  expandedUsers: new Set(),
  settings: {},
  inbounds: [],
  view: "home",
  pendingPlanId: null,
  lastPurchase: null,
  loadingCount: 0,
  loadingStartedAt: 0,
  loadingTimer: null,
  elapsedTimer: null,
  authReturnFocus: null,
  profilePrefs: { expireReminder: true, trafficReminder: true },
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

function formatPlanQuota(value) {
  const bytes = Number(value || 0);
  const gb = bytes / 1024 / 1024 / 1024;
  if (!Number.isFinite(gb) || gb <= 0) return "0GB";
  return `${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)}GB`;
}


const DEFAULT_STORE_PLANS = [
  { id: "default-entry", name: "入门套餐", quota_bytes: 30 * 1024 ** 3, duration_days: 30, price_cents: 990, enabled: true, product_type: "subscription", description: "轻量使用，适合偶尔连接。", is_default_plan: true },
  { id: "default-daily", name: "日常套餐", quota_bytes: 100 * 1024 ** 3, duration_days: 30, price_cents: 1990, enabled: true, product_type: "subscription", description: "日常使用，兼顾多设备连接。", is_default_plan: true },
  { id: "default-premium", name: "畅享套餐", quota_bytes: 300 * 1024 ** 3, duration_days: 30, price_cents: 3990, enabled: true, product_type: "subscription", description: "高频使用，流量空间更充足。", is_default_plan: true },
];

function purchasablePlans() {
  const enabledPlans = state.plans.filter((plan) => plan.enabled !== false && (plan.product_type || "subscription") === "subscription");
  return enabledPlans.length ? enabledPlans : DEFAULT_STORE_PLANS;
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

function nodeStatusText(status) {
  return {
    online: "可用",
    offline: "离线",
    degraded: "波动",
    unknown: "未检测",
    maintenance: "维护中",
  }[status] || status || "未检测";
}

function ticketStatusText(status) {
  return {
    open: "处理中",
    pending: "等待反馈",
    closed: "已关闭",
  }[status] || status || "未知";
}

function productTypeLabel(type) {
  return {
    subscription: "套餐 · 流量 + 时长",
    traffic_pack: "流量包 · 不限时长",
    time_pack: "时长包 · 延长有效期",
    reset_pack: "流量重置包",
  }[type] || "套餐 · 流量 + 时长";
}

function productRuleText(plan) {
  const type = plan?.product_type || "subscription";
  const quota = formatBytes(plan?.quota_bytes || 0);
  const days = Number(plan?.duration_days || 0);
  if (type === "traffic_pack") return quota + " 流量包";
  if (type === "time_pack") return days + " 天加时包";
  if (type === "reset_pack") return "重置已用流量";
  return quota + " · " + days + " 天";
}


function planQuotaGb(plan) {
  return Number(plan?.quota_bytes || 0) / 1024 / 1024 / 1024;
}

function planTier(plan, index = 0) {
  if ((plan?.product_type || "subscription") !== "subscription") return null;
  const name = String(plan?.name || "");
  const gb = planQuotaGb(plan);
  if (/入门|轻度|30\s*G/i.test(name) || Math.abs(gb - 30) < 0.5) {
    return { name: "入门套餐", description: "偶尔使用，轻量上网。" };
  }
  if (/日常|中度|100\s*G/i.test(name) || Math.abs(gb - 100) < 0.5) {
    return { name: "日常套餐", description: "日常使用，多设备更省心。" };
  }
  if (/畅享|重度|300\s*G/i.test(name) || Math.abs(gb - 300) < 0.5) {
    return { name: "畅享套餐", description: "高频使用，流量更充足。" };
  }
  return null;
}


function planDisplayName(plan, index = 0) {
  return planTier(plan, index)?.name || plan?.name || "未选择套餐";
}

function planDisplayDescription(plan, index = 0) {
  const custom = String(plan?.description || "").trim();
  if (custom && !/轻度|中度|重度|高速|稳定|节点|购买后|旧套餐/.test(custom)) return custom;
  return planTier(plan, index)?.description || "按需开通，订阅自动更新。";
}


function nodeStatusOptions(current = "unknown") {
  return ["online", "degraded", "offline", "maintenance", "unknown"]
    .map((status) => '<option value="' + status + '" ' + (status === current ? "selected" : "") + '>' + nodeStatusText(status) + '</option>')
    .join("");
}

function formatTags(tags) {
  if (Array.isArray(tags)) return tags.join("、") || "无标签";
  return String(tags || "无标签");
}

function ticketRepliesHtml(ticket) {
  const replies = ticket.replies || [];
  if (!replies.length) return '<div class="meta">暂无回复</div>';
  return replies.map((reply) => '<div class="ticket-reply ' + escapeHtml(reply.role || "") + '"><strong>' + (reply.role === "admin" ? "管理员" : "用户") + '</strong><p>' + escapeHtml(reply.message) + '</p><small>' + toDateTime(reply.created_at) + '</small></div>').join("");
}

function findPendingPlan() {
  return state.plans.find((item) => Number(item.id) === Number(state.pendingPlanId));
}

function profileStorageKey(kind) {
  return state.me ? `xui-manager:${kind}:${state.me.id}` : `xui-manager:${kind}:guest`;
}

function profileInitial() {
  const email = state.me?.email || "";
  return (email.trim()[0] || "登").toUpperCase();
}

function loadProfilePrefs() {
  const defaults = { expireReminder: true, trafficReminder: true };
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
    reader.addEventListener("error", () => reject(new Error("图片读取失败")));
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

async function copyPlainText(text) {
  const value = String(text || "");
  if (!value) throw new Error("当前没有可复制的内容");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const helper = document.createElement("textarea");
  helper.value = value;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.focus();
  helper.select();
  const copied = document.execCommand("copy");
  helper.remove();
  if (!copied) throw new Error("复制失败，请手动选择内容复制");
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
  if (form.matches("[data-node-status-form]")) {
    event.preventDefault();
    await withFormState(form, async () => {
      await api("/api/admin/nodes/status", {
        method: "POST",
        body: JSON.stringify({ ...formData(form), id: form.dataset.nodeStatusForm }),
        loadingLabel: "正在更新节点状态",
      });
      await refreshAdmin();
      await refreshNodeStatuses();
      showNotice("节点状态已更新");
    });
  }
  if (form.matches("[data-admin-ticket-reply-form]")) {
    event.preventDefault();
    await withFormState(form, async () => {
      await api("/api/admin/tickets/reply", {
        method: "POST",
        body: JSON.stringify({ ...formData(form), ticket_id: form.dataset.adminTicketReplyForm }),
        loadingLabel: "正在回复工单",
      });
      form.reset();
      await refreshAdminTickets();
      showNotice("工单已回复");
    });
  }
  if (form.matches("[data-user-ticket-reply-form]")) {
    event.preventDefault();
    await withFormState(form, async () => {
      await api("/api/tickets/reply", {
        method: "POST",
        body: JSON.stringify({ ...formData(form), ticket_id: form.dataset.userTicketReplyForm }),
        loadingLabel: "正在提交回复",
      });
      form.reset();
      await refreshTickets();
      showNotice("工单回复已提交");
    });
  }
}

function setView(view) {
  if (!state.me && view === "home") view = "storefront";
  if (["account", "balance", "profile", "tickets", "checkout"].includes(view) && !state.me) {
    openAuth("login");
    return;
  }
  if (["admin", "nodes", "settings", "rechargeCards"].includes(view) && state.me?.role !== "admin") {
    view = "home";
  }
  state.view = view;
  $$('[data-view]').forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  $$(".view").forEach((node) => node.classList.add("hidden"));
  const target = $(`#${view}View`);
  if (target) target.classList.remove("hidden");
  if (view === "checkout") renderCheckout();
  if (view === "success") renderSuccess();
  if (view === "nodeStatus") renderNodeStatuses();
  if (view === "tickets") {
    renderTickets();
    renderAdminTickets();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function refreshPublic() {
  const [plans, nodeStatuses, tutorials] = await Promise.all([
    api("/api/plans", { loadingLabel: "正在读取套餐" }),
    api("/api/nodes/status", { loadingLabel: "正在读取节点状态" }),
    api("/api/tutorials", { loadingLabel: "正在读取教程" }),
  ]);
  state.plans = plans.plans || [];
  state.nodeStatuses = nodeStatuses.nodes || [];
  state.tutorials = tutorials.tutorials || [];
  renderPlanCatalog();
  renderNodeStatuses();
  renderTutorials();
}

async function refreshMe() {
  const data = await api("/api/me", { loadingLabel: "正在读取账号" });
  state.me = data.user;
  if (state.me?.role === "user") {
    await refreshBalanceTransactions();
    await refreshCheckin();
    await refreshTickets();
  } else {
    state.transactions = [];
    state.checkin = null;
    state.tickets = [];
  }
  renderAuth();
  if (state.me?.role === "admin") await refreshAdmin();
}

async function refreshAdmin() {
  const [users, plans, panels, nodes, settings, rechargeCards, checkinSettings, adminTickets, tutorials] = await Promise.all([
    api("/api/admin/users", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/plans", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/panels", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/nodes", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/settings", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/recharge-cards", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/checkin/settings", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/tickets", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/tutorials", { loadingLabel: "正在读取后台数据" }),
  ]);
  state.users = users.users || [];
  state.plans = plans.plans || state.plans;
  state.panels = panels.panels || [];
  state.nodes = nodes.nodes || [];
  state.settings = settings.settings || {};
  state.rechargeCards = rechargeCards.cards || [];
  state.checkinSettings = checkinSettings.settings || {};
  state.adminTickets = adminTickets.tickets || [];
  state.adminTutorials = tutorials.tutorials || [];
  renderAdmin();
  renderPlanCatalog();
}

async function refreshNodeStatuses() {
  const data = await api("/api/nodes/status", { loadingLabel: "正在读取节点状态" });
  state.nodeStatuses = data.nodes || [];
  renderNodeStatuses();
}

async function refreshCheckin() {
  if (state.me?.role !== "user") return;
  const data = await api("/api/checkin", { loadingLabel: "正在读取签到状态" });
  state.checkin = data.checkin || null;
  renderCheckin();
}

async function refreshTickets() {
  if (state.me?.role !== "user") return;
  const data = await api("/api/tickets", { loadingLabel: "正在读取工单" });
  state.tickets = data.tickets || [];
  renderTickets();
}

async function refreshAdminTickets() {
  if (state.me?.role !== "admin") return;
  const data = await api("/api/admin/tickets", { loadingLabel: "正在读取后台工单" });
  state.adminTickets = data.tickets || [];
  renderAdminTickets();
}

async function refreshBalanceTransactions() {
  const data = await api("/api/balance/transactions", { loadingLabel: "正在读取余额记录" });
  state.transactions = data.transactions || [];
}

function renderAuth() {
  const loggedIn = Boolean(state.me);
  const isAdmin = state.me?.role === "admin";
  document.body.classList.toggle("is-guest", !loggedIn);
  document.body.classList.toggle("is-authed", loggedIn);
  const plansTitle = $("#plansTitle");
  const plansSubtitle = $("#plansSubtitle");
  if (plansTitle) plansTitle.textContent = loggedIn ? "购买套餐" : "先选一个合适的套餐";
  if (plansSubtitle) plansSubtitle.textContent = loggedIn ? "三款套餐均可购买，余额充足后可直接开通。" : "轻度使用、日常上网或高频连接，按流量需求选择即可。";
  loadProfilePrefs();
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
    renderCheckin();
    renderTickets();
    renderAdminTickets();
    renderCheckout();
    renderSuccess();
    return;
  }

  const statusMessages = {
    unsubscribed: "当前未开通套餐，请先充值余额并选择套餐。",
    pending: "账号可用，可选择套餐完成开通。",
    active: "套餐可用，复制对应订阅后导入客户端。",
    disabled: "账号已停用，如有疑问请联系管理员。",
  };
  const currentPlan = state.plans.find((item) => Number(item.id) === Number(state.me?.plan_id));
  const quotaBytes = Number(state.me.quota_bytes || 0);
  const usedBytes = Number(state.me.used_bytes || 0);
  const remainBytes = Number(state.me.remaining_bytes || 0);
  const usagePct = quotaBytes > 0 ? Math.max(0, Math.min(100, usedBytes / quotaBytes * 100)) : 0;
  $("#accountStatus").textContent = statusMessages[state.me.status] || "账号状态未知。";
  $("#dashboardPlanName").textContent = planDisplayName(currentPlan);
  $("#quotaText").textContent = formatBytes(quotaBytes);
  $("#usedText").textContent = formatBytes(usedBytes);
  $("#remainText").textContent = formatBytes(remainBytes);
  $("#expireText").textContent = toDate(state.me.expire_at);
  $("#balanceText").textContent = formatMoney(state.me.balance_cents);
  const trafficMeterBar = $("#trafficMeterBar");
  if (trafficMeterBar) trafficMeterBar.style.width = `${usagePct}%`;
  const clashSubscriptionUrl = subscriptionUrlForFormat("clash");
  $("#subscriptionUrl").value = clashSubscriptionUrl;
  const macosSubscriptionUrl = $("#macosSubscriptionUrl");
  if (macosSubscriptionUrl) macosSubscriptionUrl.value = clashSubscriptionUrl;
  const base64Url = subscriptionUrlForFormat("base64");
  $("#base64SubscriptionUrl").value = base64Url;
  const androidSubscriptionUrl = $("#androidSubscriptionUrl");
  if (androidSubscriptionUrl) androidSubscriptionUrl.value = base64Url;
  $("#singboxSubscriptionUrl").value = subscriptionUrlForFormat("singbox");
  $$("[data-copy-recommended-sub]").forEach((button) => {
    button.disabled = state.me.status !== "active" || !clashSubscriptionUrl;
  });
  renderTransactions();
  renderProfile();
  renderImportButtons();
  renderPlanCatalog();
  renderCheckin();
  renderTickets();
  renderAdminTickets();
  renderCheckout();
  renderSuccess();
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
  const subscriptionUrl = subscriptionUrlForFormat("clash");
  const plan = state.plans.find((item) => Number(item.id) === Number(state.me?.plan_id));
  $("#profileSubscriptionInfo").textContent = loggedIn
    ? `${planDisplayName(plan)} · ${formatBytes(state.me.quota_bytes)} 总量`
    : "登录后展示订阅信息。";
  $("#profileSubStatus").textContent = loggedIn ? statusText(state.me.status) : "-";
  $("#profileSubExpire").textContent = loggedIn ? toDate(state.me.expire_at) : "-";
  $("#profileSubRemain").textContent = loggedIn ? formatBytes(state.me.remaining_bytes) : "-";
  $("#profileSubscriptionUrl").value = subscriptionUrl;
  $$("[data-copy-profile-sub]").forEach((button) => {
    button.disabled = !subscriptionUrl || state.me?.status !== "active";
  });
  renderImportButtons();
  renderCheckin();
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

function planPurchaseAction(plan) {
  if (!state.me) return { label: "选择套餐", disabled: false };
  if (state.me.role === "admin") return { label: "管理员不可购买", disabled: true };
  if (state.me.status === "disabled") return { label: "账号已停用", disabled: true };
  if (plan.is_default_plan) return { label: "请先配置套餐", disabled: true };
  if (Number(state.me.balance_cents || 0) < Number(plan.price_cents || 0)) return { label: "先充值后订阅", disabled: true };
  return { label: "立即购买", disabled: false };
}

function renderPlanCatalog() {
  const catalog = $("#planCatalog");
  if (!catalog) return;
  const plansToRender = purchasablePlans();
  const planNotes = ["适合轻度连接，流量够用不浪费。", "适合日常上网，兼顾手机与电脑。", "适合高频使用，流量空间更充足。"];
  const planDescriptions = {
    "入门套餐": "适合轻度连接，流量够用不浪费。",
    "日常套餐": "适合日常上网，兼顾手机与电脑。",
    "畅享套餐": "适合高频使用，流量空间更充足。",
  };
  catalog.innerHTML = plansToRender
    .map((plan, index) => {
      const action = planPurchaseAction(plan);
      const displayName = planDisplayName(plan);
      const description = planDescriptions[displayName] || planNotes[index] || planDisplayDescription(plan) || "按需选择适合自己的方案。";
      const badge = index === 1 && (plan.product_type || "subscription") === "subscription" ? '<span class="plan-badge">推荐</span>' : '';
      const buttonClass = action.disabled ? "ghost" : "";
      const applyAttr = plan.is_default_plan ? 'data-open-auth="login"' : `data-apply-plan="${plan.id}"`;
      return `<article class="plan-card compact-plan-card product-type-${escapeHtml(plan.product_type || "subscription")}">
        <div class="plan-topline"><div><h3>${escapeHtml(displayName)}</h3></div>${badge}</div>
        <p class="plan-description">${escapeHtml(description)}</p>
        <div class="plan-price">${formatMoney(plan.price_cents)}</div>
        <div class="plan-facts"><span><strong>${escapeHtml(formatPlanQuota(plan.quota_bytes))}</strong><small>可用流量</small></span><span><strong>${escapeHtml(plan.duration_days || 0)}天</strong><small>有效期</small></span></div>
        <button type="button" class="${buttonClass}" ${applyAttr} ${action.disabled ? "disabled" : ""}>${action.label}</button>
      </article>`;
    })
    .join("");
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
      <td>${escapeHtml(plan ? planDisplayName(plan) : "未选择")}</td>
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
      <div class="user-card-meta"><span>${escapeHtml(plan ? planDisplayName(plan) : "未选择套餐")}</span><span>${formatMoney(user.balance_cents)}</span><span>${formatBytes(user.used_bytes)} / ${formatBytes(user.quota_bytes)}</span></div>
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

function renderPanels() {
  $("#panelList").innerHTML = state.panels
    .map((panel) => `<article class="row-card">
      <header><strong>${escapeHtml(panel.name)}</strong><span class="row-actions"><button data-test-panel="${panel.id}" class="ghost">测试</button><button data-fetch-inbounds="${panel.id}" class="ghost">入站</button><button data-edit-panel="${panel.id}" class="ghost">编辑</button><button data-delete-panel="${panel.id}" class="danger">删除</button></span></header>
      <span class="meta">${escapeHtml(panel.base_url)}${panel.has_password ? " / 已保存密码" : " / 未保存密码"}</span>
    </article>`)
    .join("");
  $("#nodePanel").innerHTML = '<option value="">不绑定</option>' + state.panels.map((panel) => `<option value="${panel.id}">${escapeHtml(panel.name)}</option>`).join("");
}

function renderSettings() {
  const form = $("#settingsForm");
  if (!form) return;
  form.elements.sync_interval_seconds.value = state.settings.sync_interval_seconds || "300";
  form.elements.subscription_title.value = state.settings.subscription_title || "";
}

function resetTutorialForm() {
  const form = $("#tutorialForm");
  if (!form) return;
  form.reset();
  form.elements.id.value = "";
  form.elements.enabled.checked = true;
  form.elements.sort_order.value = "0";
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
  $("#planForm").elements.product_type.value = "subscription";
  $("#planForm").elements.category.value = "套餐";
  $("#planForm").elements.duration_days.value = "30";
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
  const normalizedTab = ["login", "register", "forgot"].includes(tab) ? tab : "login";
  const isForgot = normalizedTab === "forgot";
  const copy = {
    login: {
      title: "登录 / 注册",
      context: state.pendingPlanId ? "登录后即可继续购买所选套餐。" : "购买套餐、复制订阅、查看节点状态，都从这里开始。",
    },
    register: {
      title: "创建账号",
      context: state.pendingPlanId ? "创建账号后即可继续购买所选套餐。" : "创建账号后即可购买套餐并获取专属订阅。",
    },
    forgot: {
      title: "找回密码",
      context: "输入注册邮箱，提交后联系管理员确认。",
    },
  };
  const authTitle = $("#authTitle");
  const authContext = $("#authContext");
  if (authTitle) authTitle.textContent = copy[normalizedTab].title;
  if (authContext) authContext.textContent = copy[normalizedTab].context;
  $("[data-auth-tabs]")?.classList.toggle("hidden", isForgot);
  $$('[data-auth-tab]').forEach((button) => {
    const active = !isForgot && button.dataset.authTab === normalizedTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$('[data-auth-panel]').forEach((panel) => panel.classList.toggle("hidden", panel.dataset.authPanel !== normalizedTab));
  window.setTimeout(() => $(`[data-auth-panel="${normalizedTab}"] input`)?.focus(), 0);
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

function renderAdmin() {
  renderUsers();
  renderPlans();
  renderPanels();
  renderNodes();
  renderRechargeCards();
  renderUsageOptions();
  renderSettings();
  renderCheckinSettings();
  renderAdminTickets();
  renderAdminTutorials();
}

function renderRechargeCards() {
  const target = $("#rechargeCardList");
  if (!target) return;
  target.innerHTML = state.rechargeCards.length
    ? state.rechargeCards.map((card) => {
      const code = state.revealedCards[card.id] || card.masked_code;
      const disabled = card.can_reveal ? "" : "disabled";
      const legacyHint = card.can_reveal ? "" : '<span class="meta">旧卡不可查看完整卡密</span>';
      return '<article class="row-card recharge-card"><header><strong class="card-code">' + escapeHtml(code) + '</strong><span class="status ' + (card.status === "used" ? "disabled" : "active") + '">' + (card.status === "used" ? "已使用" : "未使用") + '</span></header><span class="meta">' + formatMoney(card.amount_cents) + (card.redeemed_by_email ? ' / ' + escapeHtml(card.redeemed_by_email) : "") + ' / ' + toDateTime(card.created_at) + '</span><div class="recharge-card-actions"><button type="button" class="ghost" data-reveal-card="' + card.id + '" ' + disabled + '>👁 查看</button><button type="button" class="ghost" data-copy-card="' + card.id + '" ' + disabled + '>复制</button>' + legacyHint + '</div></article>';
    }).join("")
    : '<div class="empty-state">尚未生成充值卡</div>';
}

function renderNodes() {
  $("#nodeList").innerHTML = state.nodes
    .map((node) => '<article class="row-card node-admin-card"><header><strong>' + escapeHtml(node.name) + '</strong><span class="row-actions"><button data-edit-node="' + node.id + '" class="ghost">编辑</button><button data-delete-node="' + node.id + '" class="danger">删除</button></span></header><span class="meta">' + (node.mode === "managed" ? "托管" : "静态") + ' / 入站 ' + (node.inbound_id || 0) + ' / 倍率 ' + node.rate + ' / 标签：' + escapeHtml(formatTags(node.tags)) + '</span><span class="meta">状态：<b class="status ' + escapeHtml(node.status || "unknown") + '">' + nodeStatusText(node.status) + '</b> / 延迟 ' + (node.latency_ms == null ? "-" : escapeHtml(node.latency_ms)) + 'ms / 检测 ' + toDateTime(node.last_checked_at) + '</span><span class="meta">' + escapeHtml(String(node.source_url || "").slice(0, 150)) + '</span><form class="inline-form node-status-form" data-node-status-form="' + node.id + '"><label>状态<select name="status">' + nodeStatusOptions(node.status || "unknown") + '</select></label><label>延迟 ms<input name="latency_ms" type="number" min="0" step="1" value="' + (node.latency_ms == null ? "" : escapeHtml(node.latency_ms)) + '"></label><button type="submit" class="ghost">更新状态</button></form></article>')
    .join("");
}

function renderCheckout() {
  const plan = findPendingPlan();
  const balance = Number(state.me?.balance_cents || 0);
  if ($("#checkoutPlanName")) $("#checkoutPlanName").textContent = plan ? planDisplayName(plan) : "未选择套餐";
  if ($("#checkoutPlanPrice")) $("#checkoutPlanPrice").textContent = plan ? formatMoney(plan.price_cents) : "¥0.00";
  if ($("#checkoutPlanQuota")) $("#checkoutPlanQuota").textContent = plan ? formatBytes(plan.quota_bytes) : "-";
  if ($("#checkoutPlanDuration")) $("#checkoutPlanDuration").textContent = plan ? plan.duration_days + " 天" : "-";
  if ($("#checkoutBalanceText")) $("#checkoutBalanceText").textContent = state.me ? formatMoney(balance) : "请先登录";
  if ($(".checkout-label")) $(".checkout-label").textContent = plan ? productTypeLabel(plan.product_type) : "所选商品";
  if ($(".checkout-confirm .form-intro p")) $(".checkout-confirm .form-intro p").textContent = plan ? (plan.purchase_notice || productRuleText(plan)) : "确认后将从当前余额扣款，并立即更新订阅和套餐用量。";
  const button = $("#checkoutPurchaseBtn");
  if (!button) return;
  const disabledReason = !plan ? "请先选择套餐" : !state.me ? "请先登录" : state.me.role === "admin" ? "管理员不可购买" : state.me.status === "disabled" ? "账号已停用" : balance < Number(plan.price_cents || 0) ? "余额不足" : "";
  button.disabled = Boolean(disabledReason);
  button.textContent = disabledReason || "确认购买并开通";
}

function renderSuccess() {
  if ($("#successPlanName")) $("#successPlanName").textContent = state.lastPurchase?.plan ? "已处理：" + planDisplayName(state.lastPurchase.plan) : "商品已处理";
  if ($("#successMessage")) {
    const message = state.lastPurchase ? provisioningNotice("开通结果", state.lastPurchase.provisioning, state.lastPurchase.errors) : "订阅链接和用量信息已经更新。";
    $("#successMessage").textContent = message;
  }
}

function renderNodeStatuses() {
  const target = $("#nodeStatusList");
  if (!target) return;
  if (!state.nodeStatuses.length) {
    target.innerHTML = '<div class="empty-state">当前暂无可展示节点。</div>';
    return;
  }
  const counts = state.nodeStatuses.reduce((acc, node) => {
    const key = node.status || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const summary = '<div class="node-status-summary"><span><b>' + state.nodeStatuses.length + '</b> 全部节点</span><span><b>' + (counts.online || 0) + '</b> 可用</span><span><b>' + (counts.degraded || 0) + '</b> 波动</span><span><b>' + ((counts.maintenance || 0) + (counts.offline || 0)) + '</b> 维护/离线</span></div>';
  const rows = state.nodeStatuses.map((node) => {
    const latency = node.latency_ms == null ? "-" : escapeHtml(node.latency_ms) + "ms";
    return '<article class="node-status-row"><div class="node-status-main"><span class="node-dot ' + escapeHtml(node.status || "unknown") + '"></span><div><strong>' + escapeHtml(node.name) + '</strong><small>' + escapeHtml(formatTags(node.tags)) + '</small></div></div><span class="status ' + escapeHtml(node.status || "unknown") + '">' + nodeStatusText(node.status) + '</span><div><small>延迟</small><b>' + latency + '</b></div><div><small>倍率</small><b>' + escapeHtml(node.rate ?? "1") + 'x</b></div><div><small>检测</small><b>' + toDateTime(node.last_checked_at) + '</b></div></article>';
  }).join("");
  target.innerHTML = summary + '<div class="node-status-rows">' + rows + '</div>';
}

function tutorialContentHtml(content) {
  return escapeHtml(content || "").replaceAll("\n", "<br>");
}

function groupedTutorials(tutorials) {
  return (tutorials || []).reduce((groups, item) => {
    const platform = item.platform || "通用";
    if (!groups[platform]) groups[platform] = [];
    groups[platform].push(item);
    return groups;
  }, {});
}

function renderTutorials() {
  const target = $("#publicTutorialList") || $("#tutorialList");
  if (!target) return;
  const platforms = [
    { key: "windows", name: "Windows", desc: "桌面端推荐 Clash Verge，也可使用 Hiddify 或 sing-box。", tools: ["Clash Verge", "Hiddify", "sing-box"] },
    { key: "macos", name: "macOS", desc: "macOS 可使用 Clash Verge、Hiddify 或 sing-box 导入订阅。", tools: ["Clash Verge", "Hiddify", "sing-box"] },
    { key: "ios", name: "iOS", desc: "iPhone / iPad 推荐 Shadowrocket，也可使用 Hiddify 或 sing-box。", tools: ["Shadowrocket", "Hiddify", "sing-box"] },
    { key: "android", name: "Android", desc: "Android 推荐 v2rayNG，也可使用 Hiddify 或 sing-box。", tools: ["v2rayNG", "Hiddify", "sing-box"] },
  ];
  const toolInfo = {
    "Clash Verge": { logo: "/assets/clients/clash-verge.svg", format: "Clash 订阅", steps: ["下载并打开 Clash Verge", "复制 Clash 订阅链接", "在订阅页面粘贴链接并更新"] },
    "Shadowrocket": { logo: "/assets/clients/shadowrocket.svg", format: "Base64 订阅", steps: ["打开 Shadowrocket", "点击右上角添加订阅", "粘贴链接后保存并更新"] },
    "v2rayNG": { logo: "/assets/clients/v2rayng.svg", format: "Base64 订阅", steps: ["打开 v2rayNG", "从剪贴板导入订阅", "更新订阅并选择节点"] },
    "sing-box": { logo: "/assets/clients/sing-box.svg", format: "sing-box 订阅", steps: ["打开 sing-box", "添加远程配置", "保存后刷新配置"] },
    "Hiddify": { logo: "/assets/clients/hiddify.svg", format: "Base64 订阅", steps: ["打开 Hiddify", "选择从链接导入", "更新配置后连接节点"] },
  };
  const platformHtml = `<div class="tutorial-platform-shell">
    <div class="tutorial-platform-tabs" role="tablist" aria-label="选择设备系统">${platforms.map((platform, index) => `
      <button type="button" class="tutorial-platform-tab${index === 0 ? " active" : ""}" data-platform-tab="${platform.key}">
        <span>${escapeHtml(platform.name)}</span>
        <small>${escapeHtml(platform.tools.join(" / "))}</small>
      </button>`).join("")}
    </div>
    <div class="tutorial-platform-panels">${platforms.map((platform, index) => `
      <section class="tutorial-platform-panel${index === 0 ? " active" : ""}" data-platform-panel="${platform.key}">
        <div class="tutorial-panel-copy">
          <h2>${escapeHtml(platform.name)} 客户端</h2>
          <p>${escapeHtml(platform.desc)}</p>
        </div>
        <div class="tutorial-tool-grid">${platform.tools.map((tool) => {
          const info = toolInfo[tool];
          return `<article class="tutorial-tool-card">
            <div class="tutorial-tool-head"><img src="${escapeHtml(info.logo)}" alt="${escapeHtml(tool)} logo"><div><strong>${escapeHtml(tool)}</strong><span>${escapeHtml(info.format)}</span></div></div>
            <ol>${info.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
          </article>`;
        }).join("")}</div>
      </section>`).join("")}
    </div>
  </div>`;
  const faqHtml = `<section class="guide-faq-panel guide-help-panel">
    <h2>导入提示</h2>
    <div class="guide-help-grid">
      <p><strong>链接选择</strong><span>Clash Verge 使用 Clash 订阅，sing-box 使用 sing-box 订阅，其他客户端优先使用 Base64 订阅。</span></p>
      <p><strong>节点为空</strong><span>先在客户端内更新订阅；仍为空时，重新复制订阅链接再导入。</span></p>
      <p><strong>连接异常</strong><span>先切换其他节点测试；如果仍不可用，可提交工单并附上客户端截图。</span></p>
    </div>
  </section>`;
  const extraTutorials = state.tutorials || [];
  const extraHtml = extraTutorials.length
    ? '<div class="tutorial-extra-list"><h2>补充教程</h2>' + extraTutorials.map((item) => `
      <article class="tutorial-card">
        <div><span>${escapeHtml(item.platform || "补充说明")}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description || "")}</p></div>
        ${item.image_url ? `<img class="tutorial-image" src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title)}">` : ""}
      </article>`).join("") + '</div>'
    : "";
  target.innerHTML = platformHtml + faqHtml + extraHtml;
  target.querySelectorAll("[data-platform-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const platform = button.dataset.platformTab;
      target.querySelectorAll("[data-platform-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
      target.querySelectorAll("[data-platform-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.platformPanel === platform));
    });
  });
}


function renderAdminTutorials() {
  const target = $("#tutorialList");
  if (!target) return;
  target.innerHTML = state.adminTutorials.length
    ? state.adminTutorials.map((item) => '<article class="row-card tutorial-admin-card"><header><strong>' + escapeHtml(item.title) + '</strong><span class="row-actions"><button type="button" class="ghost" data-edit-tutorial="' + item.id + '">编辑</button><button type="button" class="danger" data-delete-tutorial="' + item.id + '">删除</button></span></header><span class="meta">' + escapeHtml(item.platform || "通用") + ' / 排序 ' + escapeHtml(item.sort_order ?? 0) + ' / ' + (item.enabled ? "前台展示" : "草稿隐藏") + '</span><p>' + tutorialContentHtml(String(item.content || "").slice(0, 180)) + '</p>' + (item.image_url ? '<img class="tutorial-image small" src="' + escapeHtml(item.image_url) + '" alt="' + escapeHtml(item.title) + '">' : '') + '</article>').join("")
    : '<div class="empty-state">还没有教程，先添加一个 Windows 或 Android 教程。</div>';
}

function renderCheckin() {
  const status = $("#checkinStatus");
  const list = $("#checkinRecentList");
  const button = $("[data-checkin]");
  if (!status || !list || !button) return;
  if (!state.me || state.me.role !== "user") {
    status.textContent = "登录普通用户账号后可查看签到状态。";
    button.disabled = true;
    list.innerHTML = '<span class="meta">暂无签到记录</span>';
    return;
  }
  const checkin = state.checkin;
  if (!checkin) {
    status.textContent = "正在读取签到状态…";
    button.disabled = true;
    list.innerHTML = '<span class="meta">暂无签到记录</span>';
    return;
  }
  const settings = checkin.settings || {};
  if (!checkin.enabled || !settings.enabled) {
    status.textContent = "签到功能暂未开启。";
    button.disabled = true;
  } else if (!checkin.eligible) {
    status.textContent = "仅开通有效套餐的用户可签到领取流量。";
    button.disabled = true;
  } else if (checkin.checked_in_today) {
    status.textContent = "今日已签到" + (checkin.last_reward_bytes ? "，获得 " + formatBytes(checkin.last_reward_bytes) : "") + "。";
    button.disabled = true;
  } else {
    status.textContent = settings.mode === "random" ? "今日可签到，奖励范围 " + settings.min_gb + "GB - " + settings.max_gb + "GB。" : "今日可签到，奖励 " + settings.fixed_gb + "GB。";
    button.disabled = false;
  }
  list.innerHTML = (checkin.recent || []).length
    ? checkin.recent.slice(0, 7).map((item) => '<div class="checkin-record"><span>' + escapeHtml(item.checkin_date) + '</span><strong>+' + formatBytes(item.reward_bytes) + '</strong></div>').join("")
    : '<span class="meta">暂无签到记录</span>';
}

function renderTickets() {
  const target = $("#ticketList");
  if (!target) return;
  if (state.me?.role !== "user") {
    target.innerHTML = '<span class="meta">暂无工单</span>';
    return;
  }
  target.innerHTML = state.tickets.length
    ? state.tickets.map((ticket) => '<article class="ticket-card"><header><strong>#' + ticket.id + ' ' + escapeHtml(ticket.subject) + '</strong><span class="status ' + escapeHtml(ticket.status) + '">' + ticketStatusText(ticket.status) + '</span></header><p>' + escapeHtml(ticket.message) + '</p><small>创建 ' + toDateTime(ticket.created_at) + ' / 更新 ' + toDateTime(ticket.updated_at) + '</small><div class="ticket-replies">' + ticketRepliesHtml(ticket) + '</div><form class="inline-form user-ticket-reply-form" data-user-ticket-reply-form="' + ticket.id + '"><label>继续反馈<textarea name="message" rows="3" maxlength="2000" required placeholder="补充你的问题或回复客服"></textarea></label><button type="submit">继续回复</button></form></article>').join("")
    : '<span class="meta">暂无工单</span>';
}

function renderAdminTickets() {
  const target = $("#adminTicketList");
  if (!target) return;
  if (state.me?.role !== "admin") {
    target.innerHTML = '<span class="meta">暂无工单</span>';
    return;
  }
  target.innerHTML = state.adminTickets.length
    ? state.adminTickets.map((ticket) => '<article class="ticket-card admin-ticket-card"><header><strong>#' + ticket.id + ' ' + escapeHtml(ticket.subject) + '</strong><span class="status ' + escapeHtml(ticket.status) + '">' + ticketStatusText(ticket.status) + '</span></header><p class="meta">' + escapeHtml(ticket.user_email || "未知用户") + ' / 回复 ' + (ticket.reply_count || 0) + ' / 更新 ' + toDateTime(ticket.updated_at) + '</p><p>' + escapeHtml(ticket.message) + '</p><div class="ticket-replies">' + ticketRepliesHtml(ticket) + '</div><form class="inline-form admin-ticket-reply-form" data-admin-ticket-reply-form="' + ticket.id + '"><label>回复<textarea name="message" rows="3" maxlength="2000" required></textarea></label><label>状态<select name="status"><option value="open" ' + (ticket.status === "open" ? "selected" : "") + '>处理中</option><option value="pending" ' + (ticket.status === "pending" ? "selected" : "") + '>等待反馈</option><option value="closed" ' + (ticket.status === "closed" ? "selected" : "") + '>已关闭</option></select></label><button type="submit">回复</button></form></article>').join("")
    : '<span class="meta">暂无工单</span>';
}

function renderCheckinSettings() {
  const form = $("#checkinSettingsForm");
  if (!form) return;
  const settings = state.checkinSettings || {};
  form.elements.enabled.checked = Boolean(settings.enabled);
  form.elements.mode.value = settings.mode || "fixed";
  form.elements.fixed_gb.value = settings.fixed_gb ?? 1;
  form.elements.min_gb.value = settings.min_gb ?? 0.5;
  form.elements.max_gb.value = settings.max_gb ?? 1;
  form.elements.active_plan_only.checked = settings.active_plan_only !== false;
}

async function revealRechargeCard(id) {
  if (state.revealedCards[id]) return state.revealedCards[id];
  const data = await api("/api/admin/recharge-cards/reveal", {
    method: "POST",
    body: JSON.stringify({ id }),
    loadingLabel: "正在解密充值卡",
  });
  state.revealedCards[id] = data.code;
  renderRechargeCards();
  return data.code;
}

async function requestPurchase(planId) {
  const plan = state.plans.find((item) => String(item.id) === String(planId));
  if (!plan) {
    openAuth("login");
    return;
  }
  state.pendingPlanId = Number(plan.id);
  if (!state.me) {
    openAuth("login");
    return;
  }
  if (state.me.role === "admin") throw new Error("管理员账号不能购买套餐");
  setView("checkout");
}

async function submitPurchase() {
  if (!state.pendingPlanId) return;
  const plan = findPendingPlan();
  if (!plan) throw new Error("套餐不存在");
  const data = await api("/api/purchases", {
    method: "POST",
    body: JSON.stringify({ plan_id: state.pendingPlanId }),
    loadingLabel: "正在购买并开通套餐",
  });
  state.lastPurchase = { plan, provisioning: data.provisioning, errors: data.errors };
  state.pendingPlanId = null;
  state.me = data.user;
  if (state.me?.role === "user") {
    await refreshBalanceTransactions();
    await refreshCheckin();
  }
  renderAuth();
  closeAuth(false);
  setView("success");
  showNotice(provisioningNotice("套餐购买成功", data.provisioning, data.errors));
}

async function finishAuthentication(user) {
  state.me = user;
  renderAuth();
  if (state.me?.role === "admin") await refreshAdmin();
  closeAuth(false);
  if (state.pendingPlanId && state.me?.role === "user") setView("checkout");
  else setView(state.me?.role === "admin" ? "admin" : "account");
}

async function handleDocumentClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const rechargeFocusButton = target.closest("[data-focus-recharge]");
  if (rechargeFocusButton) {
    setView("balance");
    window.setTimeout(() => {
      const form = $("#rechargeForm");
      form?.scrollIntoView({ behavior: "smooth", block: "center" });
      form?.querySelector('input[name="code"]')?.focus({ preventScroll: true });
    }, 90);
    return;
  }
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
  const guestScrollButton = target.closest("[data-scroll-guest]");
  if (guestScrollButton) {
    const sectionMap = {
      hero: "#guestHero",
      plans: "#plansSection",
      clients: "#guestClients",
      flow: "#guestFlow",
    };
    const selector = sectionMap[guestScrollButton.dataset.scrollGuest] || "#guestHero";
    setView("storefront");
    window.setTimeout(() => $(selector)?.scrollIntoView({ behavior: "smooth", block: "start" }), 90);
    return;
  }
  if (target.closest("[data-scroll-plans]")) {
    setView("storefront");
    window.setTimeout(() => $("#plansSection")?.scrollIntoView({ behavior: "smooth", block: "start" }), 90);
    return;
  }
  const applyButton = target.closest("[data-apply-plan]");
  if (applyButton) {
    await requestPurchase(applyButton.dataset.applyPlan);
    return;
  }

  if (target.closest("#checkoutPurchaseBtn")) {
    await submitPurchase();
    return;
  }

  if (target.closest("[data-refresh-node-status]")) {
    await refreshNodeStatuses();
    showNotice("节点状态已刷新");
    return;
  }

  if (target.closest("[data-checkin]")) {
    const data = await api("/api/checkin", { method: "POST", body: "{}", loadingLabel: "正在签到" });
    state.me = data.user;
    state.checkin = data.checkin;
    renderAuth();
    showNotice("签到成功，获得 " + formatBytes(data.reward_bytes) + " 流量");
    return;
  }

  const revealCard = target.closest("[data-reveal-card]");
  if (revealCard) {
    await revealRechargeCard(revealCard.dataset.revealCard);
    showNotice("完整卡密已显示");
    return;
  }

  const copyCard = target.closest("[data-copy-card]");
  if (copyCard) {
    const code = await revealRechargeCard(copyCard.dataset.copyCard);
    await copyPlainText(code);
    showNotice("充值卡密已复制");
    return;
  }

  const importButton = target.closest("[data-import-client]");
  if (importButton) {
    await launchImport(importButton.dataset.importClient);
    return;
  }

  const copySubscription = target.closest("[data-copy-sub]");
  if (copySubscription) {
    const format = copySubscription.dataset.copySub;
    const fallbackFormat = format === "macos-clash" ? "clash" : format === "android-base64" ? "base64" : format;
    await copyTextFromInput($(`[data-sub-format="${format}"]`) || $(`[data-sub-format="${fallbackFormat}"]`));
    showNotice("订阅链接已复制");
    return;
  }

  const deviceCopyTab = target.closest("[data-device-copy-tab]");
  if (deviceCopyTab) {
    const shell = deviceCopyTab.closest(".device-copy-shell");
    shell?.querySelectorAll("[data-device-copy-tab]").forEach((btn) => btn.classList.toggle("active", btn === deviceCopyTab));
    if (shell) shell.dataset.activeDevice = deviceCopyTab.dataset.deviceCopyTab;
    return;
  }
  if (target.closest("[data-copy-recommended-sub]")) {
    await copyTextFromInput($("#subscriptionUrl"));
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
  if (action.dataset.deleteTutorial) {
    if (!window.confirm("确定删除这个教程吗？")) return;
    await api("/api/admin/tutorials/delete", { method: "POST", body: JSON.stringify({ id: action.dataset.deleteTutorial }), loadingLabel: "正在删除教程" });
    await refreshAdmin();
    await refreshPublic();
    showNotice("教程已删除");
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
  if (action.dataset.editTutorial) {
    const tutorial = state.adminTutorials.find((item) => String(item.id) === action.dataset.editTutorial);
    fillForm($("#tutorialForm"), tutorial);
    setView("settings");
    $("#tutorialForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (action.dataset.resetTutorialForm !== undefined) {
    resetTutorialForm();
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
  if (target.id === "tutorialImageInput") {
    const file = target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
    if (file.size > 2 * 1024 * 1024) throw new Error("教程图片不能超过 2MB");
    $("#tutorialForm").elements.image_url.value = String(await readFileAsDataUrl(file));
    showNotice("教程图片已读取");
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
  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    state.me = null;
    state.users = [];
    state.panels = [];
    state.nodes = [];
    state.transactions = [];
    state.checkin = null;
    state.tickets = [];
    state.adminTickets = [];
    state.adminTutorials = [];
    state.checkinSettings = {};
    state.revealedCards = {};
    state.lastPurchase = null;
    state.rechargeCards = [];
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

  $("#ticketForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    await api("/api/tickets", { method: "POST", body: JSON.stringify(formData(form)), loadingLabel: "正在提交工单" });
    form.reset();
    await refreshTickets();
    showNotice("工单已提交");
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

  $("#checkinSettingsForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const data = await api("/api/admin/checkin/settings", { method: "POST", body: JSON.stringify(formData(form)), loadingLabel: "正在保存签到配置" });
    state.checkinSettings = data.settings || {};
    renderCheckinSettings();
    showNotice("签到配置已保存");
  }));

  $("#tutorialForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    await api("/api/admin/tutorials", { method: "POST", body: JSON.stringify(formData(form)), loadingLabel: "正在保存教程" });
    resetTutorialForm();
    await refreshAdmin();
    await refreshPublic();
    showNotice("教程已保存");
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
  resetTutorialForm();
  await refreshPublic();
  await refreshMe();
  setView("storefront");
}

boot().catch((error) => showNotice(error.message));
