const incomeCategories = ["房租", "押金", "其他收入"];
const expenseCategories = ["水电费", "维修", "保洁", "中介", "网络", "物业费", "其他支出"];
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthISO = () => new Date().toISOString().slice(0, 7);
const money = value => "¥" + Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let state = defaultState();
let charts = {};
let confirmHandler = null;

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
    throw new Error(payload.error || "服务器请求失败");
  }
  return payload;
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
  const payload = await api(`/api/ledger/${encodeURIComponent(item.id)}`, {
    method: "PUT",
    body: JSON.stringify(item)
  });
  await refreshFromPayload(payload, message);
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
  const due7 = [];
  const due30 = [];
  const overdue = [];
  const rentDue = [];
  state.rooms.forEach(room => {
    const d = daysUntil(room.endDate);
    if (room.status !== "空置" && d !== null) {
      if (d < 0) overdue.push({ room, days: d });
      else if (d <= 7) due7.push({ room, days: d });
      else if (d <= 30) due30.push({ room, days: d });
    }
    const month = monthISO();
    const hasRent = state.ledger.some(item => item.roomId === room.id && item.type === "income" && item.category === "房租" && sameMonth(item.date, month));
    if (room.status !== "空置" && Number(room.rent || 0) > 0 && !hasRent) rentDue.push(room);
  });
  return { due7, due30, overdue, rentDue };
}

