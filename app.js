const incomeCategories = ["房租", "押金", "其他收入"];
const expenseCategories = ["水电费", "维修", "保洁", "中介", "网络", "物业费", "其他支出"];
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthISO = () => new Date().toISOString().slice(0, 7);
const money = value => "¥" + Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let state = defaultState();
let charts = {};
let confirmHandler = null;
let authenticated = false;

function defaultState() {
  return {
    rooms: [],
    ledger: [],
    settings: { theme: "light" },
    backupAt: null,
    updatedAt: new Date().toISOString()
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    if (response.status === 401) { authenticated = false; showLogin(); }
    throw new Error(payload.error || "服务器请求失败");
  }
  return payload;
}

// ========== 登录界面 ==========

function ensureLoginUi() {
  if (document.getElementById("loginOverlay")) return;
  const style = document.createElement("style");
  style.textContent = `
    .login-overlay { position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;padding:22px;background:rgba(5,8,13,.58);backdrop-filter:blur(14px); }
    .login-overlay.show { display:flex; }
    .login-panel { width:min(420px,100%);border:1px solid var(--line);border-radius:16px;background:var(--panel-solid);box-shadow:var(--shadow);padding:28px; }
    .login-panel h2 { margin:0;font-size:22px; }
    .login-panel p { margin:8px 0 20px;color:var(--muted);line-height:1.55;font-size:14px; }
    .login-panel form { display:grid;gap:12px; }
    .login-panel .field { width:100%; }
    .login-panel .btn { width:100%; }
    .login-error { color:var(--danger);font-size:13px;display:none; }
    .logout-btn { min-width:68px; }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.className = "login-overlay";
  overlay.id = "loginOverlay";
  overlay.innerHTML = `
    <div class="login-panel">
      <h2>偶域 · 私有访问</h2>
      <p>请输入访问密码。登录后查看和维护房源、租客与记账数据。</p>
      <form id="loginForm">
        <input class="field" id="loginPassword" type="password" autocomplete="current-password" required placeholder="请输入密码">
        <span class="login-error" id="loginError">密码不正确</span>
        <button class="btn primary" type="submit">进入系统</button>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const logout = document.createElement("button");
  logout.className = "btn logout-btn";
  logout.id = "logoutBtn";
  logout.textContent = "退出";
  document.querySelector(".top-actions").prepend(logout);

  document.getElementById("loginForm").addEventListener("submit", withBusy(async event => {
    event.preventDefault();
    document.getElementById("loginError").style.display = "none";
    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ password: document.getElementById("loginPassword").value })
      });
      authenticated = true;
      hideLogin();
      document.getElementById("loginPassword").value = "";
      await loadStateFromServer();
      toast("登录成功");
    } catch {
      document.getElementById("loginError").style.display = "block";
      document.getElementById("loginPassword").value = "";
    }
  }));

  document.getElementById("logoutBtn").addEventListener("click", withBusy(async () => {
    await api("/api/logout", { method: "POST" });
    authenticated = false;
    state = defaultState();
    renderAll();
    showLogin();
    toast("已退出登录");
  }));
}

function showLogin() {
  ensureLoginUi();
  document.getElementById("loginOverlay").classList.add("show");
  document.getElementById("logoutBtn").style.display = "none";
  setTimeout(() => document.getElementById("loginPassword")?.focus(), 100);
}

function hideLogin() {
  document.getElementById("loginOverlay")?.classList.remove("show");
  document.getElementById("logoutBtn").style.display = "";
}

async function checkLogin() {
  ensureLoginUi();
  try {
    const me = await api("/api/me");
    authenticated = Boolean(me.authenticated);
    if (!authenticated) { showLogin(); return false; }
    hideLogin();
    return true;
  } catch {
    showLogin();
    return false;
  }
}

async function loadStateFromServer() {
  state = { ...defaultState(), ...(await api("/api/state")) };
  renderAll();
}

async function refreshFromPayload(payload, message) {
  state = { ...defaultState(), ...(payload.state || await api("/api/state")) };
  renderAll();
  if (message) toast(message);
}

async function saveRoom(room, message) {
  const payload = await api(`/api/rooms/${encodeURIComponent(room.id)}`, {
    method: "PUT",
    body: JSON.stringify(room)
  });
  await refreshFromPayload(payload, message);
}

async function deleteRoom(id) {
  const payload = await api(`/api/rooms/${encodeURIComponent(id)}`, { method: "DELETE" });
  await refreshFromPayload(payload, "房源已删除");
}

async function saveLedger(item, message) {
  // 如果是房租收入，同步更新房源的上次收租日期
  if (item.type === "income" && item.category === "房租" && item.roomId && item.date) {
    const room = state.rooms.find(r => r.id === item.roomId);
    if (room) {
      room.lastRentDate = item.date;
      await saveRoom(room); // 先保存房源
    }
  }
  const payload = await api(`/api/ledger/${encodeURIComponent(item.id)}`, {
    method: "PUT",
    body: JSON.stringify(item)
  });
  await refreshFromPayload(payload, message);
}

