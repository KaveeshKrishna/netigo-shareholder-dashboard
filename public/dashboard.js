let myChart;

// Format Utilities
const formatMoney = (amount) => "₹" + parseFloat(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatDate = (dateString) => new Date(dateString).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });

// Load Data
async function load() {
  const res = await fetch("/api/transactions");
  const data = await res.json();

  let income = 0, expense = 0, investment = 0;
  const table = document.getElementById("table");
  table.innerHTML = "";

  data.forEach(t => {
    const amt = parseFloat(t.amount) || 0;
    if (t.type === "income") income += amt;
    else if (t.type === "expense") expense += amt;
    else if (t.type === "investment") investment += amt;

    const investorLabel = (t.type === 'investment' && t.investor_name) ? `<br><small style="color:var(--color-investment);font-weight:500;">by ${t.investor_name}</small>` : '';
    const noteText = t.note || '';
    const truncatedNote = noteText.length > 40 ? noteText.substring(0, 40) + '…' : noteText;
    const safeNote = JSON.stringify(noteText);
    const safeCategory = JSON.stringify(t.category);
    const safeInvestor = JSON.stringify(t.investor_name || '');

    table.innerHTML += `
      <tr style="cursor:pointer;" onclick="showTransactionDetail(${safeCategory}, '${t.type}', ${t.amount}, '${t.transaction_date || t.created_at}', ${safeNote}, ${safeInvestor})">
        <td><span class="badge badge-${t.type}">${t.type}</span></td>
        <td><strong>${t.category}</strong>${investorLabel}<br><small style="color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;display:inline-block;vertical-align:bottom;">${truncatedNote}</small></td>
        <td style="font-weight: 600">${formatMoney(t.amount)}</td>
        <td>${formatDate(t.transaction_date || t.created_at)}</td>
        <td>
          <div style="display:flex; gap:5px;">
            ${t.type === 'expense' ? `
              <button class="btn-icon-danger" style="background: rgba(139, 92, 246, 0.1); color: var(--color-investment);" onclick="event.stopPropagation();makeRecurring('${t.category.replace(/'/g, "\\'")}', ${t.amount})" title="Make Recurring">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.92-5.23l.14.34"/></svg>
              </button>
            ` : ''}
            <button class="btn-icon-danger" onclick="event.stopPropagation();openDeleteModal(${t.id})" title="Delete Transaction">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </td>
      </tr>`;
  });

  const balance = income + investment - expense;

  document.getElementById("income").innerText = formatMoney(income);
  document.getElementById("expense").innerText = formatMoney(expense);
  document.getElementById("investment").innerText = formatMoney(investment);
  document.getElementById("balance").innerText = formatMoney(balance);

  updateChart([investment, income, expense]);
}

function updateChart(dataValues) {
  const ctx = document.getElementById("chart").getContext('2d');

  if (myChart) myChart.destroy();

  Chart.defaults.color = "#94a3b8";
  Chart.defaults.font.family = "Outfit";

  myChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Investments", "Earnings", "Expenses"],
      datasets: [{
        data: dataValues,
        backgroundColor: ["#8b5cf6", "#10b981", "#ef4444"],
        borderWidth: 0,
        hoverOffset: 10
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "75%",
      plugins: {
        legend: { position: "bottom", labels: { padding: 20, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: {
          backgroundColor: "rgba(30, 41, 59, 0.9)", titleFont: { size: 14 }, bodyFont: { size: 14, weight: 'bold' },
          padding: 12, cornerRadius: 8, displayColors: true,
          callbacks: { label: function (c) { return " " + formatMoney(c.raw); } }
        }
      }
    }
  });
}

// === NEW FEATURE LOGIC ===

// 1. Categories
async function loadCategories() {
  const res = await fetch("/api/categories");
  const categories = await res.json();
  const select = document.getElementById("categorySelect");
  select.innerHTML = "";
  categories.forEach(c => {
    select.innerHTML += `<option value="${c.name}">${c.name}</option>`;
  });
}

document.getElementById("newCategoryBtn").onclick = async () => {
  const name = prompt("Enter new category name:");
  if (name && name.trim()) {
    await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() })
    });
    loadCategories();
  }
};

// 1.5 Investors
async function loadInvestors() {
  const res = await fetch("/api/investors");
  const investors = await res.json();
  const select = document.getElementById("investorSelect");
  if (!select) return;
  select.innerHTML = '<option value="">Select Investor</option>';
  investors.forEach(i => {
    select.innerHTML += `<option value="${i.name}">${i.name}</option>`;
  });
}

document.getElementById("newInvestorBtn").onclick = async () => {
  const name = prompt("Enter investor name:");
  if (name && name.trim()) {
    await fetch("/api/investors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() })
    });
    await loadInvestors();
    document.getElementById("investorSelect").value = name.trim();
  }
};

// Show/hide investor field based on transaction type
document.querySelector('#addForm select[name="type"]').addEventListener('change', function () {
  const investorGroup = document.getElementById('investorGroup');
  if (investorGroup) investorGroup.style.display = this.value === 'investment' ? 'block' : 'none';
});

// --- Finance Summary & Charts ---
let revenueChartInstance, investorChartInstance, profitChartInstance;

