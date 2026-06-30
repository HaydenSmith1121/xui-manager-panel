const state = {
  me: null,
  plans: [],
  users: [],
  panels: [],
  nodes: [],
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

function showNotice(message) {
  const box = $("#notice");
  box.textContent = message;
  box.classList.remove("hidden");
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => box.classList.add("hidden"), 3200);
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
  const button = form.querySelector("button");
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
  const [users, plans, panels, nodes] = await Promise.all([
    api("/api/admin/users"),
    api("/api/admin/plans"),
    api("/api/admin/panels"),
    api("/api/admin/nodes"),
  ]);
  state.users = users.users || [];
  state.plans = plans.plans || state.plans;
  state.panels = panels.panels || [];
  state.nodes = nodes.nodes || [];
  renderAdmin();
}

function renderAuth() {
  const loggedIn = Boolean(state.me);
  $("#authPanel").classList.toggle("hidden", loggedIn);
  $("#accountView").classList.toggle("hidden", !loggedIn || state.view !== "account");
  $("#sessionEmail").textContent = loggedIn ? state.me.email : "未登录";
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
      <header><strong>${escapeHtml(panel.name)}</strong><span class="row-actions"><button data-edit-panel="${panel.id}" class="ghost">编辑</button><button data-delete-panel="${panel.id}" class="danger">删除</button></span></header>
      <span class="meta">${escapeHtml(panel.base_url)}</span>
    </article>`)
    .join("");
  $("#nodePanel").innerHTML = `<option value="">不绑定</option>` + state.panels.map((panel) => `<option value="${panel.id}">${escapeHtml(panel.name)}</option>`).join("");
}

function renderNodes() {
  $("#nodeList").innerHTML = state.nodes
    .map((node) => `<article class="row-card">
      <header><strong>${escapeHtml(node.name)}</strong><button data-edit-node="${node.id}" class="ghost">编辑</button></header>
      <span class="meta">入站 ${node.inbound_id || 0} / 倍率 ${node.rate} / 标签: ${escapeHtml((node.tags || []).join(",") || "无")}</span>
      <span class="meta">${escapeHtml(String(node.source_url || "").slice(0, 150))}</span>
    </article>`)
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
  $("#syncUsageBtn").addEventListener("click", async () => {
    const result = await api("/api/admin/sync-usage", { method: "POST", body: "{}" });
    await refreshAdmin();
    showNotice(`同步完成：更新 ${result.updated || 0} 条${result.errors?.length ? "，有错误请检查面板配置" : ""}`);
  });
  $("#copySubBtn").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#subscriptionUrl").value);
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
    await api("/api/admin/plans", { method: "POST", body: JSON.stringify(formData(form)) });
    form.reset();
    await refreshAdmin();
    showNotice("套餐已保存");
  }));

  $("#panelForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    await api("/api/admin/panels", { method: "POST", body: JSON.stringify(formData(form)) });
    form.reset();
    await refreshAdmin();
    showNotice("面板已保存");
  }));

  $("#nodeForm").addEventListener("submit", (event) => withSubmitState(event, async (form) => {
    await api("/api/admin/nodes", { method: "POST", body: JSON.stringify(formData(form)) });
    form.reset();
    form.elements.enabled.checked = true;
    form.elements.rate.value = "1";
    form.elements.inbound_id.value = "0";
    await refreshAdmin();
    showNotice("节点已保存");
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
      await api("/api/admin/users/approve", { method: "POST", body: JSON.stringify({ user_id: target.dataset.approve }) });
      await refreshAdmin();
      showNotice("用户已通过");
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
    if (target.dataset.editPlan) {
      const plan = state.plans.find((item) => String(item.id) === target.dataset.editPlan);
      fillForm($("#planForm"), { ...plan, quota_gb: quotaGb(plan), allowed_tags: plan.allowed_tags || [] });
      $("#planForm").elements.quota_gb.value = quotaGb(plan);
      setView("settings");
    }
    if (target.dataset.editPanel) {
      fillForm($("#panelForm"), state.panels.find((item) => String(item.id) === target.dataset.editPanel));
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
  await refreshPublic();
  await refreshMe();
  setView("account");
}

boot().catch((error) => showNotice(error.message));