async function deleteLedgerAndUpdateRoom(id) {
  const item = state.ledger.find(l => l.id === id);
  if (item && item.type === "income" && item.category === "房租" && item.roomId) {
    const room = state.rooms.find(r => r.id === item.roomId);
    if (room && room.lastRentDate === item.date) {
      // 回退：找到这个房源的上一条房租记录
      const prevRent = state.ledger
        .filter(l => l.id !== id && l.roomId === item.roomId && l.type === "income" && l.category === "房租")
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
      room.lastRentDate = prevRent?.date || "";
      await saveRoom(room);
    }
  }
  const payload = await api(`/api/ledger/${encodeURIComponent(id)}`, { method: "DELETE" });
  await refreshFromPayload(payload, "记账已删除");
}

async function deleteLedger(id) {
  const payload = await api(`/api/ledger/${encodeURIComponent(id)}`, { method: "DELETE" });
  await refreshFromPayload(payload, "记账已删除");
}

async function saveSettings(settings, message) {
  const payload = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
  await refreshFromPayload(payload, message);
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.getElementById("toastStack").appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function withBusy(task) {
  return async (...args) => {
    try {
      await task(...args);
    } catch (error) {
      toast(error.message || "操作失败");
    }
  };
}

function openModal(id) {
  document.getElementById(id).classList.add("show");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("show");
}

function askConfirm(title, text, handler) {
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmText").textContent = text;
  confirmHandler = handler;
  openModal("confirmModal");
}

function setPage(page) {
  document.querySelectorAll(".page").forEach(node => node.classList.remove("active"));
  document.getElementById("page-" + page).classList.add("active");
  document.querySelectorAll("#nav button").forEach(btn => btn.classList.toggle("active", btn.dataset.page === page));
  document.getElementById("sidebar").classList.remove("open");
  renderAll();
}

function daysUntil(dateString) {
  if (!dateString) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(dateString + "T00:00:00");
  return Math.ceil((end - start) / 86400000);
}

// ========== 收租周期计算 ==========

function getCycleDays(cycle) {
  const m = String(cycle || "1个月").match(/(\d+)/);
  return (m ? parseInt(m[1]) : 1) * 30;
}

function getRentStatus(room) {
  if (room.status === "空置" || !room.rentPrice) {
    return { label: room.status === "空置" ? "空置" : "待设置", daysOverdue: -999, nextDue: "-", overduePeriods: 0, cycleLabel: room.rentCycle||"1个月" };
  }
  const cycle = getCycleDays(room.rentCycle);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // 基准日期：上次收租日
  const baseStr = room.lastRentDate || room.startDate;
  if (!baseStr) return { label: "待记录收租", daysOverdue: 0, nextDue: "-", overduePeriods: 0, cycleLabel: room.rentCycle||"1个月" };

  // 简单算法：从上次收租日开始，不断加周期，直到超过今天
  let nextDue = new Date(baseStr + "T00:00:00");
  let lastDue = new Date(nextDue);

  // nextDue 往前滚动到超过今天
  while (nextDue <= today) {
    lastDue = new Date(nextDue);
    nextDue.setDate(nextDue.getDate() + cycle);
  }

  // 上次应收日 = nextDue - 一个周期
  lastDue = new Date(nextDue);
  lastDue.setDate(lastDue.getDate() - cycle);

  // 逾期天数 = 今天 - 上次应收日
  const daysOverdue = Math.floor((today - lastDue) / 86400000);
  const overduePeriods = daysOverdue > 0 ? Math.floor(daysOverdue / cycle) + 1 : 0;

  let label;
  if (overduePeriods >= 1) {
    label = `已逾期${overduePeriods}期`;
  } else if (daysOverdue > 0) {
    label = `逾期${daysOverdue}天`;
  } else if (daysOverdue > -7) {
    label = `${Math.abs(daysOverdue)}天后收租`;
  } else {
    label = "正常";
  }

  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  return {
    label,
    daysOverdue,
    overduePeriods,
    nextDue: fmt(nextDue),
    lastDue: fmt(lastDue),
    cycle,
    cycleLabel: room.rentCycle || "1个月",
  };
}

function sameMonth(date, month) {
  return date && date.slice(0, 7) === month;
}

function roomStatusClass(status) {
  return status === "已出租" ? "rented" : status === "即将到期" ? "expiring" : "vacant";
}

function getDashboardMonth() {
  return document.getElementById("dashboardMonth").value || monthISO();
}

function getLedgerRows() {
  const month = document.getElementById("ledgerMonth").value;
  const type = document.getElementById("ledgerTypeFilter").value;
  const category = document.getElementById("ledgerCategoryFilter").value;
  const query = document.getElementById("quickSearch").value.trim().toLowerCase();
  return state.ledger.filter(item => {
    const room = state.rooms.find(r => r.id === item.roomId);
    const haystack = [item.category, item.note, room?.name, room?.address].join(" ").toLowerCase();
    return (!month || sameMonth(item.date, month))
      && (!type || item.type === type)
      && (!category || item.category === category)
      && (!query || haystack.includes(query));
  }).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

function calcLedger(rows) {
  const income = rows.filter(i => i.type === "income").reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const expense = rows.filter(i => i.type === "expense").reduce((sum, i) => sum + Number(i.amount || 0), 0);
  return { income, expense, profit: income - expense };
}

function reminderData() {
  const rentOverdue = [];     // 收租逾期
  const rentDueSoon = [];     // 7天内应收
  const contractExpiring = [];// 合同到期
  const contractOverdue = []; // 合同已过期
  const vacant = [];          // 空置

  state.rooms.forEach(room => {
    if (room.status === "空置") { vacant.push(room); return; }

    // 合同到期检查
    const contractDays = daysUntil(room.endDate);
    if (contractDays !== null) {
      if (contractDays < 0) contractOverdue.push({ room, days: Math.abs(contractDays) });
      else if (contractDays <= 30) contractExpiring.push({ room, days: contractDays });
    }

    // 收租状态
    if (room.rentPrice > 0) {
      const rs = getRentStatus(room);
      if (rs.overduePeriods >= 1) rentOverdue.push({ room, status: rs });
      else if (rs.daysOverdue > -7) rentDueSoon.push({ room, status: rs });
    }
  });

  return { rentOverdue, rentDueSoon, contractExpiring, contractOverdue, vacant };
}

function renderDashboard() {
  const month = getDashboardMonth();
  const monthRows = state.ledger.filter(i => sameMonth(i.date, month));
  const yearRows = state.ledger.filter(i => i.date && i.date.slice(0, 4) === month.slice(0, 4));
  const m = calcLedger(monthRows);
  const y = calcLedger(yearRows);
  const reminders = reminderData();

  // 计算本月应收总额
  const rented = state.rooms.filter(r => r.status === "已出租" && r.rentPrice > 0);
  // 简化：所有已出租房源当月应收
  const monthlyCost = rented.reduce((s, r) => s + (r.costRent||0) / (parseInt(r.costCycle)||1), 0);
  const monthlyIncome = rented.reduce((s, r) => s + (r.rentPrice||0) / (parseInt(r.rentCycle)||1), 0);
  const monthlyNet = monthlyIncome - monthlyCost;
  document.getElementById("totalRooms").textContent = state.rooms.length;
  document.getElementById("rentedRooms").textContent = rented.length;
  document.getElementById("vacantRooms").textContent = reminders.vacant.length;
  document.getElementById("expiringRooms").textContent = reminders.rentOverdue.length + reminders.rentDueSoon.length;
  document.getElementById("monthIncome").textContent = money(m.income);
  document.getElementById("monthExpense").textContent = money(m.expense);
  document.getElementById("monthProfit").textContent = money(monthlyNet);
  document.getElementById("yearProfit").textContent = money(y.profit);
  document.getElementById("sideProfit").textContent = money(monthlyNet);

  // 更新统计卡片标题
  document.querySelector("#page-dashboard .stats .stat-card:nth-child(3) .stat-label span").textContent = "拿房成本";
  document.querySelector("#page-dashboard .stats .stat-card:nth-child(4) .stat-label span").textContent = "月净利润";

  // 计算欠租总额
  let totalArrears = 0;
  reminders.rentOverdue.forEach(({ room, status }) => {
    totalArrears += room.rentPrice * (status.overduePeriods + 1);
  });
  document.getElementById("expiringRooms").title = `欠租总额: ¥${totalArrears.toLocaleString()}`;

  renderCashflowChart(month.slice(0, 4));
  renderDashboardAlerts();
}

function renderCashflowChart(year) {
  const labels = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0") + "月");
  const income = Array(12).fill(0);
  const expense = Array(12).fill(0);
  state.ledger.forEach(item => {
    if (!item.date || item.date.slice(0, 4) !== year) return;
    const index = Number(item.date.slice(5, 7)) - 1;
    if (item.type === "income") income[index] += Number(item.amount || 0);
    if (item.type === "expense") expense[index] += Number(item.amount || 0);
  });
  drawChart("cashflowChart", "bar", {
    labels,
    datasets: [
      { label: "收入", data: income, backgroundColor: "rgba(5,150,105,.72)", borderRadius: 8 },
      { label: "支出", data: expense, backgroundColor: "rgba(220,38,38,.62)", borderRadius: 8 }
    ]
  });
}

function renderDashboardAlerts() {
  const box = document.getElementById("dashboardAlerts");
  const data = reminderData();
  const rows = [
    ...data.rentOverdue.map(({ room, status }) => ({
      title: room.name + ` 收租逾期${status.overduePeriods}期`,
      text: `每${status.cycleLabel}应收 ${money(room.rentPrice)}，上次收租: ${room.lastRentDate || "未记录"}。租客: ${room.tenantName || "未填写"}`,
      danger: true
    })),
    ...data.rentDueSoon.map(({ room, status }) => ({
      title: room.name + ` ${Math.abs(status.daysOverdue)}天后收租`,
      text: `下次应收: ${status.nextDue}，每${status.cycleLabel} ¥${room.rentPrice}`,
      danger: false
    })),
    ...data.contractExpiring.map(x => ({
      title: x.room.name + ` 合同${x.days}天后到期`,
      text: `到期日: ${x.room.endDate}，请提前沟通续租`,
      danger: x.days <= 7
    })),
    ...data.contractOverdue.map(x => ({
      title: x.room.name + ` 合同已过期${x.days}天`,
      text: `到期日: ${x.room.endDate}，租客: ${x.room.tenantName || "未填写"}`,
      danger: true
    }))
  ].slice(0, 6);
  box.innerHTML = rows.length ? rows.map(alertTemplate).join("") : `<div class="empty">当前没有紧急提醒 ✓</div>`;
}

function alertTemplate(item) {
  return `<div class="alert ${item.danger ? "danger" : ""}"><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.text)}</span></div>`;
}

function renderRooms() {
  const query = (document.getElementById("roomSearch").value + " " + document.getElementById("quickSearch").value).trim().toLowerCase();
  const status = document.getElementById("roomStatusFilter").value;
  const rows = state.rooms.filter(room => {
    const haystack = [room.name, room.address, room.tenantName, room.tenantPhone, room.note].join(" ").toLowerCase();
    return (!status || room.status === status) && (!query || haystack.includes(query));
  });
  const grid = document.getElementById("roomsGrid");
  grid.innerHTML = rows.length ? rows.map(room => {
    const rentStatus = getRentStatus(room);
    const statusBadge = room.status === "空置" ? "vacant"
      : rentStatus.daysOverdue > 0 ? "danger"
      : rentStatus.daysOverdue > -7 ? "expiring"
      : "rented";
    const monthlyCost = room.costRent ? Math.round(room.costRent / (parseInt(room.costCycle)||1)) : 0;
    const monthlyIncome = room.rentPrice ? Math.round(room.rentPrice / (parseInt(room.rentCycle)||1)) : 0;
    const monthlyProfit = monthlyIncome - monthlyCost;
    return `
    <article class="card room-card">
      <div class="room-top">
        <div><h3>${escapeHTML(room.name)}</h3><p>${escapeHTML(room.address || "未填写地址")}</p></div>
        <span class="badge ${statusBadge}">${rentStatus.label}</span>
      </div>
      <div class="room-meta">
        <div class="meta"><span>📤 出租</span><strong>${money(room.rentPrice)}/${room.rentCycle||"1个月"}</strong></div>
        <div class="meta"><span>📥 拿房</span><strong>${money(room.costRent)}/${room.costCycle||"1个月"}</strong></div>
        <div class="meta"><span>💰 月利润</span><strong style="color:${monthlyProfit>=0?'var(--success)':'var(--danger)'}">${money(monthlyProfit)}</strong></div>
        <div class="meta"><span>上次收租</span><strong>${room.lastRentDate || "未记录"}</strong></div>
        <div class="meta"><span>下次应收</span><strong>${rentStatus.nextDue || "-"}</strong></div>
        <div class="meta"><span>合同到期</span><strong>${room.endDate || "未填写"}</strong></div>
      </div>
      <div class="row-actions">
        <button class="btn" data-edit-room="${room.id}">编辑</button>
        <button class="btn primary" data-add-rent="${room.id}">收租</button>
        <button class="btn danger" data-delete-room="${room.id}">删除</button>
      </div>
    </article>
  `}).join("") : `<div class="empty" style="grid-column:1/-1">还没有房源。点击"新增房源"开始录入。</div>`;
}

function renderLedger() {
  syncCategoryFilter();
  const rows = getLedgerRows();
  const total = calcLedger(rows);
  document.getElementById("ledgerIncome").textContent = money(total.income);
  document.getElementById("ledgerExpense").textContent = money(total.expense);
  document.getElementById("ledgerProfit").textContent = money(total.profit);
  document.getElementById("ledgerCount").textContent = rows.length;
  document.getElementById("ledgerTable").innerHTML = rows.length ? rows.map(item => {
    const room = state.rooms.find(r => r.id === item.roomId);
    return `<tr>
      <td>${item.date || ""}</td>
      <td><span class="badge ${item.type === "income" ? "income" : "expense"}">${item.type === "income" ? "收入" : "支出"}</span></td>
      <td>${escapeHTML(item.category)}</td>
      <td>${escapeHTML(room?.name || "未关联")}</td>
      <td><strong>${money(item.amount)}</strong></td>
      <td>${escapeHTML(item.note || "")}</td>
      <td class="row-actions"><button class="btn" data-edit-ledger="${item.id}">编辑</button><button class="btn danger" data-delete-ledger="${item.id}">删除</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="7"><div class="empty">暂无记账记录。</div></td></tr>`;
  renderCategoryChart(rows);
}

function renderCategoryChart(rows) {
  const map = {};
  rows.forEach(item => map[item.category] = (map[item.category] || 0) + Number(item.amount || 0));
  drawChart("categoryChart", "doughnut", {
    labels: Object.keys(map).length ? Object.keys(map) : ["暂无数据"],
    datasets: [{ data: Object.keys(map).length ? Object.values(map) : [1], backgroundColor: ["#2563eb", "#059669", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#4b5563"] }]
  });
}

function drawChart(id, type, data) {
  const canvas = document.getElementById(id);
  if (!canvas || !window.Chart) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas, {
    type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: getComputedStyle(document.body).getPropertyValue("--muted") } } },
      scales: type === "doughnut" ? {} : {
        x: { ticks: { color: getComputedStyle(document.body).getPropertyValue("--muted") }, grid: { color: "rgba(120,120,120,.12)" } },
        y: { ticks: { color: getComputedStyle(document.body).getPropertyValue("--muted") }, grid: { color: "rgba(120,120,120,.12)" } }
      }
    }
  });
}

function renderReminders() {
  const data = reminderData();
  document.getElementById("due7Count").textContent = data.rentDueSoon.length;
  document.getElementById("due30Count").textContent = data.contractExpiring.length;
  document.getElementById("rentDueCount").textContent = data.rentOverdue.length;
  document.getElementById("reminderVacantCount").textContent = data.vacant.length;

  // 收租提醒
  const rentRows = [
    ...data.rentOverdue.map(({ room, status }) => ({
      title: `⚠️ ${room.name} 收租逾期${status.overduePeriods}期`,
      text: `每${status.cycleLabel}应收 ${money(room.rentPrice)}，上次收租: ${room.lastRentDate || "未记录"}。租客: ${room.tenantName || "未填写"}，电话: ${room.tenantPhone || "-"}`,
      danger: true
    })),
    ...data.rentDueSoon.map(({ room, status }) => ({
      title: `📅 ${room.name} ${Math.abs(status.daysOverdue)}天后收租`,
      text: `下次应收: ${status.nextDue}，每${status.cycleLabel} ¥${room.rentPrice}。租客: ${room.tenantName || "未填写"}`,
      danger: false
    }))
  ];

  document.getElementById("expiryAlerts").innerHTML = rentRows.length
    ? rentRows.map(alertTemplate).join("")
    : `<div class="empty">所有房源收租正常 ✓</div>`;

  // 合同 & 空置提醒
  const otherRows = [
    ...data.contractOverdue.map(x => ({
      title: `📋 ${x.room.name} 合同已过期${x.days}天`,
      text: `到期日: ${x.room.endDate}，租客: ${x.room.tenantName || "未填写"}，电话: ${x.room.tenantPhone || "-"}`,
      danger: true
    })),
    ...data.contractExpiring.map(x => ({
      title: `📋 ${x.room.name} 合同${x.days}天后到期`,
      text: `到期日: ${x.room.endDate}，建议提前沟通续租或退租`,
      danger: x.days <= 7
    })),
    ...data.vacant.map(room => ({
      title: `🏠 ${room.name} 当前空置`,
      text: `${room.address || "未填写地址"}，周期收租: ${money(room.rentPrice)}/${room.rentCycle||"1个月"}`,
      danger: false
    }))
  ];
  document.getElementById("rentAlerts").innerHTML = otherRows.length
    ? otherRows.map(alertTemplate).join("")
    : `<div class="empty">无合同或空置提醒 ✓</div>`;
}

function renderBackup() {
  const text = state.backupAt ? `最近服务器备份：${new Date(state.backupAt).toLocaleString("zh-CN")}。每次保存数据后会自动更新备份。` : "暂无服务器备份记录。";
  document.getElementById("backupInfo").textContent = text;
}

function renderAll() {
  applyTheme();
  renderDashboard();
  renderRooms();
  renderLedger();
  renderReminders();
  renderBackup();
  fillRoomOptions();
}

function openRoomForm(room) {
  document.getElementById("roomModalTitle").textContent = room ? "编辑房源" : "新增房源";
  document.getElementById("roomId").value = room?.id || "";
  document.getElementById("roomName").value = room?.name || "";
  document.getElementById("roomAddress").value = room?.address || "";
  // 拿房成本
  document.getElementById("roomCostRent").value = room?.costRent || "";
  document.getElementById("roomCostCycle").value = room?.costCycle || "1个月";
  document.getElementById("roomCostDeposit").value = room?.costDeposit || "";
  document.getElementById("roomCostDate").value = room?.costDate || "";
  // 出租收入
  document.getElementById("roomRentPrice").value = room?.rentPrice || room?.rentPrice || "";
  document.getElementById("roomRentCycle").value = room?.rentCycle || "1个月";
  document.getElementById("roomTenantDeposit").value = room?.tenantDeposit || room?.deposit || "";
  document.getElementById("roomLastRentDate").value = room?.lastRentDate || "";
  // 基本信息
  document.getElementById("roomStatus").value = room?.status || "空置";
  document.getElementById("tenantName").value = room?.tenantName || "";
  document.getElementById("tenantPhone").value = room?.tenantPhone || "";
  document.getElementById("startDate").value = room?.startDate || "";
  document.getElementById("endDate").value = room?.endDate || "";
  document.getElementById("roomNote").value = room?.note || "";
  openModal("roomModal");
}

function openLedgerForm(item, preset = {}) {
  document.getElementById("ledgerModalTitle").textContent = item ? "编辑记账" : "记一笔";
  document.getElementById("ledgerId").value = item?.id || "";
  document.getElementById("ledgerDate").value = item?.date || preset.date || todayISO();
  document.getElementById("ledgerType").value = item?.type || preset.type || "income";
  fillLedgerCategories(item?.category || preset.category);
  fillRoomOptions(item?.roomId || preset.roomId);
  document.getElementById("ledgerAmount").value = item?.amount || preset.amount || "";
  document.getElementById("ledgerNote").value = item?.note || preset.note || "";
  openModal("ledgerModal");
}

function fillLedgerCategories(selected) {
  const type = document.getElementById("ledgerType").value;
  const list = type === "income" ? incomeCategories : expenseCategories;
  document.getElementById("ledgerCategory").innerHTML = list.map(c => `<option ${c === selected ? "selected" : ""}>${c}</option>`).join("");
}

function syncCategoryFilter() {
  const selected = document.getElementById("ledgerCategoryFilter").value;
  const list = [...incomeCategories, ...expenseCategories];
  document.getElementById("ledgerCategoryFilter").innerHTML = `<option value="">全部分类</option>` + list.map(c => `<option ${c === selected ? "selected" : ""}>${c}</option>`).join("");
}

function fillRoomOptions(selected) {
  const options = `<option value="">未关联</option>` + state.rooms.map(r => `<option value="${r.id}" ${r.id === selected ? "selected" : ""}>${escapeHTML(r.name)}</option>`).join("");
  document.getElementById("ledgerRoom").innerHTML = options;
}

function exportFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCSV() {
  const rows = getLedgerRows();
  const header = ["日期", "类型", "分类", "房源", "金额", "备注"];
  const body = rows.map(item => {
    const room = state.rooms.find(r => r.id === item.roomId);
    return [item.date, item.type === "income" ? "收入" : "支出", item.category, room?.name || "", item.amount, item.note || ""];
  });
  const csv = [header, ...body].map(row => row.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  exportFile(`租房记账-${new Date().toISOString().slice(0,10)}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
  toast("CSV 已导出");
}

function exportJSON() {
  exportFile(`偶域租房管理备份-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(state, null, 2), "application/json");
  toast("JSON 已导出");
}

// ========== Excel 导出导入 ==========

function exportExcel() {
  if (!window.XLSX) { toast("Excel 库未加载"); return; }

  // 房源 Sheet
  const roomHeader = ["房间名称","地址","拿房租金","付款周期","拿房押金","拿房日期","出租价格","收租周期","租客押金","上次收租","状态","租客姓名","联系方式","入住时间","到期时间","备注"];
  const roomRows = state.rooms.map(r => [r.name||"", r.address||"", r.costRent||0, r.costCycle||"", r.costDeposit||0, r.costDate||"", r.rentPrice||0, r.rentCycle||"", r.tenantDeposit||0, r.lastRentDate||"", r.status||"", r.tenantName||"", r.tenantPhone||"", r.startDate||"", r.endDate||"", r.note||""]);
  const roomSheet = XLSX.utils.aoa_to_sheet([roomHeader, ...roomRows]);
  roomSheet["!cols"] = roomHeader.map(() => ({ wch: 14 }));

  // 记账 Sheet
  const ledgerHeader = ["日期","类型","分类","房源","金额","备注"];
  const ledgerRows = state.ledger.map(l => {
    const room = state.rooms.find(r => r.id === l.roomId);
    return [l.date||"", l.type==="income"?"收入":"支出", l.category||"", room?.name||"", l.amount||0, l.note||""];
  });
  const ledgerSheet = XLSX.utils.aoa_to_sheet([ledgerHeader, ...ledgerRows]);
  ledgerSheet["!cols"] = ledgerHeader.map(() => ({ wch: 14 }));

  // 汇总 Sheet
  const summaryRows = [
    ["汇总项","数值"],
    ["总房源数", state.rooms.length],
    ["已出租", state.rooms.filter(r=>r.status==="已出租").length],
    ["空置", state.rooms.filter(r=>r.status==="空置").length],
    ["记账总数", state.ledger.length],
    ["总收入", state.ledger.filter(l=>l.type==="income").reduce((s,l)=>s+Number(l.amount||0),0)],
    ["总支出", state.ledger.filter(l=>l.type==="expense").reduce((s,l)=>s+Number(l.amount||0),0)],
    ["导出时间", new Date().toLocaleString("zh-CN")],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 18 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, roomSheet, "房源");
  XLSX.utils.book_append_sheet(wb, ledgerSheet, "记账");
  XLSX.utils.book_append_sheet(wb, summarySheet, "汇总");

  XLSX.writeFile(wb, `偶域租房管理-${new Date().toISOString().slice(0,10)}.xlsx`);
  toast("Excel 已导出");
}

function excelToState(wb) {
  const rooms = [];
  const ledger = [];

  // 读房源 Sheet
  const roomSheet = wb.Sheets["房源"] || wb.Sheets[wb.SheetNames[0]];
  if (roomSheet) {
    const rows = XLSX.utils.sheet_to_json(roomSheet, { header: 1 });
    if (rows.length > 1) {
      const header = rows[0].map(h => String(h||"").trim());
      const idx = (name) => header.findIndex(h => h.includes(name));
      const iName = idx("房间名称"), iAddr = idx("地址");
      const iCostRent = idx("拿房租金"), iCostCycle = idx("付款周期"), iCostDep = idx("拿房押金"), iCostDate = idx("拿房日期");
      const iRentPrice = idx("出租价格"), iRentCycle = idx("收租周期"), iTenantDep = idx("租客押金"), iLastRent = idx("上次收租");
      const iStatus = idx("状态"), iTName = idx("租客姓名"), iPhone = idx("联系方式");
      const iStart = idx("入住"), iEnd = idx("到期"), iNote = idx("备注");

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r.some(c => c)) continue;
        rooms.push({
          id: uid(),
          name: String(r[iName>=0?iName:0]||""),
          address: String(r[iAddr>=0?iAddr:1]||""),
          costRent: Number(r[iCostRent>=0?iCostRent:2]||0),
          costCycle: String(r[iCostCycle>=0?iCostCycle:3]||"1个月"),
          costDeposit: Number(r[iCostDep>=0?iCostDep:4]||0),
          costDate: String(r[iCostDate>=0?iCostDate:5]||""),
          rentPrice: Number(r[iRentPrice>=0?iRentPrice:6]||0),
          rentCycle: String(r[iRentCycle>=0?iRentCycle:7]||"1个月"),
          tenantDeposit: Number(r[iTenantDep>=0?iTenantDep:8]||0),
          lastRentDate: String(r[iLastRent>=0?iLastRent:9]||""),
          status: String(r[iStatus>=0?iStatus:10]||"空置"),
          tenantName: String(r[iTName>=0?iTName:11]||""),
          tenantPhone: String(r[iPhone>=0?iPhone:12]||""),
          startDate: String(r[iStart>=0?iStart:13]||""),
          endDate: String(r[iEnd>=0?iEnd:14]||""),
          note: String(r[iNote>=0?iNote:15]||""),
        });
      }
    }
  }

  // 读记账 Sheet
  const ledgerSheet = wb.Sheets["记账"];
  if (ledgerSheet) {
    const rows = XLSX.utils.sheet_to_json(ledgerSheet, { header: 1 });
    if (rows.length > 1) {
      const header = rows[0].map(h => String(h||"").trim());
      const idx = (name) => header.findIndex(h => h.includes(name));
      const iDate = idx("日期"), iType = idx("类型"), iCat = idx("分类"), iRoom = idx("房源");
      const iAmt = idx("金额"), iNote = idx("备注");

      // 构建房源名称→ID 映射
      const roomMap = {};
      rooms.forEach(r => { roomMap[r.name] = r.id; });

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r.some(c => c)) continue;
        const typeStr = String(r[iType>=0?iType:1]||"");
        const roomName = String(r[iRoom>=0?iRoom:3]||"");
        ledger.push({
          id: uid(),
          date: String(r[iDate>=0?iDate:0]||""),
          type: typeStr.includes("支出") ? "expense" : "income",
          category: String(r[iCat>=0?iCat:2]||""),
          roomId: roomMap[roomName] || "",
          amount: Number(r[iAmt>=0?iAmt:4]||0),
          note: String(r[iNote>=0?iNote:5]||""),
        });
      }
    }
  }

  return { rooms, ledger, settings: state.settings };
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme || "light";
}