async function loadFinanceSummary() {
  const period = document.getElementById('timelinePeriod')?.value || 'monthly';
  try {
    const res = await fetch(`/api/finance/summary?period=${period}`);
    const data = await res.json();

    // Update stat cards
    document.getElementById('netProfit').innerText = formatMoney(data.netProfit);
    document.getElementById('companyValuation').innerText = formatMoney(data.companyValuation);

    // Render all charts
    renderRevenueChart(data.timeline);
    renderInvestorWidget(data.investors, data.companyValuation);
    renderProfitChart(data.timeline);
  } catch (err) {
    console.error('Finance summary error:', err);
  }
}

function renderRevenueChart(timeline) {
  const ctx = document.getElementById('revenueChart');
  if (!ctx) return;
  if (revenueChartInstance) revenueChartInstance.destroy();

  revenueChartInstance = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: timeline.map(t => t.period),
      datasets: [
        { label: 'Earnings', data: timeline.map(t => t.income), backgroundColor: '#10b981', borderRadius: 6, barPercentage: 0.7 },
        { label: 'Expenses', data: timeline.map(t => t.expense), backgroundColor: '#ef4444', borderRadius: 6, barPercentage: 0.7 },
        { label: 'Investments', data: timeline.map(t => t.investment), backgroundColor: '#8b5cf6', borderRadius: 6, barPercentage: 0.7 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { padding: 15, usePointStyle: true, pointStyle: 'circle', font: { family: 'Outfit' } } },
        tooltip: { backgroundColor: 'rgba(30,41,59,0.95)', titleFont: { size: 13 }, bodyFont: { size: 13, weight: 'bold' }, padding: 12, cornerRadius: 8, callbacks: { label: c => ' ' + c.dataset.label + ': ' + formatMoney(c.raw) } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Outfit', size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { font: { family: 'Outfit', size: 11 }, callback: v => '₹' + v.toLocaleString() } }
      }
    }
  });
}

function renderInvestorWidget(investors, totalVal) {
  const ctx = document.getElementById('investorChart');
  const list = document.getElementById('investorList');
  if (!ctx || !list) return;

  if (investorChartInstance) investorChartInstance.destroy();

  const colors = ['#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#6366f1'];

  if (investors.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);text-align:center;font-size:13px;padding:20px;">No investor data yet. Add investments with investor names.</p>';
    return;
  }

  investorChartInstance = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: investors.map(i => i.name),
      datasets: [{ data: investors.map(i => i.invested), backgroundColor: colors.slice(0, investors.length), borderWidth: 0, hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: 'rgba(30,41,59,0.95)', padding: 10, cornerRadius: 8, callbacks: { label: c => ' ' + c.label + ': ' + formatMoney(c.raw) + ' (' + investors[c.dataIndex].share + '%)' } }
      }
    }
  });

  list.innerHTML = investors.map((inv, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border-light);gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${colors[i % colors.length]};flex-shrink:0;"></div>
        <div>
          <p style="margin:0;font-weight:600;font-size:14px;color:var(--text-main);">${inv.name}</p>
          <p style="margin:0;font-size:11px;color:var(--text-muted);">${inv.share}% ownership</p>
        </div>
      </div>
      <div style="text-align:right;">
        <p style="margin:0;font-weight:600;font-size:13px;color:var(--color-investment);">${formatMoney(inv.invested)}</p>
        <p style="margin:0;font-size:11px;color:${inv.profitShare >= 0 ? 'var(--color-income)' : 'var(--color-expense)'};">Profit: ${formatMoney(inv.profitShare)}</p>
      </div>
    </div>
  `).join('');
}

function renderProfitChart(timeline) {
  const ctx = document.getElementById('profitChart');
  if (!ctx) return;
  if (profitChartInstance) profitChartInstance.destroy();

  const netProfitData = timeline.map(t => t.income - t.expense);

  profitChartInstance = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels: timeline.map(t => t.period),
      datasets: [
        {
          label: 'Net Profit',
          data: netProfitData,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6,182,212,0.1)',
          fill: true,
          tension: 0.4,
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: '#06b6d4'
        },
        {
          label: 'Gross Profit (Earnings)',
          data: timeline.map(t => t.income),
          borderColor: '#10b981',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: '#10b981'
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { padding: 15, usePointStyle: true, pointStyle: 'circle', font: { family: 'Outfit' } } },
        tooltip: { backgroundColor: 'rgba(30,41,59,0.95)', padding: 12, cornerRadius: 8, callbacks: { label: c => ' ' + c.dataset.label + ': ' + formatMoney(c.raw) } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Outfit', size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { font: { family: 'Outfit', size: 11 }, callback: v => '₹' + v.toLocaleString() } }
      }
    }
  });
}

// 2. Add Transaction Form
const txModal = document.getElementById("transactionModal");
document.getElementById("openModalBtn").onclick = () => {
  document.getElementById("transactionDate").valueAsDate = new Date();
  // Show investor field since Investment is the default selected type
  document.getElementById('investorGroup').style.display = 'block';
  loadInvestors();
  txModal.classList.add("active");
};
document.getElementById("closeModalBtn").onclick = () => txModal.classList.remove("active");

// Transaction detail viewer
function showTransactionDetail(category, type, amount, date, note, investor) {
  const existing = document.getElementById('txDetailOverlay');
  if (existing) existing.remove();

  const typeColors = { income: 'var(--color-income)', expense: 'var(--color-expense)', investment: 'var(--color-investment)' };
  const investorRow = (type === 'investment' && investor) ? `
    <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border-light);">
      <span style="color:var(--text-muted);font-size:14px;">Investor</span>
      <span style="font-weight:600;color:var(--color-investment);">${investor}</span>
    </div>` : '';

  const overlay = document.createElement('div');
  overlay.id = 'txDetailOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);animation:fadeIn 0.2s ease;';
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border-light);border-radius:16px;padding:30px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <h3 style="margin:0;font-size:18px;">Transaction Details</h3>
        <button onclick="document.getElementById('txDetailOverlay').remove()" style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;">✕</button>
      </div>
      <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border-light);">
        <span style="color:var(--text-muted);font-size:14px;">Type</span>
        <span class="badge badge-${type}" style="font-size:13px;">${type}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border-light);">
        <span style="color:var(--text-muted);font-size:14px;">Category</span>
        <span style="font-weight:600;">${category}</span>
      </div>
      ${investorRow}
      <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border-light);">
        <span style="color:var(--text-muted);font-size:14px;">Amount</span>
        <span style="font-weight:700;font-size:18px;color:${typeColors[type] || 'var(--text-main)'}">${formatMoney(amount)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border-light);">
        <span style="color:var(--text-muted);font-size:14px;">Date</span>
        <span style="font-weight:500;">${formatDate(date)}</span>
      </div>
      ${note ? `
      <div style="padding:12px 0;">
        <span style="color:var(--text-muted);font-size:14px;display:block;margin-bottom:8px;">Note</span>
        <p style="margin:0;color:var(--text-main);font-size:14px;line-height:1.6;background:var(--bg-secondary);padding:12px;border-radius:8px;">${note}</p>
      </div>` : ''}
    </div>
  `;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
