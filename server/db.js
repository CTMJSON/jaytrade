import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'simulator.sqlite'));

db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cash REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS holdings (
    symbol TEXT PRIMARY KEY,
    quantity REAL NOT NULL,
    avg_cost REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    total REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'AUTO')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    condition TEXT NOT NULL CHECK (condition IN ('DROPS_BELOW', 'RISES_ABOVE')),
    trigger_price REAL NOT NULL,
    amount_usd REAL,
    quantity REAL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXECUTED', 'CANCELLED', 'FAILED')),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    executed_at TEXT
  );
`);

const tradeColumns = db.prepare("PRAGMA table_info(trades)").all().map((c) => c.name);
if (!tradeColumns.includes('source')) {
  db.exec("ALTER TABLE trades ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL'");
}

const startingCash = Number(process.env.STARTING_CASH || 100000);
const existing = db.prepare('SELECT id FROM account WHERE id = 1').get();
if (!existing) {
  db.prepare('INSERT INTO account (id, cash) VALUES (1, ?)').run(startingCash);
}

export default db;
