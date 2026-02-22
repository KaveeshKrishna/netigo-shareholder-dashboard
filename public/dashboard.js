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
          <button class="btn-icon-danger" onclick="openDeleteModal(${t.id})">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
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

// Initialization & Polling
load();
loadCategories();
pingPresence();
setInterval(pingPresence, 2000); // Ping every 2 seconds
