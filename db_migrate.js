const { Pool } = require("@neondatabase/serverless");
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function migrate() {
    const client = await pool.connect();
    console.log("Connected to Neon DB. Starting Migration...");
    try {
        // 1. Create audit_logs table
        await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        action VARCHAR(50) NOT NULL,
        details TEXT NOT NULL,
        performed_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        console.log("Audit logs table verified.");

        // 2. Add transaction_date column to transactions (if it doesn't exist)
        await client.query(`
      ALTER TABLE transactions 
      ADD COLUMN IF NOT EXISTS transaction_date DATE DEFAULT CURRENT_DATE
    `);
        console.log("Transaction date column verified.");

        // 3. Backfill any existing transactions
        await client.query(`
      UPDATE transactions 
      SET transaction_date = DATE(created_at) 
      WHERE transaction_date IS NULL
    `);
        console.log("Transactions backfilled with dates.");

        console.log("Migration completed successfully.");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();
