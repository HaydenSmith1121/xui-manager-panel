const state = {
  me: null,
  plans: [],
  users: [],
  panels: [],
  nodes: [],
  settings: {},
  inbounds: [],
  view: "account",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败: ${res.status}`);
  return data;
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
  return new Date(Number(seconds) * 1000).toLocaleDateString();
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

function showNotice(message) {
  const box = $("#notice");
  box.textContent = message;
  box.classList.remove("hidden");
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => box.classList.add("hidden"), 3200);
}

async function copyTextFromInput(input) {
  const value = input.value || "";
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
    button.textContent = "处理中...";
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
  state.view = view;
  $$(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  $$(".view").forEach((node) => node.classList.add("hidden"));
  const target = $(`#${view}View`);
  if (target) target.classList.remove("hidden");
}

async function refreshPublic() {
  const data = await api("/api/plans");
  state.plans = data.plans || [];
  renderPlanOptions();
}

async function refreshMe() {
  const data = await api("/api/me");
  state.me = data.user;
  renderAuth();
  if (state.me?.role === "admin") await refreshAdmin();
}

async function refreshAdmin() {
  const [users, plans, panels, nodes, settings] = await Promise.all([
    api("/api/admin/users"),
    api("/api/admin/plans"),
    api("/api/admin/panels"),
    api("/api/admin/nodes"),
    api("/api/admin/settings"),
  ]);
  state.users = users.users || [];
  state.plans = plans.plans || state.plans;
  state.panels = panels.panels || [];
  state.nodes = nodes.nodes || [];
  state.settings = settings.settings || {};
  renderAdmin();
}

function renderAuth() {
  const loggedIn = Boolean(state.me);
  $("#authPanel").classList.toggle("hidden", loggedIn);
  $("#accountView").classList.toggle("hidden", !loggedIn || state.view !== "account");
  $("#sessionEmail").textContent = loggedIn ? state.me.email : "未登录";
  $("#logoutBtn").classList.toggle("hidden", !loggedIn);
  $$(".admin-only").forEach((node) => node.classList.toggle("hidden", state.me?.role !== "admin"));
  if (!loggedIn) return;

  const status = state.me.status;
  $("#accountStatus").textContent = status === "active" ? "账户已开通，可以导入 Clash 使用。" : "账户等待管理员审核。";
  $("#quotaText").textContent = formatBytes(state.me.quota_bytes);
  $("#usedText").textContent = formatBytes(state.me.used_bytes);
  $("#remainText").textContent = formatBytes(state.me.remaining_bytes);
  $("#expireText").textContent = toDate(state.me.expire_at);
  $("#subscriptionUrl").value = state.me.subscription_url || "";
}