document.getElementById("dashboardMonth").value = monthISO();
document.getElementById("ledgerMonth").value = monthISO();

document.getElementById("nav").addEventListener("click", event => {
  const btn = event.target.closest("button[data-page]");
  if (btn) setPage(btn.dataset.page);
});

document.body.addEventListener("click", event => {
  const go = event.target.closest("[data-go]");
  if (go) setPage(go.dataset.go);
  const close = event.target.closest("[data-close]");
  if (close) closeModal(close.dataset.close);
  const editRoom = event.target.closest("[data-edit-room]");
  if (editRoom) openRoomForm(state.rooms.find(r => r.id === editRoom.dataset.editRoom));
  const deleteRoomButton = event.target.closest("[data-delete-room]");
  if (deleteRoomButton) askConfirm("删除房源", "删除房源会同时保留历史记账，但房源关联会显示为未关联。确定删除吗？", withBusy(() => deleteRoom(deleteRoomButton.dataset.deleteRoom)));
  const addRent = event.target.closest("[data-add-rent]");
  if (addRent) {
    const room = state.rooms.find(r => r.id === addRent.dataset.addRent);
    const rs = getRentStatus(room);
    const periodLabel = rs.overduePeriods >= 1 ? `（补${rs.overduePeriods+1}期）` : "";
    openLedgerForm(null, { type: "income", category: "房租", roomId: room.id, amount: room.rentPrice * (rs.overduePeriods >= 1 ? rs.overduePeriods + 1 : 1), note: `${room.name} ${room.rentCycle||"1个月"}房租${periodLabel}` });
  }
  const editLedger = event.target.closest("[data-edit-ledger]");
  if (editLedger) openLedgerForm(state.ledger.find(i => i.id === editLedger.dataset.editLedger));
  const deleteLedgerButton = event.target.closest("[data-delete-ledger]");
  if (deleteLedgerButton) askConfirm("删除记账", "这条收支记录删除后不可恢复，确定继续吗？", withBusy(() => deleteLedgerAndUpdateRoom(deleteLedgerButton.dataset.deleteLedger)));
});