document.getElementById("closeModalBtn").onclick = () => txModal.classList.remove("active");

document.getElementById("addForm").onsubmit = async e => {
  e.preventDefault();
  const form = new FormData(e.target);
  await fetch("/api/add", {
    method: "POST",
    body: new URLSearchParams(form)
  });
  e.target.reset();
  document.getElementById('investorGroup').style.display = 'none';
  txModal.classList.remove("active");
  load();
  loadFinanceSummary();
};

// 3. Secure Deletion
const delModal = document.getElementById("deleteModal");
function openDeleteModal(id, type = 'transaction') {
  document.getElementById("deleteId").value = id;
  document.getElementById("deleteType").value = type;
  document.getElementById("deleteForm").reset();
  delModal.classList.add("active");
}
function closeDeleteModal() {
  delModal.classList.remove("active");
}

document.getElementById("deleteForm").onsubmit = async e => {
  e.preventDefault();
  const id = document.getElementById("deleteId").value;
  const type = document.getElementById("deleteType").value;
  const formData = new FormData(e.target);
  const confirmText = formData.get("confirm_text");

  if (confirmText !== 'DELETE') {
    alert("You must type exactly 'DELETE' to confirm.");
    return;
  }

  const endpoint = type === 'transaction' ? `/api/delete/${id}` : `/api/recurring/${id}`;
  const method = type === 'transaction' ? "POST" : "DELETE";

  const res = await fetch(endpoint, {
    method: method,
    headers: { "Content-Type": "application/json" }
  });

  const data = await res.json();
  if (data.success) {
    closeDeleteModal();
    pollData();
  } else {
    alert(data.error);
  }
};

// 4. Online Presence
async function pingPresence() {
  await fetch("/api/ping", { method: "POST" });
  loadOnlineUsers();
}

async function loadOnlineUsers() {
  const res = await fetch("/api/online");
  const users = await res.json();
  const container = document.getElementById("online-users-list");

  const online = users.filter(u => u.is_online);
  const offline = users.filter(u => !u.is_online);

  let html = `<p class="section-title" style="margin-bottom: 10px; color: var(--color-income);">Online accounts:</p>`;
  online.forEach(u => {
    html += `
      <div class="online-user">
        <span class="status-dot"></span>
        <span class="user-name">${u.username.split('@')[0]}</span>
      </div>
    `;
  });

  if (offline.length > 0) {
    html += `<p class="section-title" style="margin-top: 15px; margin-bottom: 10px; color: var(--color-expense);">Offline accounts:</p>`;
    offline.forEach(u => {
      html += `
        <div class="online-user">
          <span class="status-dot offline"></span>
          <span class="user-name" style="color: var(--text-muted);">${u.username.split('@')[0]}</span>
        </div>
      `;
    });
  }

  container.innerHTML = html;
}

// 5. OVERALL METRICS & RECURRING COSTS
let allRecurringCosts = [];

async function loadRecurringCosts() {
  const res = await fetch("/api/recurring");
  allRecurringCosts = await res.json();
  renderRecurringCosts();
}

