const express = require("express");
const { Pool } = require("@neondatabase/serverless");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const path = require("path");

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-netigo-key";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://user:pass@host/db", // Ensure you set DATABASE_URL in Vercel
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

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
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL
      )
    `);

    // Auto-create founders
    const usersCount = await pool.query("SELECT COUNT(*) FROM users");
    if (parseInt(usersCount.rows[0].count) === 0) {
      const founders = [
        ["kaveesh@netigo", await bcrypt.hash("netigo#kaveesh@125", 10), "superadmin"]
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
app.get("/", auth, (req, res) => {
  res.render("dashboard", { user: req.user });
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
  const { type, category, amount, note, date } = req.body;
  try {
    const tDate = date || new Date().toISOString().split('T')[0];

    await pool.query(
      "INSERT INTO transactions (type, category, amount, note, transaction_date) VALUES ($1, $2, $3, $4, $5)",
      [type, category, amount, note, tDate]
    );

    // Record to audit log
    await pool.query(
      "INSERT INTO audit_logs (action, details, performed_by) VALUES ($1, $2, $3)",
      ['INSERT', `Added ${type.toUpperCase()} of ₹${amount} for ${category}`, req.user.username]
    );

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
    let csv = "ID,Type,Category,Amount,Note,Date\n";
    result.rows.forEach(row => {
      const d = new Date(row.transaction_date || row.created_at);
      const dateStr = d.toISOString().split('T')[0];
      const safeNote = row.note ? `"${row.note.replace(/"/g, '""')}"` : "";

      // Wrapping date in ="..." forces Excel to treat it as string bypassing the ###### width auto-formatting bug
      csv += `${row.id},${row.type},"${row.category}",${row.amount},${safeNote},="${dateStr}"\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('netigo_transactions.csv');
    return res.send(csv);
  } catch (error) {
    res.status(500).send("Failed to export data");
  }
});

app.post("/api/delete/:id", auth, async (req, res) => {
  const { password } = req.body;
  try {
    // 1. Verify user password securely
    const userRes = await pool.query("SELECT password FROM users WHERE id = $1", [req.user.id]);
    const user = userRes.rows[0];
    if (!user) return res.status(403).json({ error: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Incorrect password" });

    // 2. Perform deletion
    const txRes = await pool.query("SELECT * FROM transactions WHERE id = $1", [req.params.id]);
    const tx = txRes.rows[0];
    if (tx) {
      await pool.query("DELETE FROM transactions WHERE id = $1", [req.params.id]);
      await pool.query(
        "INSERT INTO audit_logs (action, details, performed_by) VALUES ($1, $2, $3)",
        ['DELETE', `Deleted ${tx.type.toUpperCase()} of ₹${tx.amount} (${tx.category})`, req.user.username]
      );
    }
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

// Fetch all users with online status
app.get("/api/online", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        username, 
        role, 
        last_seen,
        CASE 
          WHEN last_seen >= NOW() - INTERVAL '5 minutes' THEN true 
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
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to add category" });
  }
});

// ---------- ADMIN PANEL (ALL USERS) ROUTES ----------
app.get("/admin", auth, async (req, res) => {
  try {
    const auditResult = await pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100");
    res.render("admin", { user: req.user, auditLogs: auditResult.rows });
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
      auditLogs: auditResult.rows,
      pendingDeletions: pendingDeletions
    });
  } catch (error) {
    res.status(500).send("Error loading superadmin panel");
  }
});

app.delete("/api/superadmin/audit/old", superAuth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  try {
    const userResult = await pool.query("SELECT password FROM users WHERE id = $1", [req.user.id]);
    const match = await bcrypt.compare(password, userResult.rows[0].password);
    if (!match) return res.status(403).json({ error: "Invalid password" });

    await pool.query("DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '30 days'");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear old logs" });
  }
});

app.delete("/api/superadmin/audit/all", superAuth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  try {
    const userResult = await pool.query("SELECT password FROM users WHERE id = $1", [req.user.id]);
    const match = await bcrypt.compare(password, userResult.rows[0].password);
    if (!match) return res.status(403).json({ error: "Invalid password" });

    await pool.query("DELETE FROM audit_logs");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear all logs" });
  }
});

app.delete("/api/superadmin/audit/:id", superAuth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  try {
    const userResult = await pool.query("SELECT password FROM users WHERE id = $1", [req.user.id]);
    const match = await bcrypt.compare(password, userResult.rows[0].password);
    if (!match) return res.status(403).json({ error: "Invalid password" });

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
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.params.id]);
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

if (process.env.NODE_ENV !== "production") {
  app.listen(3000, () => {
    console.log("🚀 Netigo Dashboard running on port 3000");
  });
}

module.exports = app;