document.getElementById("mobileMenu").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
document.getElementById("quickRoomBtn").addEventListener("click", () => openRoomForm());
document.getElementById("addRoomBtn").addEventListener("click", () => openRoomForm());
document.getElementById("quickLedgerBtn").addEventListener("click", () => openLedgerForm());
document.getElementById("addLedgerBtn").addEventListener("click", () => openLedgerForm());
document.getElementById("themeToggle").addEventListener("click", withBusy(async () => {
  await saveSettings({ ...state.settings, theme: state.settings.theme === "dark" ? "light" : "dark" }, "主题已切换");
}));

["quickSearch", "roomSearch", "roomStatusFilter", "dashboardMonth", "ledgerMonth", "ledgerTypeFilter", "ledgerCategoryFilter"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderAll);
  document.getElementById(id).addEventListener("change", renderAll);
});

document.getElementById("roomForm").addEventListener("submit", withBusy(async event => {
  event.preventDefault();
  const id = document.getElementById("roomId").value || uid();
  const room = {
    id,
    name: document.getElementById("roomName").value.trim(),
    address: document.getElementById("roomAddress").value.trim(),
    // 拿房成本
    costRent: Number(document.getElementById("roomCostRent").value || 0),
    costCycle: document.getElementById("roomCostCycle").value || "1个月",
    costDeposit: Number(document.getElementById("roomCostDeposit").value || 0),
    costDate: document.getElementById("roomCostDate").value || "",
    // 出租收入
    rentPrice: Number(document.getElementById("roomRentPrice").value || 0),
    rentCycle: document.getElementById("roomRentCycle").value || "1个月",
    tenantDeposit: Number(document.getElementById("roomTenantDeposit").value || 0),
    lastRentDate: document.getElementById("roomLastRentDate").value || "",
    // 基本信息
    status: document.getElementById("roomStatus").value,
    tenantName: document.getElementById("tenantName").value.trim(),
    tenantPhone: document.getElementById("tenantPhone").value.trim(),
    startDate: document.getElementById("startDate").value,
    endDate: document.getElementById("endDate").value,
    note: document.getElementById("roomNote").value.trim()
  };
  closeModal("roomModal");
  await saveRoom(room, "房源已保存");
}));

