const state = {
  me: null,
  plans: [],
  users: [],
  panels: [],
  nodes: [],
  settings: {},
  inbounds: [],
  view: "storefront",
  pendingPlanId: null,
  loadingCount: 0,
  loadingStartedAt: 0,
  loadingTimer: null,
  elapsedTimer: null,
  authReturnFocus: null,
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

function toDate(seconds) {
  if (!seconds) return "-";
  return new Date(Number(seconds) * 1000).toLocaleDateString("zh-CN");
}

function statusText(status) {
  return {
    unsubscribed: "未申请",
    pending: "待审核",
    active: "已开通",
    disabled: "已停用",
  }[status] || status || "未知";
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

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason?.message || String(reason || "请求失败");
  showNotice(message);
  event.preventDefault();
});

async function withSubmitState(event, action) {
  event.preventDefault();
  const form = event.currentTarget;
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

function setView(view) {
  if (view === "account" && !state.me) {
    openAuth("login");
    return;
  }
  if (["admin", "nodes", "settings"].includes(view) && state.me?.role !== "admin") {
    view = "storefront";
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
  renderAuth();
  if (state.me?.role === "admin") await refreshAdmin();
}

async function refreshAdmin() {
  const [users, plans, panels, nodes, settings] = await Promise.all([
    api("/api/admin/users", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/plans", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/panels", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/nodes", { loadingLabel: "正在读取后台数据" }),
    api("/api/admin/settings", { loadingLabel: "正在读取后台数据" }),
  ]);
  state.users = users.users || [];
  state.plans = plans.plans || state.plans;
  state.panels = panels.panels || [];
  state.nodes = nodes.nodes || [];
  state.settings = settings.settings || {};
  renderAdmin();
  renderPlanCatalog();
}

function renderAuth() {
  const loggedIn = Boolean(state.me);
  const isAdmin = state.me?.role === "admin";
  $("#sessionEmail").textContent = loggedIn ? state.me.email : "游客";
  $("#loginBtn").classList.toggle("hidden", loggedIn);
  $("#registerBtn").classList.toggle("hidden", loggedIn);
  $("#refreshBtn").classList.toggle("hidden", !loggedIn);
  $("#logoutBtn").classList.toggle("hidden", !loggedIn);
  $$(".admin-only").forEach((node) => node.classList.toggle("hidden", !isAdmin));
  $$(".user-only").forEach((node) => node.classList.toggle("hidden", !loggedIn || isAdmin));
  const mobileAccount = $("#mobileAccountBtn");
  mobileAccount.textContent = loggedIn ? (isAdmin ? "后台" : "订阅") : "登录";
  if (!loggedIn) {
    renderPlanCatalog();
    return;
  }

  const statusMessages = {
    unsubscribed: "尚未申请套餐，可返回商城选择一个实时套餐。",
    pending: "申请已提交，正在等待管理员审核。",
    active: "账号已开通，可复制订阅链接导入 Clash 使用。",
    disabled: "账号已停用，如有疑问请联系管理员。",
  };
  $("#accountStatus").textContent = statusMessages[state.me.status] || "账号状态未知。";
  $("#quotaText").textContent = formatBytes(state.me.quota_bytes);
  $("#usedText").textContent = formatBytes(state.me.used_bytes);
  $("#remainText").textContent = formatBytes(state.me.remaining_bytes);
  $("#expireText").textContent = toDate(state.me.expire_at);
  $("#subscriptionUrl").value = state.me.subscription_url || "";
  $("#copySubBtn").disabled = state.me.status !== "active" || !state.me.subscription_url;
  renderPlanCatalog();
}

function planAction(plan) {
  if (!state.me) return { label: "立即申请", disabled: false };
  if (state.me.role === "admin") return { label: "管理员不可申请", disabled: true };
  if (state.me.status === "unsubscribed") return { label: "立即申请", disabled: false };
  if (state.me.status === "pending") return { label: "申请审核中", disabled: true };
  if (state.me.status === "active") return { label: "已有生效套餐", disabled: true };
  return { label: "账号已停用", disabled: true };
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
          <p class="plan-quota">${escapeHtml(formatBytes(plan.quota_bytes))}</p>
          <div class="plan-meta">
            <span>${plan.duration_days} 天有效</span>
            <span>${plan.require_approval ? "人工审核" : "自动开通"}</span>
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
  renderUsageOptions();
  renderSettings();
}

function userActionButtons(user) {
  if (user.role === "admin") return '<span class="meta">系统管理员</span>';
  const plannedActions = user.plan_id
    ? `${user.status === "pending" ? `<button data-approve="${user.id}">通过</button>` : ""}
       <button class="ghost" data-retry-provision="${user.id}">重试开通</button>
       <button class="ghost" data-reconcile-user="${user.id}">对账</button>`
    : "";
  const lifecycle = user.status === "disabled"
    ? `<button data-status="${user.id}" data-value="active">启用</button>
       <button class="danger" data-delete-user="${user.id}" data-user-email="${escapeHtml(user.email)}">永久删除</button>`
    : `<button class="danger" data-status="${user.id}" data-value="disabled">停用</button>`;
  return plannedActions + lifecycle;
}

function renderUsers() {
  const rows = state.users.map((user) => {
    const plan = state.plans.find((item) => item.id === user.plan_id);
    const provisionText = provisioningSummary(user.provisioning);
    const errorText = provisioningErrorSummary(user.provisioning_errors);
    return `<tr>
      <td><strong>${escapeHtml(user.email)}</strong></td>
      <td><span class="status ${user.status}">${statusText(user.status)}</span></td>
      <td>${escapeHtml(plan?.name || "未选择")}</td>
      <td>${formatBytes(user.used_bytes)} / ${formatBytes(user.quota_bytes)}</td>
      <td>${toDate(user.expire_at)}</td>
      <td><div class="meta">${escapeHtml(provisionText || "-")}</div>${errorText ? `<div class="error-text">${escapeHtml(errorText)}</div>` : ""}</td>
      <td><div class="actions">${userActionButtons(user)}</div></td>
    </tr>`;
  }).join("");
  $("#userRows").innerHTML = rows;
  $("#userCardList").innerHTML = state.users.map((user) => {
    const plan = state.plans.find((item) => item.id === user.plan_id);
    const errorText = provisioningErrorSummary(user.provisioning_errors);
    return `<article class="user-card">
      <header><h3>${escapeHtml(user.email)}</h3><span class="status ${user.status}">${statusText(user.status)}</span></header>
      <div class="user-card-meta"><span>${escapeHtml(plan?.name || "未选择套餐")}</span><span>${formatBytes(user.used_bytes)} / ${formatBytes(user.quota_bytes)}</span></div>
      ${errorText ? `<div class="error-text">${escapeHtml(errorText)}</div>` : ""}
      <div class="actions">${userActionButtons(user)}</div>
    </article>`;
  }).join("");
}

function renderPlans() {
  $("#planList").innerHTML = state.plans
    .map((plan) => `<article class="row-card">
      <header><strong>${escapeHtml(plan.name)}</strong><span class="row-actions"><button data-edit-plan="${plan.id}" class="ghost">编辑</button><button data-delete-plan="${plan.id}" class="danger">删除</button></span></header>
      <span class="meta">${formatBytes(plan.quota_bytes)} / ${plan.duration_days} 天 / 标签：${escapeHtml((plan.allowed_tags || []).join(",") || "全部")}</span>
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
  resetFormMode($("#planForm"), $("#planFormTitle"), $("#planSubmitBtn"), "套餐", "添加套餐");
}

function resetPanelForm() {
  resetFormMode($("#panelForm"), $("#panelFormTitle"), $("#panelSubmitBtn"), " X-UI 面板", "添加面板");
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

function openAuth(tab = "login") {
  if (state.me) {
    setView(state.me.role === "admin" ? "admin" : "account");
    return;
  }
  state.authReturnFocus = document.activeElement;
  showAuthTab(tab);
  $("#authContext").textContent = state.pendingPlanId ? "登录或注册后，将自动继续申请所选套餐。" : "登录后继续管理你的订阅。";
  const dialog = $("#authDialog");
  if (!dialog.open) dialog.showModal();
}

function closeAuth(discardPending = false) {
  const dialog = $("#authDialog");
  if (dialog.open) dialog.close();
  if (discardPending) state.pendingPlanId = null;
  state.authReturnFocus?.focus?.();
  state.authReturnFocus = null;
}

async function requestApplication(planId) {
  state.pendingPlanId = Number(planId);
  if (!state.me) {
    openAuth("login");
    return;
  }
  await submitApplication();
}

async function submitApplication() {
  if (!state.pendingPlanId) return;
  const data = await api("/api/applications", {
    method: "POST",
    body: JSON.stringify({ plan_id: state.pendingPlanId }),
    loadingLabel: "正在提交套餐申请",
  });
  state.pendingPlanId = null;
  state.me = data.user;
  renderAuth();
  closeAuth(false);
  setView("account");
  showNotice(state.me.status === "active" ? "套餐已自动开通" : "申请已提交，等待管理员审核");
}

async function finishAuthentication(user) {
  state.me = user;
  renderAuth();
  if (state.me?.role === "admin") await refreshAdmin();
  closeAuth(false);
  if (state.pendingPlanId && state.me?.role === "user") await submitApplication();
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
    $("#plansSection").scrollIntoView({ behavior: "smooth" });
    return;
  }
  const applyButton = target.closest("[data-apply-plan]");
  if (applyButton) {
    await requestApplication(applyButton.dataset.applyPlan);
    return;
  }

  const action = target.closest("button");
  if (!action) return;
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
    setFormMode($("#planForm"), $("#planFormTitle"), $("#planSubmitBtn"), "套餐", { ...plan, quota_gb: quotaGb(plan), allowed_tags: plan.allowed_tags || [] });
    setView("settings");
  }
  if (action.dataset.editPanel) {
    const panel = state.panels.find((item) => String(item.id) === action.dataset.editPanel);
    setFormMode($("#panelForm"), $("#panelFormTitle"), $("#panelSubmitBtn"), " X-UI 面板", panel);
    $("#panelPasswordHelp").textContent = panel.has_password ? "已保存密码；留空会继续使用原密码，填写新密码才会替换。" : "当前没有保存密码，请填写新密码。";
    setView("settings");
  }
  if (action.dataset.editNode) {
    fillForm($("#nodeForm"), state.nodes.find((item) => String(item.id) === action.dataset.editNode));
    setView("nodes");
  }
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    handleDocumentClick(event).catch((error) => showNotice(error?.message || "操作失败"));
  });
  $("#authDialog").addEventListener("cancel", () => {
    state.pendingPlanId = null;
  });
  $("#mobileAccountBtn").addEventListener("click", () => {
    if (state.me) setView(state.me.role === "admin" ? "admin" : "account");
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
    state.pendingPlanId = null;
    $("#loginForm").reset();
    $("#registerForm").reset();
    setView("storefront");
    renderAuth();
    showNotice("已退出登录");
  });
  $("#newPlanBtn").addEventListener("click", resetPlanForm);
  $("#newPanelBtn").addEventListener("click", resetPanelForm);
  $("#syncUsageBtn").addEventListener("click", async () => {
    const result = await api("/api/admin/sync-usage", { method: "POST", body: "{}", loadingLabel: "正在同步 X-UI 用量" });
    await refreshAdmin();
    showNotice(`同步完成：更新 ${result.synced || 0} 条，停用 ${result.disabled || 0} 个客户端${result.errors?.length ? "，有错误请检查面板配置" : ""}`);
  });
  $("#copySubBtn").addEventListener("click", async () => {
    await copyTextFromInput($("#subscriptionUrl"));
    showNotice("订阅链接已复制");
  });

  $("#loginForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const data = await api("/api/login", { method: "POST", body: JSON.stringify(formData(form)), loadingLabel: "正在登录" });
    await finishAuthentication(data.user);
    showNotice("登录成功");
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
    resetPlanForm();
    await refreshAdmin();
    showNotice(editing ? "套餐修改已保存" : "新套餐已添加");
  }));

  $("#panelForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const editing = form.dataset.mode === "edit";
    await api("/api/admin/panels", { method: "POST", body: JSON.stringify(formData(form)) });
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
