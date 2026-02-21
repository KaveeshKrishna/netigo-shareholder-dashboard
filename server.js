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
app.use(express.static("public"));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Database Initialization (Auto-Create Schema)
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password TEXT NOT NULL
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

    // Auto-create admin user if none exists
    const usersCount = await pool.query("SELECT COUNT(*) FROM users");
    if (parseInt(usersCount.rows[0].count) === 0) {
      const hash = await bcrypt.hash("admin123", 10);
      await pool.query("INSERT INTO users (username, password) VALUES ($1, $2)", ["admin", hash]);
      console.log("🚀 Default admin created (admin / admin123)");
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
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production" });
    res.redirect("/");
  } catch (error) {
    console.error(error);
    res.render("login", { error: "An error occurred during login" });
  }
});

app.get("/logout", (req, res) => {
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

app.delete("/api/delete/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM transactions WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete transaction" });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.listen(3000, () => {
    console.log("🚀 Netigo Dashboard running on port 3000");
  });
}

module.exports = app;
