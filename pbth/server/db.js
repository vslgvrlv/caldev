import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database stored in a file named 'paintball.db'
const dbPath = join(__dirname, 'paintball.db');
const db = new sqlite3.Database(dbPath);

// Initialize Tables
db.serialize(() => {
  // Users
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    nickname TEXT,
    avatar TEXT,
    role TEXT,
    status TEXT,
    balance REAL DEFAULT 0
  )`);

  // Events
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    teamId TEXT,
    type TEXT,
    title TEXT,
    description TEXT,
    startDate TEXT,
    location TEXT,
    cost REAL,
    schedule JSON
  )`);

  // RSVPs (Who is going to which event)
  db.run(`CREATE TABLE IF NOT EXISTS rsvps (
    eventId TEXT,
    userId TEXT,
    status TEXT,
    PRIMARY KEY (eventId, userId)
  )`);

  // Transactions
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    type TEXT,
    amount REAL,
    title TEXT,
    date TEXT,
    userId TEXT,
    userName TEXT
  )`);
  
  // Team Info
  db.run(`CREATE TABLE IF NOT EXISTS team (
    id TEXT PRIMARY KEY,
    name TEXT,
    budget REAL
  )`);

  // --- SEED INITIAL DATA (If empty) ---
  db.get("SELECT count(*) as count FROM users", (err, row) => {
    if (row.count === 0) {
      console.log("Seeding database...");
      const stmt = db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)");
      stmt.run("u1", "Alex Paint", "Sniper_Alex", "https://i.pravatar.cc/150?u=sniper", "CAPTAIN", "ACTIVE", 0);
      stmt.run("u2", "Dmitry Ivanov", "Demon", "https://i.pravatar.cc/150?u=demon", "ADMIN", "ACTIVE", 1500);
      stmt.run("u3", "Ivan Petrov", "Tank", "https://i.pravatar.cc/150?u=tank", "PLAYER", "ACTIVE", -2000);
      stmt.finalize();

      db.run("INSERT INTO team VALUES (?, ?, ?)", ["t1", "Headshot Gladiators", 45000]);
    }
  });
});

export default db;