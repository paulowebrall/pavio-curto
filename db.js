// Banco de dados simples em arquivo (data/db.json). Bom para um grupo de amigos.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'data', 'db.json');
const db = { users: {}, nicks: {}, sessions: {}, tournaments: {}, donations: {} };
try { Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { /* primeiro uso */ }

let timer = null;
function writeNow() {
  timer = null;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, FILE);
}
function save() { if (!timer) timer = setTimeout(writeNow, 150); }
process.on('exit', () => { if (timer) { clearTimeout(timer); writeNow(); } });
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => process.exit(0)));

const newId = (n = 9) => crypto.randomBytes(n).toString('base64url');
const hash = t => crypto.createHash('sha256').update(t).digest('hex');

// sessões: guardamos só o hash do token
function createSession(uid) {
  const token = newId(32);
  db.sessions[hash(token)] = { uid, exp: Date.now() + 30 * 24 * 3600e3 };
  save(); return token;
}
function userFromToken(token) {
  if (!token) return null;
  const s = db.sessions[hash(String(token))];
  if (!s || s.exp < Date.now()) return null;
  return db.users[s.uid] || null;
}
function endSession(token) { delete db.sessions[hash(String(token || ''))]; save(); }

module.exports = { db, save, newId, createSession, userFromToken, endSession };