function renderRecurringCosts() {
  const timeframe = document.getElementById("recurringTimeframe").value;
  const list = document.getElementById("recurringList");
  let totalProjection = 0;
  let html = "";

  document.getElementById("projectedLabel").innerText = timeframe;

  if (allRecurringCosts.length === 0) {
    list.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted);">No recurring costs tracked.</div>`;
    document.getElementById("projectedTotal").innerText = formatMoney(0);
    return;
  }

  allRecurringCosts.forEach(cost => {
    let projectedAmt = parseFloat(cost.amount);

    // Normalize math to daily, then scale
    let daily = 0;
    if (cost.billing_cycle === 'daily') daily = projectedAmt;
    if (cost.billing_cycle === 'weekly') daily = projectedAmt / 7;
    if (cost.billing_cycle === 'monthly') daily = projectedAmt / 30;
    if (cost.billing_cycle === 'yearly') daily = projectedAmt / 365;

    let targetAmt = 0;
    if (timeframe === 'daily') targetAmt = daily;
    if (timeframe === 'weekly') targetAmt = daily * 7;
    if (timeframe === 'monthly') targetAmt = daily * 30;
    if (timeframe === 'yearly') targetAmt = daily * 365;

    totalProjection += targetAmt;

    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid rgba(255,255,255,0.05);">
        <div>
          <strong style="color:var(--text-main); font-size:14px;">${cost.name}</strong>
          <div style="font-size:12px; color:var(--text-muted); margin-top:3px;">
            <span style="text-transform:capitalize;">${cost.billing_cycle}</span> • Original: ${formatMoney(cost.amount)}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:15px;">
          <span style="color:var(--color-expense); font-weight:600;">${formatMoney(targetAmt)}</span>
          <button class="btn-icon-danger" onclick="deleteRecurringCost(${cost.id})" style="padding:4px; background:none;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `;
  });

  list.innerHTML = html;
  document.getElementById("projectedTotal").innerText = formatMoney(totalProjection);
}

function openAddRecurringModal() {
  document.getElementById("recurringForm").reset();
  document.getElementById("recurringModalTitle").innerText = "Add Recurring Cost";
  document.getElementById('recurringModal').classList.add('active');
}

function makeRecurring(name, amount) {
  document.getElementById("recurringForm").reset();
  document.getElementById("reqName").value = name;
  document.getElementById("reqAmount").value = amount;
  document.getElementById("recurringModalTitle").innerText = "Convert to Recurring Cost";
  document.getElementById('recurringModal').classList.add('active');
}

async function saveRecurringCost(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());

  await fetch("/api/recurring", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  document.getElementById('recurringModal').classList.remove('active');
  loadRecurringCosts();
}

async function deleteRecurringCost(id) {
  openDeleteModal(id, 'recurring');
}


// Initialization & Polling
let currentVersion = 0;

async function pollData() {
  await pingPresence(); // Updates last_seen and refreshes the online users UI

  try {
    const res = await fetch("/api/version");
    const data = await res.json();
    if (data.version > currentVersion) {
      currentVersion = data.version;
      load();              // Fetch transactions & redraw chart
      loadRecurringCosts(); // Fetch and redraw recurring widget
      loadNotes();         // Fetch and redraw notes
    }
  } catch (err) {
    console.error("Polling error:", err);
  }
}

// Initial direct loads
load();
loadCategories();
loadRecurringCosts();
loadFinanceSummary();

// Start 2-second heartbeat
pollData();
setInterval(pollData, 2000);

// --- Notes System ---
let notesData = [];
let currentNotesTab = 'global';
let completedFilter = 'all';
let isAnimating = false;
let splitTiles = [];
try {
  const saved = JSON.parse(localStorage.getItem('netigoSplitNotes') || '[]');
  if (Array.isArray(saved)) splitTiles = saved.filter(t => ['global', 'personal', 'completed'].includes(t));
} catch (e) {
  localStorage.removeItem('netigoSplitNotes');
}

function saveSplitTiles() {
  localStorage.setItem('netigoSplitNotes', JSON.stringify(splitTiles));
}

function getAvailableTabsForStacked() {
  const allTabs = ['global', 'personal', 'completed'];
  return allTabs.filter(t => !splitTiles.includes(t));
}

function getDefaultTab() {
  const available = getAvailableTabsForStacked();
  if (available.length === 0) return null;
  // Priority: global > personal > completed
  if (available.includes('global')) return 'global';
  if (available.includes('personal')) return 'personal';
  return 'completed';
}

const TAB_LABELS = { global: 'Global Tasks', personal: 'Personal Tasks', completed: 'Completed Archive' };

async function loadNotes() {
  if (isAnimating) return;
  try {
    const res = await fetch("/api/notes");
    notesData = await res.json();
    renderAllNotes();
  } catch (err) {
    console.error("Failed to load notes", err);
  }
}

function switchNotesTab(tab) {
  currentNotesTab = tab;
  renderAllNotes();
}

function updateStackedDropdown() {
  const select = document.getElementById('notesViewSelect');
  if (!select) return;
  const available = getAvailableTabsForStacked();
  select.innerHTML = '';
  available.forEach(tab => {
    const opt = document.createElement('option');
    opt.value = tab;
    opt.textContent = TAB_LABELS[tab];
    if (tab === currentNotesTab) opt.selected = true;
    select.appendChild(opt);
  });
  // If current tab was split out, switch to default
  if (!available.includes(currentNotesTab)) {
    currentNotesTab = getDefaultTab();
    if (currentNotesTab) select.value = currentNotesTab;
  }
}

function renderAllNotes() {
  updateStackedDropdown();

  // Hide/show main notes tile
  const mainTile = document.querySelector('[gs-id="notes"]');
  const available = getAvailableTabsForStacked();
  if (mainTile) {
    mainTile.style.display = available.length === 0 ? 'none' : '';
  }

  // Render stacked tile
  if (available.length > 0 && currentNotesTab) {
    renderNotesForContainer('notesList', currentNotesTab, false);
  }

  // Render each split tile
  splitTiles.forEach(cat => {
    renderNotesForContainer('notesList-' + cat, cat, true);
  });

  // Show/hide + button based on edit mode
  updateAddTileButton();
}

