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

    table.innerHTML += `
      <tr>
        <td><span class="badge badge-${t.type}">${t.type}</span></td>
        <td><strong>${t.category}</strong><br><small style="color:var(--text-muted)">${t.note || ""}</small></td>
        <td style="font-weight: 600">${formatMoney(t.amount)}</td>
        <td>${formatDate(t.transaction_date || t.created_at)}</td>
        <td>
          <div style="display:flex; gap:5px;">
            ${t.type === 'expense' ? `
              <button class="btn-icon-danger" style="background: rgba(139, 92, 246, 0.1); color: var(--color-investment);" onclick="makeRecurring('${t.category.replace(/'/g, "\\'")}', ${t.amount})" title="Make Recurring">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.92-5.23l.14.34"/></svg>
              </button>
            ` : ''}
            <button class="btn-icon-danger" onclick="openDeleteModal(${t.id})" title="Delete Transaction">
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

// 2. Add Transaction Form
const txModal = document.getElementById("transactionModal");
document.getElementById("openModalBtn").onclick = () => {
  document.getElementById("transactionDate").valueAsDate = new Date();
  txModal.classList.add("active");
};
document.getElementById("closeModalBtn").onclick = () => txModal.classList.remove("active");

document.getElementById("addForm").onsubmit = async e => {
  e.preventDefault();
  const form = new FormData(e.target);
  await fetch("/api/add", {
    method: "POST",
    body: new URLSearchParams(form)
  });
  e.target.reset();
  txModal.classList.remove("active");
  load();
};

// 3. Secure Deletion
const delModal = document.getElementById("deleteModal");
function openDeleteModal(id) {
  document.getElementById("deleteId").value = id;
  document.getElementById("deleteForm").reset();
  delModal.classList.add("active");
}
function closeDeleteModal() {
  delModal.classList.remove("active");
}

document.getElementById("deleteForm").onsubmit = async e => {
  e.preventDefault();
  const id = document.getElementById("deleteId").value;
  const formData = new FormData(e.target);
  const password = formData.get("password");
  const confirmText = formData.get("confirm_text");

  if (confirmText !== 'DELETE') {
    alert("You must type exactly 'DELETE' to confirm.");
    return;
  }

  const res = await fetch("/api/delete/" + id, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });

  const data = await res.json();
  if (data.success) {
    closeDeleteModal();
    load();
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
  const confirmation = prompt("To stop tracking this recurring overhead, type exactly 'DELETE'");
  if (confirmation === 'DELETE') {
    await fetch("/api/recurring/" + id, { method: "DELETE" });
    pollData(); // immediately ping instead of waiting for interval
  } else if (confirmation !== null) {
    alert("Verification failed. Recurring cost was not deleted.");
  }
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
    }
  } catch (err) {
    console.error("Polling error:", err);
  }
}

// Initial direct loads
load();
loadCategories();
loadRecurringCosts();

// Start 2-second heartbeat
pollData();
setInterval(pollData, 2000);
