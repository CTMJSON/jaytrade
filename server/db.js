import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'simulator.sqlite'));

db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    pin_hash TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    cash REAL NOT NULL,
    starting_cash REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// One-time migration from the old single-tenant schema (a lone `account` row with id=1,
// and holdings/trades/orders with no owner) into the multi-tenant one below. Existing data
// is preserved under a freshly-created account rather than discarded.
const legacyAccountTableExists = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='account'")
  .get();

const holdingsTableInfo = db.prepare("PRAGMA table_info(holdings)").all();
const holdingsNeedsMigration = holdingsTableInfo.length > 0 && !holdingsTableInfo.some((c) => c.name === 'account_id');

if (legacyAccountTableExists && holdingsNeedsMigration) {
  const legacy = db.prepare('SELECT cash FROM account WHERE id = 1').get();
  const legacyCash = legacy?.cash ?? Number(process.env.STARTING_CASH || 100000);
  const startingCash = Number(process.env.STARTING_CASH || 100000);

  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = crypto.scryptSync(pin, salt, 64).toString('hex');

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO accounts (name, pin_hash, pin_salt, cash, starting_cash) VALUES (?, ?, ?, ?, ?)'
    ).run('legacy', pinHash, salt, legacyCash, startingCash);
    const legacyAccountId = db.prepare('SELECT id FROM accounts WHERE name = ?').get('legacy').id;

    db.exec('ALTER TABLE holdings RENAME TO holdings_old');
    db.exec('ALTER TABLE trades RENAME TO trades_old');
    db.exec('ALTER TABLE orders RENAME TO orders_old');

    db.exec(`
      CREATE TABLE holdings (
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        symbol TEXT NOT NULL,
        quantity REAL NOT NULL,
        avg_cost REAL NOT NULL,
        PRIMARY KEY (account_id, symbol)
      );
      CREATE TABLE trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        quantity REAL NOT NULL,
        price REAL NOT NULL,
        total REAL NOT NULL,
        source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'AUTO')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
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

    db.exec(`INSERT INTO holdings (account_id, symbol, quantity, avg_cost)
              SELECT ${legacyAccountId}, symbol, quantity, avg_cost FROM holdings_old`);
    db.exec(`INSERT INTO trades (account_id, symbol, side, quantity, price, total, source, created_at)
              SELECT ${legacyAccountId}, symbol, side, quantity, price, total, source, created_at FROM trades_old`);
    db.exec(`INSERT INTO orders (account_id, symbol, side, condition, trigger_price, amount_usd, quantity, status, note, created_at, executed_at)
              SELECT ${legacyAccountId}, symbol, side, condition, trigger_price, amount_usd, quantity, status, note, created_at, executed_at FROM orders_old`);

    db.exec('DROP TABLE holdings_old');
    db.exec('DROP TABLE trades_old');
    db.exec('DROP TABLE orders_old');
    db.exec('DROP TABLE account');

    db.exec('COMMIT');
    console.log(`[migration] Existing portfolio preserved as account "legacy" - PIN: ${pin}`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS holdings (
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    symbol TEXT NOT NULL,
    quantity REAL NOT NULL,
    avg_cost REAL NOT NULL,
    PRIMARY KEY (account_id, symbol)
  );

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
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
    account_id INTEGER NOT NULL REFERENCES accounts(id),
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

// Auto-trigger support: which strategy role an order/fill belongs to, plus an armed flag so
// a breakout-buy can exist but stay inert until a trim fires. Added via ALTER rather than in
// the CREATE TABLE above so existing rows on already-deployed databases pick them up too.
const ordersColumns = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
if (!ordersColumns.includes('role')) {
  db.exec("ALTER TABLE orders ADD COLUMN role TEXT NOT NULL DEFAULT 'MANUAL'");
}
if (!ordersColumns.includes('tier')) {
  db.exec('ALTER TABLE orders ADD COLUMN tier TEXT');
}
if (!ordersColumns.includes('armed')) {
  db.exec('ALTER TABLE orders ADD COLUMN armed INTEGER NOT NULL DEFAULT 1');
}

const tradesColumns = db.prepare('PRAGMA table_info(trades)').all().map((c) => c.name);
if (!tradesColumns.includes('trigger_role')) {
  db.exec('ALTER TABLE trades ADD COLUMN trigger_role TEXT');
}

export default db;