function renderNotesForContainer(containerId, category, isSplitTile) {
  const list = document.getElementById(containerId);
  if (!list) return;
  list.innerHTML = '';

  let filteredNotes;
  if (category === 'completed') {
    filteredNotes = notesData.filter(n => n.is_completed);
    if (completedFilter !== 'all') {
      filteredNotes = filteredNotes.filter(n => completedFilter === 'global' ? n.is_global : !n.is_global);
    }
  } else if (category === 'global') {
    filteredNotes = notesData.filter(n => !n.is_completed && n.is_global);
  } else {
    filteredNotes = notesData.filter(n => !n.is_completed && !n.is_global);
  }

  // Show filter bar + Delete All for completed
  if (category === 'completed') {
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px;';
    toolbar.innerHTML = `
      <select onchange="completedFilter=this.value;renderAllNotes()" style="background:var(--bg-dark);border:1px solid var(--border-light);color:var(--text-main);padding:5px 10px;border-radius:8px;font-size:12px;cursor:pointer;outline:none;">
        <option value="all" ${completedFilter === 'all' ? 'selected' : ''}>All</option>
        <option value="personal" ${completedFilter === 'personal' ? 'selected' : ''}>Personal</option>
        <option value="global" ${completedFilter === 'global' ? 'selected' : ''}>Global</option>
      </select>
      <button onclick="deleteAllCompleted()" style="background:rgba(239,68,68,0.15);color:var(--color-expense);border:1px solid rgba(239,68,68,0.3);padding:5px 12px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.2s;">🗑 Delete All</button>
    `;
    list.appendChild(toolbar);
  }

  if (filteredNotes.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.style.cssText = 'padding:10px;color:var(--text-muted);text-align:center;font-style:italic;';
    emptyMsg.textContent = 'No tasks found.';
    list.appendChild(emptyMsg);
    return;
  }

  filteredNotes.sort((a, b) => {
    if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  filteredNotes.forEach(note => {
    const div = document.createElement('div');
    div.className = 'note-item';
    div.style.cursor = 'pointer';

    const safeNoteData = encodeURIComponent(JSON.stringify(note));
    div.onclick = function (e) {
      if (e.target.tagName.toLowerCase() === 'input' || e.target.tagName.toLowerCase() === 'button' || e.target.closest('button')) return;
      openViewTaskModal(JSON.parse(decodeURIComponent(safeNoteData)));
    };

    const isChecked = note.is_completed ? 'checked' : '';
    const textStyle = note.is_completed ? 'text-decoration: line-through; opacity: 0.5;' : '';

    let tagHtml = '';
    if (note.is_global && note.assignee_name) {
      const shortName = note.assignee_name.split('@')[0];
      const dotColor = stringToColor(shortName);
      tagHtml = `<span style="font-size:11px;font-weight:500;background:rgba(0,0,0,0.3);border:1px solid var(--border-light);padding:2px 8px;border-radius:12px;display:inline-flex;align-items:center;gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:${dotColor};"></span>${shortName}</span>`;
    }

    let deadlineHtml = '';
    if (note.deadline) {
      const dl = new Date(note.deadline).toLocaleDateString();
      deadlineHtml = `<span style="font-size:11px;color:var(--color-expense);margin-right:8px;">Due: ${dl}</span>`;
    } else {
      deadlineHtml = `<span style="font-size:11px;color:var(--text-muted);margin-right:8px;">Due: Anytime</span>`;
    }

    const deleteBtn = category === 'completed'
      ? `<button onclick="deleteNote(${note.id}, ${note.is_global})" style="flex-shrink:0;background:none;border:none;color:var(--color-expense);cursor:pointer;font-size:14px;padding:4px;opacity:0.6;transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'" title="Delete forever">🗑</button>`
      : '';

    div.innerHTML = `
      <div style="flex-shrink:0;display:flex;align-items:center;justify-content:center;">
        <input type="radio" ${isChecked} onclick="toggleNoteCompletion(${note.id})">
      </div>
      <div style="flex:1;min-width:0;">
        <p style="color:var(--text-main);font-size:14px;margin:0 0 4px 0;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;${textStyle}">${note.content}</p>
        <div style="display:flex;align-items:center;flex-wrap:wrap;">
          ${deadlineHtml}
          ${tagHtml}
        </div>
      </div>
      ${deleteBtn}
    `;
    list.appendChild(div);
  });
}

// Boot notes system (must be after all declarations above)
loadNotes();
setInterval(loadNotes, 2000);

function openAddTaskModal() {
  document.getElementById('addTaskModal').classList.add('active');
  document.getElementById('modalNoteInput').focus();
}
document.getElementById('closeTaskBtn')?.addEventListener('click', () => {
  document.getElementById('addTaskModal').classList.remove('active');
});

function toggleModalGlobalOptions() {
  const isGlobal = document.getElementById("modalNoteGlobal").value === "true";
  document.getElementById("modalGlobalOptions").style.display = isGlobal ? "flex" : "none";
}

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - c.length) + c;
}