function renderDashboard() {
  const month = getDashboardMonth();
  const monthRows = state.ledger.filter(i => sameMonth(i.date, month));
  const yearRows = state.ledger.filter(i => i.date && i.date.slice(0, 4) === month.slice(0, 4));
  const m = calcLedger(monthRows);
  const y = calcLedger(yearRows);
  const reminders = reminderData();
  document.getElementById("totalRooms").textContent = state.rooms.length;
  document.getElementById("rentedRooms").textContent = state.rooms.filter(r => r.status === "已出租").length;
  document.getElementById("vacantRooms").textContent = state.rooms.filter(r => r.status === "空置").length;
  document.getElementById("expiringRooms").textContent = reminders.due7.length + reminders.due30.length + reminders.overdue.length;
  document.getElementById("monthIncome").textContent = money(m.income);
  document.getElementById("monthExpense").textContent = money(m.expense);
  document.getElementById("monthProfit").textContent = money(m.profit);
  document.getElementById("yearProfit").textContent = money(y.profit);
  document.getElementById("sideProfit").textContent = money(m.profit);
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
    ...data.overdue.map(x => ({ title: x.room.name + " 已过期", text: `合同已过期 ${Math.abs(x.days)} 天，租客：${x.room.tenantName || "未填写"}`, danger: true })),
    ...data.due7.map(x => ({ title: x.room.name + " 7 天内到期", text: `还有 ${x.days} 天到期，请提前沟通续租或退租。`, danger: true })),
    ...data.due30.map(x => ({ title: x.room.name + " 30 天内到期", text: `还有 ${x.days} 天到期。`, danger: false })),
    ...data.rentDue.map(room => ({ title: room.name + " 本月未记录房租", text: `应收房租 ${money(room.rent)}，可在记账系统补记。`, danger: true }))
  ].slice(0, 5);
  box.innerHTML = rows.length ? rows.map(alertTemplate).join("") : `<div class="empty">当前没有紧急提醒。</div>`;
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
  grid.innerHTML = rows.length ? rows.map(room => `
    <article class="card room-card">
      <div class="room-top">
        <div><h3>${escapeHTML(room.name)}</h3><p>${escapeHTML(room.address || "未填写地址")}</p></div>
        <span class="badge ${roomStatusClass(room.status)}">${room.status}</span>
      </div>
      <div class="room-meta">
        <div class="meta"><span>房租</span><strong>${money(room.rent)}</strong></div>
        <div class="meta"><span>押金</span><strong>${money(room.deposit)}</strong></div>
        <div class="meta"><span>租客</span><strong>${escapeHTML(room.tenantName || "未填写")}</strong></div>
        <div class="meta"><span>到期</span><strong>${room.endDate || "未填写"}</strong></div>
      </div>
      <div class="row-actions">
        <button class="btn" data-edit-room="${room.id}">编辑</button>
        <button class="btn" data-add-rent="${room.id}">收租</button>
        <button class="btn danger" data-delete-room="${room.id}">删除</button>
      </div>
    </article>
  `).join("") : `<div class="empty" style="grid-column:1/-1">还没有房源。点击“新增房源”开始录入。</div>`;
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
  const vacant = state.rooms.filter(r => r.status === "空置");
  document.getElementById("due7Count").textContent = data.due7.length + data.overdue.length;
  document.getElementById("due30Count").textContent = data.due30.length;
  document.getElementById("rentDueCount").textContent = data.rentDue.length;
  document.getElementById("reminderVacantCount").textContent = vacant.length;
  const expiryRows = [
    ...data.overdue.map(x => ({ title: x.room.name + " 合同已过期", text: `过期 ${Math.abs(x.days)} 天，电话：${x.room.tenantPhone || "未填写"}`, danger: true })),
    ...data.due7.map(x => ({ title: x.room.name + " 7 天内到期", text: `${x.days} 天后到期，租客：${x.room.tenantName || "未填写"}`, danger: true })),
    ...data.due30.map(x => ({ title: x.room.name + " 30 天内到期", text: `${x.days} 天后到期，建议提前确认续租。`, danger: false }))
  ];
  const rentRows = [
    ...data.rentDue.map(room => ({ title: room.name + " 本月未记录房租", text: `租客：${room.tenantName || "未填写"}，应收：${money(room.rent)}`, danger: true })),
    ...vacant.map(room => ({ title: room.name + " 当前空置", text: `${room.address || "未填写地址"}，月租：${money(room.rent)}`, danger: false }))
  ];
  document.getElementById("expiryAlerts").innerHTML = expiryRows.length ? expiryRows.map(alertTemplate).join("") : `<div class="empty">暂无租期提醒。</div>`;
  document.getElementById("rentAlerts").innerHTML = rentRows.length ? rentRows.map(alertTemplate).join("") : `<div class="empty">暂无欠租或空置提醒。</div>`;
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
  document.getElementById("roomRent").value = room?.rent || "";
  document.getElementById("roomDeposit").value = room?.deposit || "";
  document.getElementById("roomWater").value = room?.water || "";
  document.getElementById("roomElectric").value = room?.electric || "";
  document.getElementById("roomInternet").value = room?.internet || "";
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
    openLedgerForm(null, { type: "income", category: "房租", roomId: room.id, amount: room.rent, note: `${room.name} 房租` });
  }
  const editLedger = event.target.closest("[data-edit-ledger]");
  if (editLedger) openLedgerForm(state.ledger.find(i => i.id === editLedger.dataset.editLedger));
  const deleteLedgerButton = event.target.closest("[data-delete-ledger]");
  if (deleteLedgerButton) askConfirm("删除记账", "这条收支记录删除后不可恢复，确定继续吗？", withBusy(() => deleteLedger(deleteLedgerButton.dataset.deleteLedger)));
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
    rent: Number(document.getElementById("roomRent").value || 0),
    deposit: Number(document.getElementById("roomDeposit").value || 0),
    water: Number(document.getElementById("roomWater").value || 0),
    electric: Number(document.getElementById("roomElectric").value || 0),
    internet: Number(document.getElementById("roomInternet").value || 0),
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
document.getElementById("exportJsonBtn").addEventListener("click", exportJSON);
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
document.getElementById("importJsonInput").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      askConfirm("导入 JSON", "导入后会覆盖服务器当前数据，确定继续吗？", withBusy(async () => {
        const payload = await api("/api/import", { method: "POST", body: JSON.stringify(imported) });
        await refreshFromPayload(payload, "JSON 已导入服务器");
      }));
    } catch {
      toast("JSON 文件格式不正确");
    }
  };
  reader.readAsText(file);
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
loadStateFromServer().catch(error => {
  toast(error.message || "无法连接服务器");
});
