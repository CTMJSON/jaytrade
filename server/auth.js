import crypto from 'node:crypto';
import db from './db.js';

const NAME_PATTERN = /^[a-zA-Z0-9_-]{2,20}$/;
const PIN_PATTERN = /^\d{4,8}$/;

class AuthError extends Error {}

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 64).toString('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function register(name, pin, startingCash) {
  if (!NAME_PATTERN.test(name)) {
    throw new AuthError('Name must be 2-20 characters: letters, numbers, - or _');
  }
  if (!PIN_PATTERN.test(pin)) {
    throw new AuthError('PIN must be 4-8 digits');
  }
  const existing = db.prepare('SELECT id FROM accounts WHERE name = ?').get(name);
  if (existing) throw new AuthError('That name is already taken');

  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = hashPin(pin, salt);
  const info = db
    .prepare('INSERT INTO accounts (name, pin_hash, pin_salt, cash, starting_cash) VALUES (?, ?, ?, ?, ?)')
    .run(name, pinHash, salt, startingCash, startingCash);

  return createSession(info.lastInsertRowid);
}

export function login(name, pin) {
  const account = db.prepare('SELECT id, pin_hash, pin_salt FROM accounts WHERE name = ?').get(name);
  if (!account) throw new AuthError('Account not found');
  const attemptHash = hashPin(pin, account.pin_salt);
  if (!timingSafeEqual(attemptHash, account.pin_hash)) {
    throw new AuthError('Incorrect PIN');
  }
  return createSession(account.id);
}

function createSession(accountId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, account_id) VALUES (?, ?)').run(token, accountId);
  return token;
}

export function getAccountForToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT accounts.id, accounts.name, accounts.cash, accounts.starting_cash
       FROM sessions JOIN accounts ON accounts.id = sessions.account_id
       WHERE sessions.token = ?`
    )
    .get(token);
  return row || null;
}

export function logout(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const account = getAccountForToken(token);
  if (!account) return res.status(401).json({ error: 'Not logged in' });
  req.account = account;
  next();
}

export { AuthError };