function renderPlanOptions() {
  const select = $("#registerPlan");
  select.innerHTML = state.plans
    .filter((plan) => plan.enabled !== false)
    .map((plan) => `<option value="${plan.id}">${escapeHtml(plan.name)} - ${formatBytes(plan.quota_bytes)}</option>`)
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

function renderUsers() {
  $("#userRows").innerHTML = state.users
    .map((user) => {
      const plan = state.plans.find((item) => item.id === user.plan_id);
      return `<tr>
        <td>${escapeHtml(user.email)}</td>
        <td><span class="status ${user.status}">${user.status}</span></td>
        <td>${escapeHtml(plan?.name || "-")}</td>
        <td>${formatBytes(user.used_bytes)} / ${formatBytes(user.quota_bytes)}</td>
        <td>${toDate(user.expire_at)}</td>
        <td><div class="actions">
          ${user.status === "pending" ? `<button data-approve="${user.id}">通过</button>` : ""}
          <button class="ghost" data-retry-provision="${user.id}">重试开通</button>
          <button class="ghost" data-reconcile-user="${user.id}">对账</button>
          ${user.status !== "disabled" ? `<button class="danger" data-status="${user.id}" data-value="disabled">停用</button>` : `<button data-status="${user.id}" data-value="active">启用</button>`}
        </div></td>
      </tr>`;
    })
    .join("");
}

function renderPlans() {
  $("#planList").innerHTML = state.plans
    .map((plan) => `<article class="row-card">
      <header><strong>${escapeHtml(plan.name)}</strong><span class="row-actions"><button data-edit-plan="${plan.id}" class="ghost">编辑</button><button data-delete-plan="${plan.id}" class="danger">删除</button></span></header>
      <span class="meta">${formatBytes(plan.quota_bytes)} / ${plan.duration_days} 天 / 标签: ${escapeHtml((plan.allowed_tags || []).join(",") || "全部")}</span>
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
  $("#nodePanel").innerHTML = `<option value="">不绑定</option>` + state.panels.map((panel) => `<option value="${panel.id}">${escapeHtml(panel.name)}</option>`).join("");
}

function renderNodes() {
  $("#nodeList").innerHTML = state.nodes
    .map((node) => `<article class="row-card">
      <header><strong>${escapeHtml(node.name)}</strong><span class="row-actions"><button data-edit-node="${node.id}" class="ghost">编辑</button><button data-delete-node="${node.id}" class="danger">删除</button></span></header>
      <span class="meta">${node.mode === "managed" ? "托管" : "静态"} / 入站 ${node.inbound_id || 0} / 倍率 ${node.rate} / 标签: ${escapeHtml((node.tags || []).join(",") || "无")}</span>
      <span class="meta">${escapeHtml(String(node.source_url || "").slice(0, 150))}</span>
    </article>`)
    .join("");
}

function renderSettings() {
  const form = $("#settingsForm");
  if (!form) return;
  form.elements.sync_interval_seconds.value = state.settings.sync_interval_seconds || "300";
}

function renderInboundOptions(inbounds) {
  state.inbounds = inbounds || [];
  $("#inboundOptions").innerHTML = state.inbounds
    .map((item) => `<option value="${item.id}" label="${escapeHtml(`${item.remark || "入站"} / ${item.protocol || "-"} / ${item.port || "-"}`)}"></option>`)
    .join("");
}

function renderUsageOptions() {
  $("#usageUser").innerHTML = state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.email)}</option>`).join("");
  $("#usageNode").innerHTML = state.nodes.map((node) => `<option value="${node.id}">${escapeHtml(node.name)}</option>`).join("");
}

function fillForm(form, data) {
  Object.entries(data).forEach(([key, value]) => {
    const input = form.elements[key];
    if (!input) return;
    if (input.type === "checkbox") {
      input.checked = Boolean(value);
    } else if (Array.isArray(value)) {
      input.value = value.join(",");
    } else if (key === "quota_bytes") {
      input.value = Number(value || 0) / 1024 ** 3;
    } else {
      input.value = value ?? "";
    }
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
  $("#panelPasswordHelp").textContent = "新建面板时请填写密码；编辑已有面板时，留空保留已保存密码。";
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
  });
  renderInboundOptions(data.inbounds || []);
  if (state.inbounds.length === 1) {
    $("#nodeForm").elements.inbound_id.value = state.inbounds[0].id;
  }
  return state.inbounds.length;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function bindEvents() {
  $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
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
    $("#loginForm").reset();
    setView("account");
    renderAuth();
    showNotice("已退出登录");
  });
  $("#newPlanBtn").addEventListener("click", resetPlanForm);
  $("#newPanelBtn").addEventListener("click", resetPanelForm);
  $("#syncUsageBtn").addEventListener("click", async () => {
    const result = await api("/api/admin/sync-usage", { method: "POST", body: "{}" });
    await refreshAdmin();
    showNotice(`同步完成：更新 ${result.synced || 0} 条，停用 ${result.disabled || 0} 个客户端${result.errors?.length ? "，有错误请检查面板配置" : ""}`);
  });
  $("#copySubBtn").addEventListener("click", async () => {
    await copyTextFromInput($("#subscriptionUrl"));
    showNotice("订阅链接已复制");
  });

  $("#loginForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    const data = await api("/api/login", { method: "POST", body: JSON.stringify(formData(form)) });
    state.me = data.user;
    setView("account");
    await refreshMe();
    showNotice("登录成功");
  }));

  $("#registerForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    await api("/api/register", { method: "POST", body: JSON.stringify(formData(form)) });
    showNotice("申请已提交，等待管理员审核");
    form.reset();
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
    showNotice("同步设置已保存");
  }));

  $("#usageForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    await api("/api/admin/usage", { method: "POST", body: JSON.stringify(formData(form)) });
    await refreshAdmin();
    showNotice("用量已保存");
  }));

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.approve) {
      const result = await api("/api/admin/users/approve", { method: "POST", body: JSON.stringify({ user_id: target.dataset.approve }) });
      await refreshAdmin();
      showNotice(`用户已通过：${provisioningSummary(result.provisioning)}`);
    }
    if (target.dataset.retryProvision) {
      const result = await api("/api/admin/users/provision/retry", {
        method: "POST",
        body: JSON.stringify({ user_id: target.dataset.retryProvision }),
      });
      await refreshAdmin();
      showNotice(`重试完成：${provisioningSummary(result.provisioning)}`);
    }
    if (target.dataset.reconcileUser) {
      const result = await api("/api/admin/users/reconcile", {
        method: "POST",
        body: JSON.stringify({ user_id: target.dataset.reconcileUser, apply: true }),
      });
      await refreshAdmin();
      showNotice(`对账完成：${provisioningSummary(result.reconcile)}`);
    }
    if (target.dataset.status) {
      await api("/api/admin/users/status", {
        method: "POST",
        body: JSON.stringify({ user_id: target.dataset.status, status: target.dataset.value }),
      });
      await refreshAdmin();
      showNotice("用户状态已更新");
    }
    if (target.dataset.deletePlan) {
      if (!window.confirm("确定删除这个套餐吗？")) return;
      await api("/api/admin/plans/delete", {
        method: "POST",
        body: JSON.stringify({ id: target.dataset.deletePlan }),
      });
      await refreshAdmin();
      showNotice("套餐已删除");
    }
    if (target.dataset.deletePanel) {
      if (!window.confirm("确定删除这个面板吗？")) return;
      await api("/api/admin/panels/delete", {
        method: "POST",
        body: JSON.stringify({ id: target.dataset.deletePanel }),
      });
      await refreshAdmin();
      showNotice("面板已删除");
    }
    if (target.dataset.deleteNode) {
      if (!window.confirm("确定删除这个节点吗？")) return;
      await api("/api/admin/nodes/delete", {
        method: "POST",
        body: JSON.stringify({ id: target.dataset.deleteNode }),
      });
      await refreshAdmin();
      showNotice("节点已删除");
    }
    if (target.dataset.testPanel) {
      const result = await api("/api/admin/panels/test", {
        method: "POST",
        body: JSON.stringify({ panel_id: target.dataset.testPanel }),
      });
      showNotice(`面板连接正常：${result.inbound_count || 0} 个入站`);
    }
    if (target.dataset.fetchInbounds) {
      const panelId = target.dataset.fetchInbounds === "selected" ? $("#nodePanel").value : target.dataset.fetchInbounds;
      if (target.dataset.fetchInbounds !== "selected") {
        $("#nodePanel").value = panelId;
        setView("nodes");
      }
      const count = await fetchInboundsForPanel(panelId);
      showNotice(`已拉取 ${count} 个入站`);
    }
    if (target.dataset.editPlan) {
      const plan = state.plans.find((item) => String(item.id) === target.dataset.editPlan);
      setFormMode(
        $("#planForm"),
        $("#planFormTitle"),
        $("#planSubmitBtn"),
        "套餐",
        { ...plan, quota_gb: quotaGb(plan), allowed_tags: plan.allowed_tags || [] },
      );
      setView("settings");
    }
    if (target.dataset.editPanel) {
      const panel = state.panels.find((item) => String(item.id) === target.dataset.editPanel);
      setFormMode($("#panelForm"), $("#panelFormTitle"), $("#panelSubmitBtn"), " X-UI 面板", panel);
      $("#panelPasswordHelp").textContent = panel.has_password ? "已保存密码；留空会继续使用原密码，输入新密码才会替换。" : "当前没有保存密码，请填写面板密码。";
      setView("settings");
    }
    if (target.dataset.editNode) {
      fillForm($("#nodeForm"), state.nodes.find((item) => String(item.id) === target.dataset.editNode));
      setView("nodes");
    }
  });
}

async function boot() {
  bindEvents();
  resetPlanForm();
  resetPanelForm();
  resetNodeForm();
  await refreshPublic();
  await refreshMe();
  setView("account");
}

boot().catch((error) => showNotice(error.message));