function openViewTaskModal(note) {
  document.getElementById('viewTaskTitle').innerText = note.content;
  document.getElementById('viewTaskDescription').innerText = note.description || 'No description provided.';

  const metaContainer = document.getElementById('viewTaskMeta');
  metaContainer.innerHTML = '';

  const dateStr = note.created_at ? new Date(note.created_at).toLocaleDateString() : '';
  let metaHtml = `<span style="background: rgba(255,255,255,0.05); padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border-light);">Created: ${dateStr}</span>`;

  if (note.is_global) {
    metaHtml += `<span style="background: rgba(239, 68, 68, 0.1); color: var(--color-expense); padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.2);">Global Task</span>`;
    if (note.assignee_name) {
      metaHtml += `<span style="background: rgba(59, 130, 246, 0.1); color: var(--color-balance); padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(59, 130, 246, 0.2);">Assigned to: ${note.assignee_name}</span>`;
    }
  } else {
    metaHtml += `<span style="background: rgba(139, 92, 246, 0.1); color: var(--color-investment); padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(139, 92, 246, 0.2);">Personal Task</span>`;
  }

  metaContainer.innerHTML = metaHtml;

  const deadlineContainer = document.getElementById('viewTaskDeadlineContainer');
  if (note.deadline) {
    document.getElementById('viewTaskDeadline').innerText = 'Due: ' + new Date(note.deadline).toLocaleDateString();
    deadlineContainer.style.display = 'flex';
  } else {
    document.getElementById('viewTaskDeadline').innerText = 'Due: Anytime';
    deadlineContainer.style.display = 'flex';
  }

  document.getElementById('viewTaskModal').classList.add('active');
}
document.getElementById('closeViewTaskBtn')?.addEventListener('click', () => {
  document.getElementById('viewTaskModal').classList.remove('active');
});

function renderNotes() {
  const list = document.getElementById("notesList");
  if (!list) return;
  list.innerHTML = "";

  let filteredNotes = notesData.filter(n => {
    if (currentNotesTab === 'completed') return n.is_completed;
    if (currentNotesTab === 'global') return !n.is_completed && n.is_global;
    return !n.is_completed && !n.is_global;
  });

  // Sub-filter for completed tab
  if (currentNotesTab === 'completed' && completedFilter !== 'all') {
    filteredNotes = filteredNotes.filter(n => completedFilter === 'global' ? n.is_global : !n.is_global);
  }

  // Show filter bar + Delete All for completed tab
  if (currentNotesTab === 'completed') {
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px;';
    toolbar.innerHTML = `
      <select onchange="completedFilter=this.value;renderNotes()" style="background:var(--bg-dark);border:1px solid var(--border-light);color:var(--text-main);padding:5px 10px;border-radius:8px;font-size:12px;cursor:pointer;outline:none;">
        <option value="all" ${completedFilter === 'all' ? 'selected' : ''}>All</option>
        <option value="personal" ${completedFilter === 'personal' ? 'selected' : ''}>Personal</option>
        <option value="global" ${completedFilter === 'global' ? 'selected' : ''}>Global</option>
      </select>
      <button onclick="deleteAllCompleted()" style="background:rgba(239,68,68,0.15);color:var(--color-expense);border:1px solid rgba(239,68,68,0.3);padding:5px 12px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.2s;">🗑 Delete All</button>
    `;
    list.appendChild(toolbar);
  }

  if (filteredNotes.length === 0) {
    list.innerHTML += `<p style="padding: 10px; color: var(--text-muted); text-align: center; font-style: italic;">No tasks found.</p>`;
    return;
  }

  filteredNotes.sort((a, b) => {
    if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  filteredNotes.forEach(note => {
    const div = document.createElement("div");
    div.className = "note-item";
    div.style.cursor = "pointer";

    const safeNoteData = encodeURIComponent(JSON.stringify(note));

    div.onclick = function (e) {
      if (e.target.tagName.toLowerCase() === 'input' || e.target.tagName.toLowerCase() === 'button' || e.target.closest('button')) return;
      openViewTaskModal(JSON.parse(decodeURIComponent(safeNoteData)));
    };

    const isChecked = note.is_completed ? 'checked' : '';
    const textStyle = note.is_completed ? 'text-decoration: line-through; opacity: 0.5;' : '';

    let tagHtml = '';
    if (note.is_global && note.assignee_name) {
      const shortName = note.assignee_name.split('@')[0];
      const dotColor = stringToColor(shortName);
      tagHtml = `<span style="font-size: 11px; font-weight: 500; background: rgba(0,0,0,0.3); border: 1px solid var(--border-light); padding: 2px 8px; border-radius: 12px; display: inline-flex; align-items: center; gap: 4px;"><span style="width: 6px; height: 6px; border-radius: 50%; background: ${dotColor};"></span>${shortName}</span>`;
    }

    let deadlineHtml = '';
    if (note.deadline) {
      const dl = new Date(note.deadline).toLocaleDateString();
      deadlineHtml = `<span style="font-size: 11px; color: var(--color-expense); margin-right: 8px;">Due: ${dl}</span>`;
    } else {
      deadlineHtml = `<span style="font-size: 11px; color: var(--text-muted); margin-right: 8px;">Due: Anytime</span>`;
    }

    // Delete button only in completed tab
    const deleteBtn = currentNotesTab === 'completed'
      ? `<button onclick="deleteNote(${note.id}, ${note.is_global})" style="flex-shrink:0;background:none;border:none;color:var(--color-expense);cursor:pointer;font-size:14px;padding:4px;opacity:0.6;transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'" title="Delete forever">🗑</button>`
      : '';

    div.innerHTML = `
      <div style="flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
        <input type="radio" ${isChecked} onclick="toggleNoteCompletion(${note.id})">
      </div>
      <div style="flex: 1; min-width: 0;">
        <p style="color: var(--text-main); font-size: 14px; margin: 0 0 4px 0; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; ${textStyle}">${note.content}</p>
        <div style="display: flex; align-items: center; flex-wrap: wrap;">
          ${deadlineHtml}
          ${tagHtml}
        </div>
      </div>
      ${deleteBtn}
    `;
    list.appendChild(div);
  });
}

async function deleteNote(id, isGlobal) {
  if (!confirm('Delete this task permanently?')) return;

  isAnimating = true;
  const btn = document.querySelector(`button[onclick="deleteNote(${id}, ${isGlobal})"]`);
  const noteItem = btn ? btn.closest('.note-item') : null;
  if (noteItem) {
    noteItem.classList.add('note-item-fade-out');
    await new Promise(r => setTimeout(r, 350));
  }

  try {
    await fetch('/api/notes/' + id, { method: 'DELETE' });
  } catch (err) {
    alert('Failed to delete task.');
  }
  isAnimating = false;
  loadNotes();
}

async function deleteAllCompleted() {
  if (!confirm('Delete all completed tasks permanently?')) return;

  isAnimating = true;
  document.querySelectorAll('.note-item').forEach(el => el.classList.add('note-item-fade-out'));
  await new Promise(r => setTimeout(r, 350));

  try {
    await fetch('/api/notes/completed/all', { method: 'DELETE' });
  } catch (err) {
    alert('Failed to delete tasks.');
  }
  isAnimating = false;
  loadNotes();
}

async function toggleNoteCompletion(id) {
  isAnimating = true;
  const radio = document.querySelector(`input[type="radio"][onclick="toggleNoteCompletion(${id})"]`);
  const noteItem = radio ? radio.closest('.note-item') : null;

  if (noteItem) {
    noteItem.classList.add('note-item-fade-out');
    await new Promise(r => setTimeout(r, 350));
  }

  try {
    const res = await fetch('/api/notes/' + id + '/toggle-complete', { method: 'PUT' });
    if (!res.ok) throw new Error("Unauthorized");
  } catch (err) {
    alert("You do not have permission to modify this task.");
  }

  isAnimating = false;
  loadNotes();
}

async function addNote() {
  const input = document.getElementById("modalNoteInput");
  const descInput = document.getElementById("modalNoteDescription");
  const typeSelect = document.getElementById("modalNoteGlobal");
  const deadlineInput = document.getElementById("modalNoteDeadline");
  const assigneeSelect = document.getElementById("modalNoteAssignee");

  const content = input.value.trim();
  const description = descInput ? descInput.value.trim() : "";
  const is_global = typeSelect.value === "true";
  const deadline = deadlineInput ? deadlineInput.value : null;
  const assigned_to = assigneeSelect && is_global ? assigneeSelect.value : null;

  if (!content) return;

  try {
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, description, is_global, deadline, assigned_to })
    });

    // reset form
    input.value = "";
    if (descInput) descInput.value = "";
    if (deadlineInput) deadlineInput.value = "";
    document.getElementById("addTaskModal").classList.remove('active');

    // Refresh
    loadNotes();
  } catch (err) {
    alert("Error adding note.");
  }
}

