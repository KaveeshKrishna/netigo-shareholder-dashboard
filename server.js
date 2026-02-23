require("dotenv").config({ path: __dirname + "/.env" });
const express = require("express");
let Pool;
console.log("IS_VPS evaluating as:", process.env.IS_VPS);
if (process.env.IS_VPS === "true") {
  Pool = require("pg").Pool;
} else {
  Pool = require("@neondatabase/serverless").Pool;
}
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const path = require("path");

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || "qopZmCjtrEUfA6M+LoSZbEweZCNKnQ2rDRSnkSnUe30=";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://user:pass@host/db", // Ensure you set DATABASE_URL in Vercel
});

let dataVersion = 1;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// Prevent browser caching on all API routes so polling always gets fresh data
app.use("/api", (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Database Initialization (Auto-Create Schema)
async function initDb() {
  try {
    // Tables will only be created the first time the app is run


    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role VARCHAR(50) DEFAULT 'admin',
        last_seen TIMESTAMP DEFAULT (CURRENT_TIMESTAMP - INTERVAL '1 day')
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        category VARCHAR(255) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        transaction_date DATE DEFAULT CURRENT_DATE
      )
    `);

    // Ensure older database schemas get the new column dynamically
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_date DATE DEFAULT CURRENT_DATE`);
    await pool.query(`UPDATE transactions SET transaction_date = DATE(created_at) WHERE transaction_date IS NULL`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        action VARCHAR(50) NOT NULL,
        details TEXT NOT NULL,
        performed_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS recurring_costs (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        billing_cycle VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        description TEXT,
        is_global BOOLEAN DEFAULT false,
        is_completed BOOLEAN DEFAULT false,
        deadline TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS description TEXT`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS investors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL
      )
    `);

    // Add manual ownership & profit share columns
    await pool.query(`ALTER TABLE investors ADD COLUMN IF NOT EXISTS ownership_pct DECIMAL(5,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE investors ADD COLUMN IF NOT EXISTS profit_share_pct DECIMAL(5,2) DEFAULT 0`);

    // App settings (for company savings %)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    await pool.query(`INSERT INTO app_settings (key, value) VALUES ('company_savings_pct', '0') ON CONFLICT DO NOTHING`);

    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS investor_name VARCHAR(255)`);

    // Auto-create founders
    const usersCount = await pool.query("SELECT COUNT(*) FROM users");
    if (parseInt(usersCount.rows[0].count) === 0) {
      const founders = [
        ["kaveesh@netigo", await bcrypt.hash("abhi123", 10), "superadmin"]
      ];

      for (let f of founders) {
        await pool.query("INSERT INTO users (username, password, role) VALUES ($1, $2, $3)", f);
      }
      console.log("🚀 Founders initialized!");

      // Default categories
      const defCats = ["Server Hosting", "Domain Renewal", "Client Payment", "Software License"];
      for (let c of defCats) {
        await pool.query("INSERT INTO categories (name) VALUES ($1) ON CONFLICT DO NOTHING", [c]);
      }
    }
  } catch (error) {
    console.error("Database initialization failed:", error);
  }
}
initDb();

// 🔒 Auth Middleware (JWT via Cookie)
function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect("/login");

  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
  } catch (err) {
    res.redirect("/login");
  }
}

// 🔒 SuperAdmin Middleware
function superAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect("/login");

  try {
    const user = jwt.verify(token, JWT_SECRET);
    if (user.role !== 'superadmin') return res.redirect("/");
    req.user = user;
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
  } catch (err) {
    res.redirect("/login");
  }
}

// ---------- AUTH LOGIC ----------
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    const user = result.rows[0];

    if (!user) return res.render("login", { error: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.render("login", { error: "Invalid credentials" });

    // Issue JWT cookie
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production" });
    res.redirect("/");
  } catch (error) {
    console.error(error);
    res.render("login", { error: "An error occurred during login" });
  }
});

app.get("/logout", async (req, res) => {
  try {
    const token = req.cookies.token;
    if (token) {
      const user = jwt.verify(token, JWT_SECRET);
      await pool.query("UPDATE users SET last_seen = NOW() - INTERVAL '1 day' WHERE id = $1", [user.id]);
    }
  } catch (err) {
    // Ignore invalid tokens on logout
  }
  res.clearCookie("token");
  res.redirect("/login");
});

// ---------- DASHBOARD ROUTES ----------
app.get("/", auth, async (req, res) => {
  try {
    const usersRes = await pool.query("SELECT id, username FROM users ORDER BY username ASC");
    res.render("dashboard", { user: req.user, allUsers: usersRes.rows });
  } catch (err) {
    res.render("dashboard", { user: req.user, allUsers: [] });
  }
});

app.get("/updates", auth, (req, res) => {
  res.render("updates", { user: req.user });
});

// ---------- NOTES API ----------
app.get("/api/notes", auth, async (req, res) => {
  try {
    const query = `
      SELECT n.*, creator.username as creator_name, assignee.username as assignee_name
      FROM notes n 
      JOIN users creator ON n.user_id = creator.id 
      LEFT JOIN users assignee ON n.assigned_to = assignee.id
      WHERE n.user_id = $1 OR n.assigned_to = $1 OR n.is_global = true 
      ORDER BY n.created_at DESC
    `;
    const result = await pool.query(query, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

app.post("/api/notes", auth, async (req, res) => {
  const { content, description, is_global, deadline, assigned_to } = req.body;
  if (!content) return res.status(400).json({ error: "Content is required" });

  try {
    let assignId = null;
    if (is_global && assigned_to && assigned_to !== 'all') {
      assignId = parseInt(assigned_to);
    }

    let deadlineTS = null;
    if (deadline) {
      deadlineTS = new Date(deadline);
    }

    await pool.query(
      "INSERT INTO notes (user_id, assigned_to, content, description, is_global, deadline) VALUES ($1, $2, $3, $4, $5, $6)",
      [req.user.id, assignId, content, description || null, is_global === true || is_global === 'true', deadlineTS]
    );
    dataVersion++;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to add note" });
  }
});

app.delete("/api/notes/completed/all", auth, async (req, res) => {
  try {
    if (req.user.role === 'superadmin') {
      await pool.query("DELETE FROM notes WHERE is_completed = true");
    } else {
      await pool.query("DELETE FROM notes WHERE is_completed = true AND (user_id = $1 OR assigned_to = $1)", [req.user.id]);
    }
    dataVersion++;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete completed notes" });
  }
});

app.delete("/api/notes/:id", auth, async (req, res) => {
  try {
    if (req.user.role === 'superadmin') {
      await pool.query("DELETE FROM notes WHERE id = $1", [req.params.id]);
    } else {
      const result = await pool.query("DELETE FROM notes WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
      if (result.rowCount === 0) return res.status(403).json({ error: "Unauthorized to delete this note" });
    }
    dataVersion++;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete note" });
  }
});

app.put("/api/notes/:id/toggle-complete", auth, async (req, res) => {
  try {
    // Only creator, assignee, or superadmin can modify
    const note = await pool.query("SELECT * FROM notes WHERE id = $1", [req.params.id]);
    if (note.rowCount === 0) return res.status(404).json({ error: "Note not found" });

    const n = note.rows[0];
    if (req.user.role !== 'superadmin' && n.user_id !== req.user.id && n.assigned_to !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await pool.query("UPDATE notes SET is_completed = NOT is_completed WHERE id = $1", [req.params.id]);
    dataVersion++;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to toggle note state" });
  }
});

// ---------- API ROUTES ----------
app.get("/api/transactions", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM transactions ORDER BY transaction_date DESC, created_at DESC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

app.post("/api/add", auth, async (req, res) => {
  const { type, category, amount, note, date, investor_name } = req.body;
  try {
    const tDate = date || new Date().toISOString().split('T')[0];

    await pool.query(
      "INSERT INTO transactions (type, category, amount, note, transaction_date, investor_name) VALUES ($1, $2, $3, $4, $5, $6)",
      [type, category, amount, note, tDate, type === 'investment' ? (investor_name || null) : null]
    );

    // Auto-add investor to presets
    if (type === 'investment' && investor_name && investor_name.trim()) {
      await pool.query("INSERT INTO investors (name) VALUES ($1) ON CONFLICT DO NOTHING", [investor_name.trim()]);
    }

    // Record to audit log
    await pool.query(
      "INSERT INTO audit_logs (action, details, performed_by) VALUES ($1, $2, $3)",
      ['INSERT', `Added ${type.toUpperCase()} of ₹${amount} for ${category}${investor_name ? ' by ' + investor_name : ''}`, req.user.username]
    );

    dataVersion++;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to add transaction" });
  }
});

app.get("/api/export", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM transactions ORDER BY transaction_date DESC, created_at DESC");
    if (result.rows.length === 0) {
      return res.status(404).send("No transactions found.");
    }

    // Quick manual CSV generation for simplicity
    let csv = "ID,Type,Category,Amount,Note,Investor,Date\n";
    result.rows.forEach(row => {
      const d = new Date(row.transaction_date || row.created_at);
      const dateStr = d.toISOString().split('T')[0];
      const safeNote = row.note ? `"${row.note.replace(/"/g, '""')}"` : "";
      const safeInvestor = row.investor_name ? `"${row.investor_name.replace(/"/g, '""')}"` : "";

      // Wrapping date in ="..." forces Excel to treat it as string bypassing the ###### width auto-formatting bug
      csv += `${row.id},${row.type},"${row.category}",${row.amount},${safeNote},${safeInvestor},="${dateStr}"\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('netigo_transactions.csv');
    return res.send(csv);
  } catch (error) {
    res.status(500).send("Failed to export data");
  }
});

app.post("/api/delete/:id", auth, async (req, res) => {
  try {
    // 1. Perform deletion
    const txRes = await pool.query("SELECT * FROM transactions WHERE id = $1", [req.params.id]);
    const tx = txRes.rows[0];
    if (tx) {
      await pool.query("DELETE FROM transactions WHERE id = $1", [req.params.id]);
      await pool.query(
        "INSERT INTO audit_logs (action, details, performed_by) VALUES ($1, $2, $3)",
        ['DELETE', `Deleted ${tx.type.toUpperCase()} of ₹${tx.amount} (${tx.category})`, req.user.username]
      );
    }
    dataVersion++;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete transaction" });
  }
});

// ---------- NEW FEATURES API ----------
// Ping to update last_seen
app.post("/api/ping", auth, async (req, res) => {
  try {
    await pool.query("UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1", [req.user.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Ping failed" });
  }
});

// Force Database Initialization
app.get("/api/init", async (req, res) => {
  try {
    await initDb();
    res.json({ success: true, message: "Database tables and founders have been successfully initialized." });
  } catch (error) {
    res.status(500).json({ error: "Failed to force database initialization." });
  }
});

// Real-Time Polling Tracker
app.get("/api/version", auth, (req, res) => {
  res.json({ version: dataVersion });
});

// Fetch all users with online status
app.get("/api/online", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        username, 
        role, 
        last_seen,
        CASE 
          WHEN last_seen >= NOW() - INTERVAL '10 seconds' THEN true 
          ELSE false 
        END as is_online
      FROM users 
      ORDER BY is_online DESC, username ASC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch online users" });
  }
});

// Fetch categories
app.get("/api/categories", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM categories ORDER BY name ASC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// Add new category
app.post("/api/categories", auth, async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query("INSERT INTO categories (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
    await pool.query(
      "INSERT INTO audit_logs (action, details, performed_by) VALUES ($1, $2, $3)",
      ['INSERT', `Added new category: ${name}`, req.user.username]
    );
    dataVersion++;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to add category" });
  }
});

// ---------- INVESTORS ROUTES ----------
app.get("/api/investors", auth, async (req, res) => {
  try {
    // Join with transactions to get total invested per investor
    const result = await pool.query(`
      SELECT i.id, i.name, i.ownership_pct, i.profit_share_pct,
        COALESCE(t.total_invested, 0) as invested
      FROM investors i
      LEFT JOIN (
        SELECT investor_name, SUM(amount) as total_invested
        FROM transactions WHERE type = 'investment' AND investor_name IS NOT NULL
        GROUP BY investor_name
      ) t ON t.investor_name = i.name
      ORDER BY i.name ASC
    `);
    // Also return company savings %
    const settingsRes = await pool.query("SELECT value FROM app_settings WHERE key = 'company_savings_pct'");
    const companySavingsPct = parseFloat(settingsRes.rows[0]?.value || '0');
    res.json({ investors: result.rows, companySavingsPct });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch investors" });
  }
});

app.post("/api/investors", auth, async (req, res) => {
  const { name, ownership_pct, profit_share_pct } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name required" });
  try {
    await pool.query(
      "INSERT INTO investors (name, ownership_pct, profit_share_pct) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET ownership_pct = $2, profit_share_pct = $3",
      [name.trim(), parseFloat(ownership_pct) || 0, parseFloat(profit_share_pct) || 0]
    );
    dataVersion++;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to add investor" });
  }
});

app.put("/api/investors/:id", auth, async (req, res) => {
  const { ownership_pct, profit_share_pct } = req.body;
  try {
    await pool.query(
      "UPDATE investors SET ownership_pct = $1, profit_share_pct = $2 WHERE id = $3",
      [parseFloat(ownership_pct) || 0, parseFloat(profit_share_pct) || 0, req.params.id]
    );
    dataVersion++;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to update investor" });
  }
});

app.delete("/api/investors/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM investors WHERE id = $1", [req.params.id]);
    dataVersion++;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete investor" });
  }
});

// Company Savings Settings
app.get("/api/settings/company-savings", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM app_settings WHERE key = 'company_savings_pct'");
    res.json({ companySavingsPct: parseFloat(result.rows[0]?.value || '0') });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

app.put("/api/settings/company-savings", auth, async (req, res) => {
  const { pct } = req.body;
  try {
    await pool.query("INSERT INTO app_settings (key, value) VALUES ('company_savings_pct', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [String(parseFloat(pct) || 0)]);
    dataVersion++;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// ---------- FINANCE SUMMARY ----------
app.get("/api/finance/summary", auth, async (req, res) => {
  const period = req.query.period || 'all';
  const fromDate = req.query.from || null;
  const toDate = req.query.to || null;
  try {
    let dateFilter = '';
    const params = [];

    if (fromDate && toDate) {
      dateFilter = `AND transaction_date >= $1 AND transaction_date <= $2`;
      params.push(fromDate, toDate);
    } else if (fromDate) {
      dateFilter = `AND transaction_date >= $1`;
      params.push(fromDate);
    } else if (toDate) {
      dateFilter = `AND transaction_date <= $1`;
      params.push(toDate);
    } else if (period === 'daily') dateFilter = "AND transaction_date >= CURRENT_DATE - INTERVAL '30 days'";
    else if (period === 'weekly') dateFilter = "AND transaction_date >= CURRENT_DATE - INTERVAL '12 weeks'";
    else if (period === 'monthly') dateFilter = "AND transaction_date >= CURRENT_DATE - INTERVAL '12 months'";
    else if (period === 'yearly') dateFilter = "AND transaction_date >= CURRENT_DATE - INTERVAL '5 years'";

    // Totals for this period
    const totals = await pool.query(`
      SELECT type, COALESCE(SUM(amount), 0) as total
      FROM transactions WHERE 1=1 ${dateFilter}
      GROUP BY type
    `, params);

    let totalIncome = 0, totalExpense = 0, totalInvestment = 0;
    totals.rows.forEach(r => {
      if (r.type === 'income') totalIncome = parseFloat(r.total);
      else if (r.type === 'expense') totalExpense = parseFloat(r.total);
      else if (r.type === 'investment') totalInvestment = parseFloat(r.total);
    });

    const grossProfit = totalIncome;
    const netProfit = totalIncome - totalExpense;

    // Company valuation = ALL TIME investments (not period-filtered)
    const valRes = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'investment'");
    const companyValuation = parseFloat(valRes.rows[0].total);

    // Investor breakdown (all-time investments for ownership %)
    const invRes = await pool.query(`
      SELECT investor_name, SUM(amount) as invested
      FROM transactions
      WHERE type = 'investment' AND investor_name IS NOT NULL AND investor_name != ''
      GROUP BY investor_name ORDER BY invested DESC
    `);

    const investors = invRes.rows.map(r => {
      const invested = parseFloat(r.invested);
      const share = companyValuation > 0 ? (invested / companyValuation) * 100 : 0;
      const profitShare = companyValuation > 0 ? (invested / companyValuation) * netProfit : 0;
      return { name: r.investor_name, invested, share: Math.round(share * 100) / 100, profitShare: Math.round(profitShare * 100) / 100 };
    });

    // Timeline data (always daily, frontend handles bucketing)
    const timeRes = await pool.query(`
      SELECT TO_CHAR(transaction_date, 'YYYY-MM-DD') as date, type, COALESCE(SUM(amount), 0) as total
      FROM transactions WHERE 1=1 ${dateFilter}
      GROUP BY date, type ORDER BY date ASC
    `, params);

    const timelineMap = {};
    timeRes.rows.forEach(r => {
      if (!timelineMap[r.date]) timelineMap[r.date] = { date: r.date, income: 0, expense: 0, investment: 0 };
      timelineMap[r.date][r.type] = parseFloat(r.total);
    });
    const timeline = Object.values(timelineMap);

    // Determine exact bounds for the frontend to pad zeros
    let startDate = fromDate;
    let endDate = toDate;

    if (!startDate || !endDate) {
      if (period === 'daily') { startDate = startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]; endDate = endDate || new Date().toISOString().split('T')[0]; }
      else if (period === 'weekly') { startDate = startDate || new Date(Date.now() - 12 * 7 * 86400000).toISOString().split('T')[0]; endDate = endDate || new Date().toISOString().split('T')[0]; }
      else if (period === 'monthly') { startDate = startDate || new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0]; endDate = endDate || new Date().toISOString().split('T')[0]; }
      else if (period === 'yearly') { startDate = startDate || new Date(Date.now() - 5 * 365 * 86400000).toISOString().split('T')[0]; endDate = endDate || new Date().toISOString().split('T')[0]; }
      else {
        // all time
        if (timeline.length > 0) startDate = timeline[0].date;
        endDate = new Date().toISOString().split('T')[0];
      }
    }

    res.json({ totalIncome, totalExpense, totalInvestment, grossProfit, netProfit, companyValuation, investors, timeline, startDate, endDate });
  } catch (error) {
    console.error("Finance summary error:", error);
    res.status(500).json({ error: "Failed to compute finance summary" });
  }
});

// ---------- RECURRING COSTS ROUTES ----------
app.get("/api/recurring", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM recurring_costs ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch recurring costs" });
  }
});

app.post("/api/recurring", auth, async (req, res) => {
  const { name, amount, billing_cycle } = req.body;

  if (!name || isNaN(amount) || !billing_cycle) {
    return res.status(400).json({ error: "Missing or invalid recurring cost data" });
  }

  const validCycles = ['daily', 'weekly', 'monthly', 'yearly'];
  if (!validCycles.includes(billing_cycle)) {
    return res.status(400).json({ error: "Invalid billing cycle" });
  }

  try {
    await pool.query(
      "INSERT INTO recurring_costs (name, amount, billing_cycle) VALUES ($1, $2, $3)",
      [name, parseFloat(amount), billing_cycle]
    );
    await pool.query(
      "INSERT INTO audit_logs (action, details, performed_by) VALUES ($1, $2, $3)",
      ['INSERT', `Added recurring cost: ${name} (₹${amount})`, req.user.username]
    );
    dataVersion++;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to add recurring cost" });
  }
});

app.delete("/api/recurring/:id", auth, async (req, res) => {
  try {
    const costRes = await pool.query("SELECT * FROM recurring_costs WHERE id = $1", [req.params.id]);
    const cost = costRes.rows[0];
    if (cost) {
      await pool.query("DELETE FROM recurring_costs WHERE id = $1", [req.params.id]);
      await pool.query(
        "INSERT INTO audit_logs (action, details, performed_by) VALUES ($1, $2, $3)",
        ['DELETE', `Deleted recurring cost: ${cost.name}`, req.user.username]
      );
    }
    dataVersion++;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete recurring cost" });
  }
});

// ---------- ADMIN PANEL (ALL USERS) ROUTES ----------
app.get("/admin", auth, async (req, res) => {
  try {
    const auditResult = await pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100");
    const usersRes = await pool.query("SELECT id, username FROM users ORDER BY username ASC");
    res.render("admin", { user: req.user, auditLogs: auditResult.rows, allUsers: usersRes.rows });
  } catch (error) {
    res.status(500).send("Error loading admin panel");
  }
});

app.get("/api/audit/export", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC");
    if (result.rows.length === 0) return res.status(404).send("No audit logs found.");

    let csv = "ID,Action,Details,Performed By,Date\n";
    result.rows.forEach(row => {
      const d = new Date(row.created_at);
      const dateStr = d.toISOString().replace('T', ' ').split('.')[0];
      const safeDetails = row.details ? `"${row.details.replace(/"/g, '""')}"` : "";
      csv += `${row.id},${row.action},${safeDetails},${row.performed_by},="${dateStr}"\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('netigo_audit_logs.csv');
    return res.send(csv);
  } catch (error) {
    res.status(500).send("Failed to export audit logs");
  }
});

app.post("/api/change-password", auth, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: "Password required" });
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    // User changes their own password
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.user.id]);
    await pool.query(
      "INSERT INTO audit_logs (action, details, performed_by) VALUES ($1, $2, $3)",
      ['UPDATE', `Changed own account password`, req.user.username]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update password" });
  }
});

// ---------- SUPERADMIN ONLY ROUTES ----------
app.get("/superadmin", superAuth, async (req, res) => {
  try {
    const usersResult = await pool.query("SELECT id, username, role, last_seen FROM users ORDER BY id ASC");

    // Audit Logging Management
    const auditResult = await pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC");
    const countResult = await pool.query("SELECT COUNT(*) FROM audit_logs WHERE created_at < NOW() - INTERVAL '30 days'");
    const pendingDeletions = parseInt(countResult.rows[0].count);

    res.render("superadmin", {
      user: req.user,
      usersList: usersResult.rows,
      allUsers: usersResult.rows,
      auditLogs: auditResult.rows,
      pendingDeletions: pendingDeletions
    });
  } catch (error) {
    res.status(500).send("Error loading superadmin panel");
  }
});

app.delete("/api/superadmin/audit/old", superAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '30 days'");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear old logs" });
  }
});

app.delete("/api/superadmin/audit/all", superAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM audit_logs");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear all logs" });
  }
});

app.delete("/api/superadmin/audit/:id", superAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM audit_logs WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete log" });
  }
});

app.post("/api/admin/change-password/:id", superAuth, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: "Password required" });
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const userRes = await pool.query("SELECT username FROM users WHERE id = $1", [req.params.id]);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.params.id]);
    if (userRes.rows[0]) {
      // Intentionally bypassed audit logging for superadmin actions
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update password" });
  }
});

app.post("/api/admin/add-user", superAuth, async (req, res) => {
  const { username, password, role } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (username, password, role) VALUES ($1, $2, $3)", [username, hash, role || 'admin']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to add user" });
  }
});

app.delete("/api/admin/delete-user/:id", superAuth, async (req, res) => {
  try {
    const userRes = await pool.query("SELECT username FROM users WHERE id = $1", [req.params.id]);
    if (userRes.rows[0]) {
      await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user" });
  }
});

if (process.env.NODE_ENV !== "production" || process.env.IS_VPS === "true") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🚀 Netigo Dashboard running on port ${port}`);
  });
}

// Auto-delete completed tasks older than 30 days (runs every hour)
async function cleanupOldCompleted() {
  try {
    const result = await pool.query(
      "DELETE FROM notes WHERE is_completed = true AND created_at < NOW() - INTERVAL '30 days'"
    );
    if (result.rowCount > 0) {
      console.log(`🧹 Auto-cleaned ${result.rowCount} completed tasks older than 30 days`);
      dataVersion++;
    }
  } catch (err) {
    console.error("Cleanup failed:", err.message);
  }
}
cleanupOldCompleted();
setInterval(cleanupOldCompleted, 60 * 60 * 1000); // Every hour

module.exports = app;