document.getElementById("ledgerType").addEventListener("change", () => fillLedgerCategories());
document.getElementById("ledgerForm").addEventListener("submit", withBusy(async event => {
  event.preventDefault();
  const id = document.getElementById("ledgerId").value || uid();
  const item = {
    id,
    date: document.getElementById("ledgerDate").value,
    type: document.getElementById("ledgerType").value,
    category: document.getElementById("ledgerCategory").value,
    roomId: document.getElementById("ledgerRoom").value,
    amount: Number(document.getElementById("ledgerAmount").value || 0),
    note: document.getElementById("ledgerNote").value.trim()
  };
  closeModal("ledgerModal");
  await saveLedger(item, "记账已保存");
}));

document.getElementById("confirmOk").addEventListener("click", () => {
  closeModal("confirmModal");
  if (confirmHandler) confirmHandler();
  confirmHandler = null;
});

document.getElementById("exportCsvBtn").addEventListener("click", exportCSV);
document.getElementById("exportExcelBtn").addEventListener("click", exportExcel);
document.getElementById("manualBackupBtn").addEventListener("click", withBusy(async () => {
  const payload = await api("/api/backup", { method: "POST" });
  await refreshFromPayload(payload, "服务器备份已生成");
}));
document.getElementById("restoreBackupBtn").addEventListener("click", () => {
  if (!state.backupAt) return toast("还没有可恢复的服务器备份");
  askConfirm("恢复最近备份", "当前数据会被最近一次服务器备份替换，确定恢复吗？", withBusy(async () => {
    const payload = await api("/api/backup/restore", { method: "POST" });
    await refreshFromPayload(payload, "备份已恢复");
  }));
});
document.getElementById("clearDataBtn").addEventListener("click", () => {
  askConfirm("清空全部数据", "这会删除服务器里的所有房源和记账数据。建议先导出 JSON 备份。确定清空吗？", withBusy(async () => {
    const payload = await api("/api/clear", { method: "POST" });
    await refreshFromPayload(payload, "数据已清空");
  }));
});
document.getElementById("importExcelInput").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const wb = XLSX.read(reader.result, { type: "array" });
      const imported = excelToState(wb);
      const roomCount = imported.rooms.length;
      const ledgerCount = imported.ledger.length;
      askConfirm("导入 Excel",
        `检测到 ${roomCount} 条房源、${ledgerCount} 条记账记录。导入会覆盖当前数据，确定继续吗？`,
        withBusy(async () => {
          const payload = await api("/api/import", { method: "POST", body: JSON.stringify(imported) });
          await refreshFromPayload(payload, `Excel 导入成功！房源 ${roomCount}、记账 ${ledgerCount}`);
        }));
    } catch (e) {
      toast("Excel 文件格式不正确：" + e.message);
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = "";
});
document.getElementById("refreshReminderBtn").addEventListener("click", withBusy(async () => {
  await loadStateFromServer();
  toast("提醒已刷新");
}));
document.getElementById("seedGuideBtn").addEventListener("click", () => {
  alert('Cloudflare 部署版升级路线\n\n数据存储：所有数据存储在 Cloudflare D1 数据库中，永久保存。\n自定义域名：在 Cloudflare Dashboard 绑定自己的域名。\n安全：可配合 Cloudflare Access 添加访问控制。\n移动端：当前页面已做响应式适配，手机浏览器可直接访问。\n备份：定期使用系统内[导出 JSON]功能下载本地备份。');
});

window.addEventListener("keydown", event => {
  if (event.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach(node => node.classList.remove("show"));
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.getElementById("quickSearch").focus();
  }
});

applyTheme();
fillLedgerCategories();
renderAll();
checkLogin()
  .then(ok => ok ? loadStateFromServer() : null)
  .catch(() => {
    showLogin();
    toast("无法连接服务器");
  });