// --- GridStack Layout Management ---
let grid;

function createSplitTileWidget(category) {
  if (!grid) return;
  const titles = { personal: 'Personal Tasks', global: 'Global Tasks', completed: 'Completed Archive' };
  const gsId = 'notes-' + category;

  // Don't double-create
  if (document.querySelector(`[gs-id="${gsId}"]`)) return;

  const addTaskBtn = category !== 'completed'
    ? `<button class="btn-primary" onclick="openAddTaskModal()" style="width:100%;justify-content:center;padding:12px;font-size:15px;border-radius:12px;">Add Task</button>`
    : '';

  const deleteHandleHtml = `<button class="split-tile-delete-btn" onclick="removeSplitTile('${category}')" title="Remove this tile" style="display:none;position:absolute;top:8px;right:8px;background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);color:var(--color-expense);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;z-index:10;">✕</button>`;

  const widgetHtml = `
    <div class="grid-stack-item-content" style="position:relative;">
      ${deleteHandleHtml}
      <div class="card recent-card" style="height:100%;display:flex;flex-direction:column;">
        <div class="card-header" style="border-bottom:1px solid var(--border-light);padding-bottom:15px;margin-bottom:15px;">
          <h3 style="margin:0;">${titles[category]}</h3>
        </div>
        <div style="flex:1;overflow-y:auto;padding-right:5px;margin-bottom:15px;" id="notesList-${category}"></div>
        ${addTaskBtn}
      </div>
    </div>
  `;

  grid.addWidget({
    id: gsId,
    w: 4, h: 4, minW: 3, minH: 4,
    autoPosition: true,
    content: widgetHtml
  });

  saveGrid();
  renderAllNotes();

  // Show delete buttons if currently editing
  if (isEditingLayout) {
    document.querySelectorAll('.split-tile-delete-btn').forEach(b => b.style.display = 'block');
  }
}

function addSplitTile(category) {
  if (splitTiles.includes(category)) return;
  splitTiles.push(category);
  saveSplitTiles();
  createSplitTileWidget(category);
  currentNotesTab = getDefaultTab();
  renderAllNotes();
}

