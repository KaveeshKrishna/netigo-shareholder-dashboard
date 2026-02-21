const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
const db = new sqlite3.Database("./database.db", (err) => {
  if (err) console.error("Database connection error:", err);
  else {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, -- 'investment', 'income', 'expense'
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Auto-create admin user if none exists
      db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (!err && row.count === 0) {
          bcrypt.hash("admin123", 10, (err, hash) => {
            if (!err) {
              db.run("INSERT INTO users (username, password) VALUES (?, ?)", ["admin", hash]);
              console.log("🚀 Default admin created (admin / admin123)");
            }
          });
        }
      });
    });
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(
  session({
    secret: "netigo-secret",
    resave: false,
    saveUninitialized: false
  })
);

// 🔒 Auth middleware
function auth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// ---------- AUTH ----------
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  db.get(
    "SELECT * FROM users WHERE username = ?",
    [username],
    async (err, user) => {
      if (!user) return res.render("login", { error: "Invalid credentials" });

      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.render("login", { error: "Invalid credentials" });

      req.session.user = user;
      res.redirect("/");
    }
  );
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ---------- DASHBOARD ----------
app.get("/", auth, (req, res) => {
  res.render("dashboard", { user: req.session.user });
});

// ---------- API ----------
app.get("/api/transactions", auth, (req, res) => {
  db.all(
    "SELECT * FROM transactions ORDER BY created_at DESC",
    [],
    (err, rows) => res.json(rows)
  );
});

app.post("/api/add", auth, (req, res) => {
  const { type, category, amount, note } = req.body;
  db.run(
    `INSERT INTO transactions (type, category, amount, note)
     VALUES (?, ?, ?, ?)`,
    [type, category, amount, note],
    () => res.json({ success: true })
  );
});

app.delete("/api/delete/:id", auth, (req, res) => {
  db.run(
    "DELETE FROM transactions WHERE id = ?",
    [req.params.id],
    () => res.json({ success: true })
  );
});

app.listen(3000, () => {
  console.log("🚀 Netigo Dashboard running on port 3000");
});
