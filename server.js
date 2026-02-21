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
    // Note: We are dropping tables for testing / schema evolution since the user approved it
    await pool.query("DROP TABLE IF EXISTS users CASCADE");
    await pool.query("DROP TABLE IF EXISTS categories CASCADE");

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
    const result = await pool.query("SELECT * FROM transactions ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

app.post("/api/add", auth, async (req, res) => {
  const { type, category, amount, note } = req.body;
  try {
    await pool.query(
      "INSERT INTO transactions (type, category, amount, note) VALUES ($1, $2, $3, $4)",
      [type, category, amount, note]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to add transaction" });
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
    await pool.query("DELETE FROM transactions WHERE id = $1", [req.params.id]);
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

// ---------- ADMIN PANEL ROUTES ----------
app.get("/admin", superAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, username, role, last_seen FROM users ORDER BY id ASC");
    res.render("admin", { user: req.user, usersList: result.rows });
  } catch (error) {
    res.status(500).send("Error loading admin panel");
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
