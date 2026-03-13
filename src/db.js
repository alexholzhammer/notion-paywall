const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'paywall.db');

// Ensure data directory exists
const fs = require('fs');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function initDb() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS paid_users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      email     TEXT    NOT NULL UNIQUE,
      stripe_session_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS access_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      token      TEXT    NOT NULL UNIQUE,
      email      TEXT    NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (email) REFERENCES paid_users(email)
    );
  `);

  console.log('Database initialised at', DB_PATH);
}

function addPaidUser(email, stripeSessionId) {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT OR IGNORE INTO paid_users (email, stripe_session_id)
    VALUES (?, ?)
  `);
  return stmt.run(email, stripeSessionId);
}

function isPaidEmail(email) {
  const database = getDb();
  const row = database.prepare('SELECT id FROM paid_users WHERE email = ?').get(email);
  return !!row;
}

function saveAccessToken(token, email) {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO access_tokens (token, email) VALUES (?, ?)
  `);
  return stmt.run(token, email);
}

function getEmailByToken(token) {
  const database = getDb();
  const row = database.prepare(`
    SELECT at.email
    FROM access_tokens at
    JOIN paid_users pu ON pu.email = at.email
    WHERE at.token = ?
  `).get(token);
  return row ? row.email : null;
}

module.exports = { initDb, addPaidUser, isPaidEmail, saveAccessToken, getEmailByToken };
