let myChart;

// Format Currency
const formatMoney = (amount) => {
  return "₹" + parseFloat(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Format Date
const formatDate = (dateString) => {
  const d = new Date(dateString);
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
};

async function load() {
  const res = await fetch("/api/transactions");
  const data = await res.json();

  let income = 0, expense = 0, investment = 0;
  const table = document.getElementById("table");
  table.innerHTML = "";

  data.forEach(t => {
    if (t.type === "income") income += t.amount;
    else if (t.type === "expense") expense += t.amount;
    else if (t.type === "investment") investment += t.amount;

    table.innerHTML += `
      <tr>
        <td><span class="badge badge-${t.type}">${t.type}</span></td>
        <td><strong>${t.category}</strong><br><small style="color:var(--text-muted)">${t.note || ""}</small></td>
        <td style="font-weight: 600">${formatMoney(t.amount)}</td>
        <td>${formatDate(t.created_at)}</td>
        <td>
          <button class="btn-icon-danger" onclick="del(${t.id})">
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
      responsive: true,
      maintainAspectRatio: false,
      cutout: "75%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { padding: 20, usePointStyle: true, pointStyle: 'circle' }
        },
        tooltip: {
          backgroundColor: "rgba(30, 41, 59, 0.9)",
          titleFont: { size: 14 },
          bodyFont: { size: 14, weight: 'bold' },
          padding: 12,
          cornerRadius: 8,
          displayColors: true,
          callbacks: {
            label: function (context) {
              return " " + formatMoney(context.raw);
            }
          }
        }
      }
    }
  });
}

async function del(id) {
  if (confirm("Delete this transaction?")) {
    await fetch("/api/delete/" + id, { method: "DELETE" });
    load();
  }
}

// Modal Logic
const modal = document.getElementById("transactionModal");
document.getElementById("openModalBtn").onclick = () => modal.classList.add("active");
document.getElementById("closeModalBtn").onclick = () => modal.classList.remove("active");

// Form Submission
document.getElementById("addForm").onsubmit = async e => {
  e.preventDefault();
  const form = new FormData(e.target);
  await fetch("/api/add", {
    method: "POST",
    body: new URLSearchParams(form)
  });
  e.target.reset();
  modal.classList.remove("active");
  load();
};

// Init
load();