function removeSplitTile(category) {
  splitTiles = splitTiles.filter(t => t !== category);
  saveSplitTiles();

  const gsId = 'notes-' + category;
  const el = document.querySelector(`[gs-id="${gsId}"]`);
  if (el && grid) {
    grid.removeWidget(el);
  }
  saveGrid();
  currentNotesTab = getDefaultTab();
  renderAllNotes();
}

function showAddTileMenu() {
  // Remove existing menu
  const existing = document.getElementById('addTileMenu');
  if (existing) { existing.remove(); return; }

  // Max 2 splits allowed (keep at least 1 in stacked tile)
  if (splitTiles.length >= 2) return;

  const available = ['global', 'personal', 'completed'].filter(t => !splitTiles.includes(t));
  if (available.length <= 1) return; // need at least 1 remaining in stacked

  const titles = { personal: 'Personal Tasks', global: 'Global Tasks', completed: 'Completed Archive' };
  const menu = document.createElement('div');
  menu.id = 'addTileMenu';
  menu.style.cssText = 'position:absolute;top:30px;left:0;background:var(--bg-card);border:1px solid var(--border-light);border-radius:10px;padding:6px;z-index:100;min-width:160px;box-shadow:0 8px 24px rgba(0,0,0,0.3);';

  available.forEach(cat => {
    const btn = document.createElement('button');
    btn.textContent = titles[cat];
    btn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 12px;background:none;border:none;color:var(--text-main);cursor:pointer;border-radius:6px;font-size:13px;transition:background 0.15s;';
    btn.onmouseover = () => btn.style.background = 'rgba(255,255,255,0.06)';
    btn.onmouseout = () => btn.style.background = 'none';
    btn.onclick = () => { addSplitTile(cat); menu.remove(); };
    menu.appendChild(btn);
  });

  const addBtn = document.getElementById('addNoteTileBtn');
  if (addBtn) {
    addBtn.parentElement.style.position = 'relative';
    addBtn.parentElement.appendChild(menu);
  }

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target) && e.target.id !== 'addNoteTileBtn') {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 10);
}

function updateAddTileButton() {
  const btn = document.getElementById('addNoteTileBtn');
  if (!btn) return;
  // Show + only in edit mode AND only if fewer than 2 tiles split
  btn.style.display = (isEditingLayout && splitTiles.length < 2) ? 'flex' : 'none';

  // Show/hide delete buttons on split tiles
  document.querySelectorAll('.split-tile-delete-btn').forEach(b => {
    b.style.display = isEditingLayout ? 'block' : 'none';
  });
}

function initializeGrid() {
  grid = GridStack.init({
    staticGrid: true,
    margin: 15,
    cellHeight: 100,
    animate: true
  });

  // Load saved layout if available
  try {
    const savedLayout = localStorage.getItem("netigoGrid");
    if (savedLayout) {
      grid.load(JSON.parse(savedLayout), true);
    }
  } catch (e) {
    console.warn('Corrupted grid layout, resetting:', e);
    localStorage.removeItem('netigoGrid');
  }

  // Restore split tiles
  try {
    splitTiles.forEach(cat => {
      if (!document.querySelector(`[gs-id="notes-${cat}"]`)) {
        createSplitTileWidget(cat);
      }
    });
  } catch (e) {
    console.warn('Error restoring split tiles, resetting:', e);
    splitTiles = [];
    localStorage.removeItem('netigoSplitNotes');
  }

  // Set correct default tab
  currentNotesTab = getDefaultTab() || 'global';
  renderAllNotes();

  // Auto-save on any resize or drag
  grid.on('change', function (event, items) {
    if (!grid.opts.staticGrid) {
      saveGrid();
    }
  });
}

function saveGrid() {
  const layout = grid.save();
  localStorage.setItem("netigoGrid", JSON.stringify(layout));
}

let isEditingLayout = false;
function toggleEditLayout() {
  isEditingLayout = !isEditingLayout;
  grid.setStatic(!isEditingLayout);

  const editBtn = document.getElementById('editLayoutBtn');
  const saveBtn = document.getElementById('saveLayoutBtn');
  const resetBtn = document.getElementById('resetLayoutBtn');

  if (isEditingLayout) {
    editBtn.style.display = 'none';
    saveBtn.style.display = 'inline-block';
    resetBtn.style.display = 'inline-block';
    document.getElementById('main-grid').style.backgroundColor = 'rgba(255,255,255,0.02)';
    document.getElementById('main-grid').style.border = '1px dashed rgba(255,255,255,0.1)';
    document.getElementById('main-grid').style.borderRadius = '12px';
  } else {
    editBtn.style.display = 'inline-block';
    saveBtn.style.display = 'none';
    resetBtn.style.display = 'none';
    document.getElementById('main-grid').style.backgroundColor = 'transparent';
    document.getElementById('main-grid').style.border = 'none';
    // Close the add tile menu if open
    const menu = document.getElementById('addTileMenu');
    if (menu) menu.remove();
  }

  updateAddTileButton();
}

function resetGrid() {
  if (confirm("Are you sure you want to reset the layout to factory defaults?")) {
    localStorage.removeItem("netigoGrid");
    localStorage.removeItem("netigoSplitNotes");
    window.location.reload();
  }
}

// Boot GridStack
document.addEventListener("DOMContentLoaded", initializeGrid);

