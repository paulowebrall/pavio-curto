// Servidor do Pavio Curto: contas (Google), ranking, torneios, apoio (Pix), salas e partidas.
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

// lê o arquivo .env (CHAVE=valor), sem sobrescrever o que já veio do sistema
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* sem .env */ }

const express = require('express');
const { Server } = require('socket.io');
const { OAuth2Client } = require('google-auth-library');
const { createGame, STAGES, PETS, RULES_NOW } = require('./game');
const { db, save, newId, createSession, userFromToken, endSession } = require('./db');
const pay = require('./payments');

const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DEV_LOGIN = process.env.DEV_LOGIN === '1';
const ADMINS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const PIX_KEY = process.env.PIX_KEY || '';
const PIX_NAME = process.env.PIX_NAME || 'Pavio Curto', PIX_CITY = process.env.PIX_CITY || 'Brasil';   // aparecem no QR Code do Pix
const { pixQr } = require('./pix');
const TICK = 1000 / 60, STEP = 1 / 60, SEND_EVERY = 2, MAX_PLAYERS = 4;

// Pontos do ranking
const POINTS_BY_DIFF = { facil: 1, normal: 2, dificil: 3 };          // partida normal: pela dificuldade dos bots
const POINTS_BY_TOURNEY = { 2: 3, 3: 5, 5: 10 };                    // torneio: pelo número de vitórias
const EMOTES = ['zangado', 'sorrindo', 'dedo', 'dormindo'];
const NCHARS = 10;                                                  // personagens (igual ao game.js)
const MIN_HUMANS_FOR_POINTS = 1;                                    // vale ponto também contra bots; só ganha quem vence e está na sala até o fim

// Publicar numa subpasta (ex.: rotadevenda.com.br/pavio-curto): BASE_PATH=/pavio-curto
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const app = express();
app.set('trust proxy', 1);
if (BASE_PATH) {
  app.use((req, res, next) => {
    if (req.url === BASE_PATH) return res.redirect(301, BASE_PATH + '/');
    if (req.url.startsWith(BASE_PATH + '/')) { req.url = req.url.slice(BASE_PATH.length); return next(); }
    res.status(404).end();
  });
}
// limite de 100 KB para tudo, menos a exportação de imagens (só existe com PAVIO_EXPORT=1)
app.use((req, res, next) => req.path === '/__save' ? next() : express.json({ limit: '100kb' })(req, res, next));
// App de Android (Trusted Web Activity): prova que o app br.com.opaviocurto.app é deste site, para ele abrir em tela cheia sem a barra do Chrome.
// As impressões digitais (SHA-256) são públicas: a do APK de teste e, depois, a da Play Store (ANDROID_CERT_SHA256, separadas por vírgula).
const ANDROID_CERTS = ['70:67:B1:22:0B:53:DD:33:16:BF:2A:7D:94:94:6C:8E:8A:0C:AF:3C:3C:64:DD:F9:FA:BF:0C:D9:A1:69:32:7E']
  .concat((process.env.ANDROID_CERT_SHA256 || '').split(',').map(s => s.trim()).filter(Boolean));
app.get('/.well-known/assetlinks.json', (req, res) => res.json([{ relation: ['delegate_permission/common.handle_all_urls'],
  target: { namespace: 'android_app', package_name: 'br.com.opaviocurto.app', sha256_cert_fingerprints: ANDROID_CERTS } }]));
app.use(express.static(path.join(__dirname, 'public')));

// Só para gerar as imagens dos personagens: PAVIO_EXPORT=1 npm start e abrir /?sprites
if (process.env.PAVIO_EXPORT) {
  const dir = path.join(__dirname, 'imagens');
  fs.mkdirSync(dir, { recursive: true });
  app.post('/__save', express.json({ limit: '30mb' }), (req, res) => {
    const name = path.basename(String(req.body.name || '')).replace(/[^a-z0-9\-_.]/gi, '');
    const m = /^data:image\/png;base64,(.+)$/.exec(String(req.body.data || ''));
    if (!name.endsWith('.png') || !m) return res.status(400).end();
    fs.writeFileSync(path.join(dir, name), Buffer.from(m[1], 'base64'));
    res.end('ok');
  });
}

const server = http.createServer(app);
// perMessageDeflate: comprime os pacotes do jogo (o estado da arena repete muito e encolhe bastante), menos dados no celular
const io = new Server(server, { path: BASE_PATH + '/socket.io', perMessageDeflate: { threshold: 256 } });

// aceita "50", "50,00", "R$ 50", "1.250,50"
function parseMoney(v) {
  if (typeof v === 'number') return v;
  let s = String(v || '').replace(/[R$\s]/gi, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s); return Number.isFinite(n) ? n : NaN;
}

/* ======================= contas ======================= */
// dono = e-mail em ADMIN_EMAILS (no .env). Administrador = dono ou alguém que o dono promoveu pelo painel.
const TOURNEY_MIN_POINTS = 500;   // quem não é administrador precisa disso para criar torneio
const isOwner = u => !!u && ADMINS.includes(String(u.email || '').toLowerCase());
const isAdmin = u => isOwner(u) || (!!u && u.admin === true);
// acessórios só de enfeite (não dão poder): liberam com pontos; administrador tem todos
const GEAR = { bota: 10, escudo: 20, mascara: 30 };
const gearUnlocked = u => Object.keys(GEAR).filter(k => isAdmin(u) || ((u && u.points) || 0) >= GEAR[k]);
const gearOn = u => (u && Array.isArray(u.gear) ? u.gear : []).filter(k => gearUnlocked(u).includes(k));
const canCreateTourney = u => isAdmin(u) || ((u && u.points) || 0) >= TOURNEY_MIN_POINTS;
const pub = u => u && ({ nick: u.nick || null, points: u.points || 0, wins: u.wins || 0, supporter: !!u.supporter,
  admin: isAdmin(u), owner: isOwner(u), canCreate: canCreateTourney(u), createMin: TOURNEY_MIN_POINTS,
  canEmote: !!u.supporter || isAdmin(u), activeEntry: activeEntry(u),
  gear: gearOn(u), gearUnlocked: gearUnlocked(u), gearCost: GEAR });
// torneio em que a pessoa está inscrita e que ainda não acabou (só pode ter 1, exceto administradores)
function activeEntry(u) {
  const t = u && Object.values(db.tournaments).find(t => t.status !== 'encerrado' && (t.entrants || []).some(e => e.uid === u.uid));
  return t ? t.id : null;
}
const bearer = req => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
function auth(req, res, next) {
  const u = userFromToken(bearer(req));
  if (!u) return res.status(401).json({ error: 'Entre com sua conta para continuar.' });
  req.user = u; next();
}
const needNick = (req, res, next) => req.user.nick ? next() : res.status(400).json({ error: 'Escolha um nick primeiro.' });
const admin = (req, res, next) => isAdmin(req.user) ? next() : res.status(403).json({ error: 'Só um administrador pode fazer isso.' });
const owner = (req, res, next) => isOwner(req.user) ? next() : res.status(403).json({ error: 'Só o dono do jogo pode fazer isso.' });
const creator = (req, res, next) => canCreateTourney(req.user) ? next()
  : res.status(403).json({ error: `Para criar torneio você precisa de ${TOURNEY_MIN_POINTS} pontos (você tem ${req.user.points || 0}) ou ser administrador.` });
function upsertUser(uid, email, name) {
  const u = db.users[uid] || (db.users[uid] = { uid, email, name, nick: null, points: 0, wins: 0, supporter: false, donatedCents: 0, createdAt: Date.now() });
  u.email = email; u.name = name; save(); return u;
}

app.get('/api/config', (req, res) => res.json({
  googleClientId: GOOGLE_CLIENT_ID, devLogin: DEV_LOGIN,
  payments: pay.enabled() ? 'mercadopago' : 'manual', pixKey: pay.enabled() ? '' : PIX_KEY,
  points: { diff: POINTS_BY_DIFF, tourney: POINTS_BY_TOURNEY }
}));

const google = new OAuth2Client(GOOGLE_CLIENT_ID);
app.post('/api/login/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).json({ error: 'Login com Google ainda não foi configurado no servidor.' });
  try {
    const ticket = await google.verifyIdToken({ idToken: String(req.body.credential || ''), audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p.email_verified) return res.status(400).json({ error: 'Seu e-mail do Google ainda não foi verificado.' });
    const u = upsertUser('g:' + p.sub, p.email, p.name || '');
    res.json({ token: createSession(u.uid), user: pub(u) });
  } catch (e) { res.status(401).json({ error: 'Não foi possível confirmar seu login com o Google. Tente de novo.' }); }
});
// Login de teste (só com DEV_LOGIN=1), para testar sem configurar o Google
app.post('/api/login/dev', (req, res) => {
  if (!DEV_LOGIN) return res.status(404).end();
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 80);
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Digite um e-mail qualquer, como ana@teste.' });
  const u = upsertUser('dev:' + email, email, email.split('@')[0]);
  res.json({ token: createSession(u.uid), user: pub(u) });
});
app.post('/api/logout', (req, res) => { endSession(bearer(req)); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(pub(req.user)));

app.post('/api/nick', auth, (req, res) => {
  const nick = String(req.body.nick || '').trim();
  if (!/^[A-Za-z0-9_]{3,14}$/.test(nick)) return res.status(400).json({ error: 'O nick precisa ter de 3 a 14 letras, números ou _ (sem espaço nem acento).' });
  const key = nick.toLowerCase(), owner = db.nicks[key];
  if (owner && owner !== req.user.uid) return res.status(409).json({ error: 'Esse nick já é de outra pessoa. Escolha outro.' });
  if (req.user.nick && req.user.nick.toLowerCase() !== key) return res.status(400).json({ error: 'Você já escolheu seu nick.' });
  db.nicks[key] = req.user.uid; req.user.nick = nick; save();
  res.json(pub(req.user));
});

/* ======================= ranking ======================= */
app.get('/api/ranking', (req, res) => {
  const list = Object.values(db.users).filter(u => u.nick)
    .sort((a, b) => (b.points || 0) - (a.points || 0) || (b.wins || 0) - (a.wins || 0) || a.createdAt - b.createdAt)
    .slice(0, 100).map((u, i) => ({ pos: i + 1, nick: u.nick, points: u.points || 0, wins: u.wins || 0, supporter: !!u.supporter }));
  res.json(list);
});
function award(uid, pts) {
  const u = db.users[uid]; if (!u) return 0;
  u.points = (u.points || 0) + pts; u.wins = (u.wins || 0) + 1; save(); return pts;
}

/* ======================= torneios ======================= */
// status: arrecadando → pronto (barra cheia) → em_andamento (alguma batalha começou) → encerrado (tem campeão)
// Pré-inscrição: a pessoa entra na lista; quem criou o torneio (ou administrador) escolhe quem joga cada batalha.
// Rodadas (1 a 12): fase 1 tem N batalhas de até 4 jogadores. O vencedor de cada uma passa de fase,
// em batalhas de até 4, até sobrar uma: a Final.
const MAX_ROUNDS = 12, MAX_PRE = 48, DESC_MAX = 600;
const nickOf = uid => (db.users[uid] || {}).nick || '?';
const phaseOf = (t, ph) => t.matches.filter(m => m.phase === ph);
const lastPhase = t => Math.max(...t.matches.map(m => m.phase));
function addMatches(t, phase, count) {
  for (let i = 0; i < count; i++) t.matches.push({ id: newId(5), phase, n: i + 1, players: [], status: 'aguardando', winner: null, room: null });
}
function ensureBracket(t) {   // torneios antigos (sem rodadas) viram 1 rodada
  if (!t.matches) { t.rounds = t.rounds || 1; t.matches = []; addMatches(t, 1, t.rounds); }
  t.entrants = t.entrants || []; t.desc = t.desc || '';
}
function matchLabel(t, m) {
  if (phaseOf(t, m.phase).length === 1 && (m.phase > 1 || t.rounds === 1)) return 'Final';
  return m.phase === 1 ? 'Rodada ' + m.n : 'Fase ' + m.phase + ' · Batalha ' + m.n;
}
function tPub(t) {
  ensureBracket(t);
  return { id: t.id, name: t.name, by: (db.users[t.createdBy] || {}).nick || null, desc: t.desc, rounds: t.rounds,
    goalCents: t.goalCents, raisedCents: t.raisedCents, minPoints: t.minPoints, target: t.target,
    status: t.status, winner: t.winner || null, createdAt: t.createdAt, drawnAt: t.drawnAt || null, projected: projectBracket(t),
    entrants: t.entrants.map(e => nickOf(e.uid)), spots: MAX_PRE,
    matches: t.matches.map(m => ({ id: m.id, label: matchLabel(t, m), phase: m.phase, status: m.status,
      players: m.players.map(nickOf), winner: m.winner ? nickOf(m.winner) : null, room: m.room && rooms.has(m.room) ? m.room : null })) };
}
const canManage = (u, t) => isAdmin(u) || t.createdBy === u.uid;

// Sorteio: grupos de 4 na ordem; o que sobra vira o último grupo (10 → 4, 4, 2). Nunca deixa alguém sozinho: 9 → 4, 3, 2.
function groupSizes(n) {
  const sizes = []; for (let left = n; left > 0; left -= MAX_PLAYERS) sizes.push(Math.min(MAX_PLAYERS, left));
  if (sizes.length > 1 && sizes[sizes.length - 1] === 1) { sizes[sizes.length - 2]--; sizes[sizes.length - 1]++; }
  return sizes;
}
// Próximas fases que ainda não existem, até a final, para mostrar o caminho até o campeão.
// Segue a mesma regra de advance(): o vencedor i da fase vai para a batalha i % quantidade da fase seguinte.
function projectBracket(t) {
  if (t.status === 'encerrado' || !t.matches.length) return [];
  let ph = lastPhase(t), slots = phaseOf(t, ph).map(m => m.winner ? nickOf(m.winner) : 'Vencedor ' + matchLabel(t, m));
  const out = [];
  while (slots.length > 1) {
    ph++; const count = Math.ceil(slots.length / MAX_PLAYERS);
    const ms = Array.from({ length: count }, (_, i) => ({ label: count === 1 ? 'Final' : 'Fase ' + ph + ' · Batalha ' + (i + 1), slots: [] }));
    slots.forEach((s, i) => ms[i % count].slots.push(s));
    out.push({ phase: ph, matches: ms });
    slots = ms.map(m => 'Vencedor ' + m.label);
  }
  return out;
}

// depois de cada batalha: se a fase acabou, monta a próxima ou declara o campeão
function advance(t) {
  const ph = lastPhase(t), list = phaseOf(t, ph);
  if (list.some(m => m.status !== 'encerrada')) return null;
  const winners = list.map(m => m.winner).filter(Boolean);
  if (list.length === 1 || winners.length <= 1) {   // acabou a final (ou só sobrou um)
    t.status = 'encerrado';
    const champ = winners[0];
    t.winner = champ ? nickOf(champ) : null;
    let pts = 0;
    if (champ) pts = award(champ, POINTS_BY_TOURNEY[t.target]);
    return { champion: champ, points: pts };
  }
  const count = Math.ceil(winners.length / MAX_PLAYERS);
  addMatches(t, ph + 1, count);
  winners.forEach((uid, i) => phaseOf(t, ph + 1)[i % count].players.push(uid));
  return null;
}
const listTournaments = () => Object.values(db.tournaments).sort((a, b) => b.createdAt - a.createdAt).map(tPub);
const broadcastTournaments = () => io.emit('tournaments', listTournaments());
app.get('/api/tournaments', (req, res) => res.json(listTournaments()));

// Inscrição no torneio. Quem não é administrador só pode estar inscrito em 1 torneio por vez, até ele acabar.
// Quem se inscreve pelo link de convite de um amigo (ref = nick do amigo) ganha o selo de apoiador.
app.post('/api/tournaments/:id/register', auth, needNick, (req, res) => {
  const t = db.tournaments[req.params.id], u = req.user;
  if (!t) return res.status(404).json({ error: 'Torneio não encontrado.' });
  if (t.status === 'encerrado') return res.status(400).json({ error: 'Esse torneio já terminou.' });
  if (t.status === 'em_andamento') return res.status(400).json({ error: 'O torneio já começou. As pré-inscrições fecharam.' });
  ensureBracket(t);
  if (t.entrants.some(e => e.uid === u.uid)) return res.status(400).json({ error: 'Você já está pré-inscrito nesse torneio.' });
  if (t.entrants.length >= MAX_PRE) return res.status(400).json({ error: `A lista de pré-inscrição desse torneio está cheia (${MAX_PRE}).` });
  if ((u.points || 0) < t.minPoints) return res.status(400).json({ error: `Esse torneio é para quem tem ${t.minPoints} pontos ou mais. Você tem ${u.points || 0}.` });
  const other = activeEntry(u);
  if (other && !isAdmin(u)) return res.status(400).json({ error: `Você já está inscrito no torneio "${db.tournaments[other].name}". Só dá para estar em um torneio por vez, até ele acabar.` });
  const refUid = db.nicks[String(req.body.ref || '').trim().toLowerCase()];
  const viaFriend = !!refUid && refUid !== u.uid;
  t.entrants.push({ uid: u.uid, at: Date.now(), ref: viaFriend ? refUid : null });
  let badge = false;
  if (viaFriend && !u.supporter) { u.supporter = true; u.badgeVia = 'convite'; badge = true; }
  save(); broadcastTournaments();
  for (const s of io.sockets.sockets.values()) if (s.data.uid === u.uid) s.emit('me', pub(u));
  res.json({ ok: true, badge, me: pub(u) });
});
app.post('/api/tournaments', auth, needNick, creator, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  const goalCents = Math.round(parseMoney(req.body.goal) * 100);
  const minPoints = Math.max(0, Math.floor(Number(req.body.minPoints) || 0));
  const target = Number(req.body.target);
  const rounds = Math.floor(Number(req.body.rounds) || 1);
  const desc = String(req.body.desc || '').replace(/\r/g, '').trim().slice(0, DESC_MAX);
  if (!name) return res.status(400).json({ error: 'Dê um nome ao torneio.' });
  if (!(goalCents >= 100 && goalCents <= 10000000)) return res.status(400).json({ error: 'O valor do torneio precisa ser entre R$ 1 e R$ 100.000.' });
  if (![2, 3, 5].includes(target)) return res.status(400).json({ error: 'Escolha 2, 3 ou 5 vitórias.' });
  if (!(rounds >= 1 && rounds <= MAX_ROUNDS)) return res.status(400).json({ error: `Escolha de 1 a ${MAX_ROUNDS} rodadas.` });
  const t = { id: newId(6), name, desc, rounds, goalCents, raisedCents: 0, minPoints, target, status: 'arrecadando', createdAt: Date.now(), createdBy: req.user.uid, entrants: [], matches: [] };
  addMatches(t, 1, rounds);
  db.tournaments[t.id] = t; save(); broadcastTournaments(); res.json(tPub(t));
});

// Organizar: mover um pré-inscrito para uma batalha (ou tirar, com matchId vazio). Só quem criou ou administrador.
function tGuard(req, res) {
  const t = db.tournaments[req.params.id];
  if (!t) { res.status(404).json({ error: 'Torneio não encontrado.' }); return null; }
  ensureBracket(t);
  if (!canManage(req.user, t)) { res.status(403).json({ error: 'Só quem criou o torneio ou um administrador pode organizar as batalhas.' }); return null; }
  if (t.status === 'encerrado') { res.status(400).json({ error: 'Esse torneio já terminou.' }); return null; }
  return t;
}
app.post('/api/tournaments/:id/assign', auth, (req, res) => {
  const t = tGuard(req, res); if (!t) return;
  const uid = db.nicks[String(req.body.nick || '').trim().toLowerCase()];
  if (!uid) return res.status(404).json({ error: 'Não achei esse nick.' });
  const ph = lastPhase(t), pending = phaseOf(t, ph).filter(m => m.status === 'aguardando');
  const inPhase = phaseOf(t, ph).some(m => m.status !== 'aguardando' && (m.players.includes(uid)));
  if (inPhase) return res.status(400).json({ error: 'Essa pessoa está numa batalha que já começou ou terminou.' });
  if (ph === 1 && !t.entrants.some(e => e.uid === uid)) return res.status(400).json({ error: 'Só dá para colocar quem fez a pré-inscrição.' });
  const target = req.body.matchId ? pending.find(m => m.id === req.body.matchId) : null;
  if (req.body.matchId && !target) return res.status(400).json({ error: 'Essa batalha não está aguardando (já começou ou terminou).' });
  if (target && !target.players.includes(uid) && target.players.length >= MAX_PLAYERS) return res.status(400).json({ error: `Essa batalha já tem ${MAX_PLAYERS} jogadores.` });
  for (const m of pending) m.players = m.players.filter(x => x !== uid);
  if (target) target.players.push(uid);
  save(); broadcastTournaments(); refreshMatchLobbies(t); res.json({ ok: true });
});
// Distribuir automaticamente os pré-inscritos que ainda não estão em nenhuma batalha da fase 1
app.post('/api/tournaments/:id/autofill', auth, (req, res) => {
  const t = tGuard(req, res); if (!t) return;
  if (lastPhase(t) !== 1) return res.status(400).json({ error: 'A distribuição automática é só para a primeira fase.' });
  const pending = phaseOf(t, 1).filter(m => m.status === 'aguardando');
  const used = new Set(phaseOf(t, 1).flatMap(m => m.players));
  const free = t.entrants.map(e => e.uid).filter(u => !used.has(u));
  let placed = 0;
  for (const uid of free) {
    const m = pending.filter(x => x.players.length < MAX_PLAYERS).sort((a, b) => a.players.length - b.players.length)[0];
    if (!m) break; m.players.push(uid); placed++;
  }
  save(); broadcastTournaments(); refreshMatchLobbies(t); res.json({ ok: true, placed, left: free.length - placed });
});
// Sortear: embaralha todos os pré-inscritos e monta a primeira fase de novo (grupos de até 4).
// Pode sortear de novo enquanto nenhuma batalha começou.
app.post('/api/tournaments/:id/draw', auth, (req, res) => {
  const t = tGuard(req, res); if (!t) return;
  if (lastPhase(t) !== 1 || t.matches.some(m => m.status !== 'aguardando')) return res.status(400).json({ error: 'O torneio já começou. Não dá mais para sortear.' });
  if (t.matches.some(m => m.room && rooms.has(m.room))) return res.status(400).json({ error: 'Tem gente na sala de uma batalha. Feche a sala antes de sortear.' });
  const ids = t.entrants.map(e => e.uid);
  if (ids.length < 2) return res.status(400).json({ error: 'Precisa de pelo menos 2 pré-inscritos para sortear.' });
  for (let i = ids.length - 1; i > 0; i--) { const j = require('crypto').randomInt(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const sizes = groupSizes(ids.length);
  t.matches = []; t.rounds = sizes.length; addMatches(t, 1, sizes.length);
  let k = 0; t.matches.forEach((m, i) => { m.players = ids.slice(k, k + sizes[i]); k += sizes[i]; });
  t.drawnAt = Date.now();
  save(); broadcastTournaments(); res.json({ ok: true, sizes });
});
// W.O.: o organizador define o vencedor de uma batalha que não vai acontecer (ou encerra uma batalha vazia)
app.post('/api/tournaments/:id/walkover', auth, (req, res) => {
  const t = tGuard(req, res); if (!t) return;
  if (t.status === 'arrecadando') return res.status(400).json({ error: 'As batalhas só valem depois que a barra de apoio encher.' });
  const m = t.matches.find(x => x.id === req.body.matchId);
  if (!m || m.status !== 'aguardando') return res.status(400).json({ error: 'Essa batalha não está aguardando.' });
  t.status = 'em_andamento';
  if (m.room && rooms.has(m.room)) return res.status(400).json({ error: 'Tem gente na sala dessa batalha. Use a sala para jogar.' });
  const uid = req.body.nick ? db.nicks[String(req.body.nick).trim().toLowerCase()] : null;
  if (req.body.nick && !m.players.includes(uid)) return res.status(400).json({ error: 'O vencedor precisa ser um jogador dessa batalha.' });
  m.status = 'encerrada'; m.winner = uid || null;
  const end = advance(t);
  save(); broadcastTournaments();
  if (end && end.champion) for (const s of io.sockets.sockets.values()) if (s.data.uid === end.champion) s.emit('me', pub(db.users[end.champion]));
  res.json({ ok: true });
});
// administradores
app.get('/api/admin/admins', auth, owner, (req, res) => res.json(Object.values(db.users).filter(isAdmin)
  .map(u => ({ nick: u.nick || '(sem nick)', owner: isOwner(u) }))));
app.post('/api/admin/admins', auth, owner, (req, res) => {
  const key = String(req.body.nick || '').trim().toLowerCase(), uid = db.nicks[key], u = uid && db.users[uid];
  if (!u) return res.status(404).json({ error: 'Não achei ninguém com esse nick.' });
  if (isOwner(u)) return res.status(400).json({ error: 'Esse é um dono do jogo (definido no .env).' });
  u.admin = !!req.body.admin; save();
  for (const s of io.sockets.sockets.values()) if (s.data.uid === u.uid) s.emit('me', pub(u));
  res.json({ nick: u.nick, admin: isAdmin(u) });
});

app.post('/api/tournaments/:id/delete', auth, (req, res) => {
  const t = db.tournaments[req.params.id]; if (!t) return res.status(404).json({ error: 'Torneio não encontrado.' });
  if (!isAdmin(req.user) && t.createdBy !== req.user.uid) return res.status(403).json({ error: 'Só quem criou o torneio ou um administrador pode apagar.' });
  if (t.raisedCents > 0 && !isAdmin(req.user)) return res.status(400).json({ error: 'Esse torneio já recebeu apoio. Peça para um administrador apagar.' });
  if (t.status === 'em_andamento') return res.status(400).json({ error: 'O torneio está acontecendo agora. Espere terminar.' });
  delete db.tournaments[t.id]; save(); broadcastTournaments(); res.json({ ok: true });
});

/* ======================= apoio (doações) ======================= */
function dPub(d) { return { id: d.id, amountCents: d.amountCents, tournamentId: d.tournamentId, status: d.status, createdAt: d.createdAt, nick: (db.users[d.uid] || {}).nick || '?' }; }
function confirmDonation(d) {
  if (d.status === 'confirmada') return;
  d.status = 'confirmada'; d.confirmedAt = Date.now();
  const u = db.users[d.uid];
  if (u) { u.supporter = true; u.donatedCents = (u.donatedCents || 0) + d.amountCents; }
  const t = d.tournamentId && db.tournaments[d.tournamentId];
  if (t) { t.raisedCents += d.amountCents; if (t.status === 'arrecadando' && t.raisedCents >= t.goalCents) t.status = 'pronto'; }
  save(); broadcastTournaments();
  for (const s of io.sockets.sockets.values()) if (s.data.uid === d.uid) s.emit('me', pub(u));
}
app.post('/api/donations', auth, needNick, async (req, res) => {
  const amountCents = Math.round(parseMoney(req.body.amount) * 100);
  if (!(amountCents >= 100 && amountCents <= 500000)) return res.status(400).json({ error: 'Escolha um valor entre R$ 1 e R$ 5.000.' });
  let tournamentId = req.body.tournamentId || null;
  if (tournamentId) { const t = db.tournaments[tournamentId]; if (!t || t.status !== 'arrecadando') return res.status(400).json({ error: 'Esse torneio não está recebendo apoio agora.' }); }
  const d = { id: newId(8), uid: req.user.uid, amountCents, tournamentId, status: 'pendente', createdAt: Date.now() };
  if (pay.enabled()) {
    try {
      const t = tournamentId && db.tournaments[tournamentId];
      const p = await pay.createPix({ amountCents, email: req.user.email, description: 'Apoio Pavio Curto' + (t ? ' - ' + t.name : ''), ref: d.id });
      Object.assign(d, { mpId: p.mpId });
      db.donations[d.id] = d; save();
      return res.json({ donation: dPub(d), mode: 'mercadopago', qr: p.qr, qrImg: p.qrImg });
    } catch (e) { return res.status(502).json({ error: 'Não consegui gerar o Pix agora: ' + e.message }); }
  }
  db.donations[d.id] = d; save();
  // modo manual: gera o QR Code e o Pix copia e cola já com o valor (o identificador do apoio vai junto e aparece no seu extrato)
  let qr = '', qrImg = '';
  if (PIX_KEY) { try { const q = await pixQr({ key: PIX_KEY, name: PIX_NAME, city: PIX_CITY, amountCents, txid: 'PC' + d.id }); qr = q.code; qrImg = q.img; } catch (e) {} }
  res.json({ donation: dPub(d), mode: 'manual', pixKey: PIX_KEY, qr, qrImg });
});
app.get('/api/donations/mine', auth, (req, res) => res.json(Object.values(db.donations).filter(d => d.uid === req.user.uid).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map(dPub)));
app.get('/api/admin/donations', auth, admin, (req, res) => res.json(Object.values(db.donations).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map(dPub)));
app.post('/api/admin/donations/:id/:action', auth, admin, (req, res) => {
  const d = db.donations[req.params.id]; if (!d) return res.status(404).json({ error: 'Doação não encontrada.' });
  if (d.status !== 'pendente') return res.status(400).json({ error: 'Essa doação já foi resolvida.' });
  if (req.params.action === 'confirmar') confirmDonation(d);
  else if (req.params.action === 'recusar') { d.status = 'recusada'; save(); }
  else return res.status(400).end();
  res.json(dPub(d));
});
// confere os Pix pendentes no Mercado Pago a cada 15 s
setInterval(async () => {
  if (!pay.enabled()) return;
  for (const d of Object.values(db.donations)) {
    if (d.status !== 'pendente' || !d.mpId || Date.now() - d.createdAt > 24 * 3600e3) continue;
    try {
      const st = await pay.pixStatus(d.mpId);
      if (st === 'approved') confirmDonation(d);
      else if (['cancelled', 'rejected', 'refunded', 'charged_back'].includes(st)) { d.status = 'recusada'; save(); }
    } catch (e) { /* tenta de novo depois */ }
  }
}, 15000);

/* ======================= salas ======================= */
/** code -> { code, hostSid, members: [{sid,uid,name,char,supporter}], bots, diff, target, stage, tournament, game, loop } */
const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() { let c; do { c = Array.from({ length: 4 }, () => LETTERS[(Math.random() * LETTERS.length) | 0]).join(''); } while (rooms.has(c)); return c; }
const clampBots = r => { r.bots = r.tournament ? 0 : Math.max(0, Math.min(MAX_PLAYERS - r.members.length, r.bots)); };

const matchOfRoom = r => { const t = r.tournament && db.tournaments[r.tournament]; return t && t.matches ? t.matches.find(m => m.id === r.matchId) : null; };
function lobbyState(r) {
  const t = r.tournament && db.tournaments[r.tournament], m = matchOfRoom(r);
  return {
    code: r.code, hostSid: r.hostSid, bots: r.bots, diff: r.diff, target: r.target, stage: r.stage, petBoxes: r.petBoxes,
    members: r.members.map(m => ({ sid: m.sid, name: m.name, char: m.char, supporter: m.supporter, gear: m.gear || [] })),
    specs: r.specs.map(s => ({ sid: s.sid, name: s.name, supporter: s.supporter })),
    playing: !!r.game,
    tournament: t ? { name: t.name, target: t.target, minPoints: t.minPoints, desc: t.desc || '',
      stage: m ? matchLabel(t, m) : '', lineup: m ? m.players.map(nickOf) : [] } : null,
    points: t ? POINTS_BY_TOURNEY[t.target] : POINTS_BY_DIFF[r.diff],
    ranked: r.members.length >= MIN_HUMANS_FOR_POINTS, minHumans: MIN_HUMANS_FOR_POINTS
  };
}
const sendLobby = r => { io.to(r.code).emit('lobby', lobbyState(r)); roomsChanged(); };
// lista de salas abertas (sem as de torneio): vai para todo mundo na tela inicial, no máximo a cada 400 ms
function listRooms() {
  const out = [];
  if (ARENA.room && ARENA.room.game) { const r = ARENA.room, ps = r.game.snapshot().players;
    out.push({ code: r.code, arena: true, host: 'Arena ao vivo', players: 0, max: MAX_PLAYERS, bots: ps.length, diff: 'dificil', stage: r.game.snapshot().stage,
      target: 3, playing: true, specs: r.specs.length, names: ps.map(p => p.name), chars: ps.map(p => p.char) }); }
  for (const r of rooms.values()) {
    if (r.tournament || r.arena || !r.members.length) continue;
    const host = r.members.find(m => m.sid === r.hostSid) || r.members[0];
    out.push({ code: r.code, host: host.name, players: r.members.length, max: MAX_PLAYERS, bots: r.bots, diff: r.diff, stage: r.stage,
      target: r.target, playing: !!r.game, specs: r.specs.length, names: r.members.map(m => m.name), chars: r.members.map(m => m.char) });
  }
  return out.sort((a, b) => (b.arena ? 1 : 0) - (a.arena ? 1 : 0) || (a.playing - b.playing) || (b.players - a.players)).slice(0, 30);
}
let roomsTimer = null;
function roomsChanged() { if (roomsTimer) return; roomsTimer = setTimeout(() => { roomsTimer = null; io.emit('rooms', listRooms()); }, 400); }
function stopGame(r) { if (r.loop) clearInterval(r.loop); r.loop = null; r.game = null; roomsChanged(); }

function finishMatch(r) {
  const w = r.game.winner;
  const m = w.human && w.sid && r.members.find(x => x.sid === w.sid);
  const t = r.tournament && db.tournaments[r.tournament], tm = matchOfRoom(r);
  let pts = 0, stage = null, champion = false;
  const ranked = (r.humansAtStart || 0) >= MIN_HUMANS_FOR_POINTS;   // contra farm: sozinho contra bots não vale ponto
  if (t && tm) {
    // batalha do torneio: o vencedor passa de fase; pontos só para o campeão, no fim da final
    stage = matchLabel(t, tm);
    tm.status = 'encerrada'; tm.winner = w.uid || (m && m.uid) || null; tm.room = null;
    const end = advance(t);
    if (end && end.champion) { champion = true; pts = end.points; }
    r.tournament = null; r.matchId = null; save(); broadcastTournaments();
  } else if (m && ranked) pts = award(m.uid, POINTS_BY_DIFF[r.diff]);
  // guarda a gravação desta partida para quem estava na sala poder salvar
  if (r.rec) {
    const rec = r.rec; r.rec = null; delete rec.slot;
    rec.ticks = r.game.ticks; rec.winner = w.name; rec.tournament = t ? t.name + (stage ? ' · ' + stage : '') : null;
    rec.players = r.game.snapshot().players.map(p => p.name);
    r.lastRec = rec;
  }
  // todos os participantes para a tela final: foto (personagem + acessórios), rodadas e pontos no ranking
  const snap = r.game.snapshot();
  const players = snap.players.map(p => { const mm = p.human && p.sid && r.members.find(x => x.sid === p.sid), uid = (p.id === w.id && w.uid) || (mm && mm.uid), u = uid && db.users[uid];
    return { name: p.name, char: p.char, gear: p.gear || [], wins: p.wins, human: !!p.human, supporter: !!p.supporter, sid: p.sid || null,
      total: u ? (u.points || 0) : null, gained: p.id === w.id ? pts : 0, winner: p.id === w.id }; });
  io.to(r.code).emit('matchOver', { name: w.name, id: w.id, char: w.char, wins: w.wins, points: pts, ranked, human: !!m,
    tournament: t ? t.name : null, stage, champion, canSave: !!r.lastRec, target: snap.target, players });
  const winUid = w.uid || (m && m.uid);
  if (winUid && db.users[winUid]) for (const s of io.sockets.sockets.values()) if (s.data.uid === winUid) s.emit('me', pub(db.users[winUid]));
  stopGame(r); clampBots(r); sendLobby(r);
}
// quando o organizador muda a escalação, atualiza quem está na sala da batalha
function refreshMatchLobbies(t) { for (const m of t.matches) if (m.room && rooms.has(m.room)) sendLobby(rooms.get(m.room)); }

function startGame(r) {
  const seed = (Math.random() * 2 ** 31) | 0;
  r.game = createGame({ humans: r.members, bots: r.bots, diff: r.diff, target: r.target, stage: r.stage, seed, petBoxes: r.petBoxes }); roomsChanged();
  r.humansAtStart = r.members.length;
  // gravação: semente + configuração + os comandos de cada jogador (o replay repete a partida igualzinha)
  r.rec = { v: 1, pets: PETS.length, stages: STAGES.length, petBoxes: r.petBoxes, rules: RULES_NOW, id: newId(6), seed, at: Date.now(), stage: r.stage, bots: r.bots, diff: r.diff, target: r.target,
    humans: r.members.map(m => ({ name: m.name, char: m.char, supporter: !!m.supporter, gear: m.gear || [] })),
    slot: Object.fromEntries(r.members.map((m, i) => [m.sid, i])), ev: [] };
  r.lastRec = null;
  if (r.tournament) { const t = db.tournaments[r.tournament], tm = matchOfRoom(r); if (t) { t.status = 'em_andamento'; if (tm) tm.status = 'em_andamento'; save(); broadcastTournaments(); } }
  io.to(r.code).emit('started');
  let n = 0;
  r.loop = setInterval(() => {
    const g = r.game; if (!g) return;
    g.update(STEP);   // passo fixo: é isso que deixa o replay idêntico
    if (++n % SEND_EVERY === 0 || g.state === 'over') io.to(r.code).volatile.emit('state', g.snapshot());
    if (g.state === 'over') finishMatch(r);
  }, TICK);
  sendLobby(r);
}

/* ---------- Arena ao vivo: bots (com "(bot)" no nome) jogando sem parar, para quem chega ter algo para assistir ---------- */
// Só calcula e envia o estado quando tem alguém assistindo. Quem quer jogar vai para uma sala própria contra bots ("Jogar agora").
const ARENA = { room: null, pause: null };
function startArena() {
  let r = ARENA.room;
  if (!r) { r = { code: newCode(), arena: true, hostSid: null, members: [], specs: [], chat: [], bots: 4, diff: 'dificil', target: 3, stage: 'sorteio', petBoxes: 2, tournament: null, game: null, loop: null };
    rooms.set(r.code, r); ARENA.room = r; }
  r.game = createGame({ humans: [], bots: 4, diff: 'dificil', target: 3, stage: 'sorteio', seed: (Math.random() * 2 ** 31) | 0, petBoxes: 2 });
  io.to(r.code).emit('started'); roomsChanged();
  let n = 0;
  r.loop = setInterval(() => {
    const g = r.game; if (!g) return;
    g.update(STEP);
    if (r.specs.length && (++n % SEND_EVERY === 0 || g.state === 'over')) io.to(r.code).volatile.emit('state', g.snapshot());
    if (g.state === 'over') { clearInterval(r.loop); r.loop = null; ARENA.pause = setTimeout(startArena, 4000); }   // 4 s de vitória e começa outra
  }, TICK);
}
startArena();

/* ---------- replays: arquivos em data/replays ---------- */
const MAX_REPLAYS = 3, REPLAY_DIR = path.join(__dirname, 'data', 'replays');
function deleteReplay(u, id) {
  u.replays = (u.replays || []).filter(x => x.id !== id);
  try { fs.unlinkSync(path.join(REPLAY_DIR, path.basename(id) + '.json')); } catch (e) { /* já não existia */ }
  save();
}
function stopReplay(socket) { const rp = socket.data.replay; if (rp) { clearInterval(rp.timer); socket.data.replay = null; } }
app.get('/api/replays', auth, (req, res) => res.json(req.user.replays || []));
app.post('/api/replays/:id/delete', auth, (req, res) => {
  if (!(req.user.replays || []).some(x => x.id === req.params.id)) return res.status(404).json({ error: 'Gravação não encontrada.' });
  deleteReplay(req.user, req.params.id); res.json({ ok: true, list: req.user.replays });
});

/* ---------- chat da sala ---------- */
const CHAT_COOLDOWN = 15000, CHAT_MAX = 200, CHAT_KEEP = 40;
const lastChatByUser = new Map();   // por conta, para não burlar abrindo duas abas
function chatPush(r, msg) {
  msg.at = Date.now(); r.chat.push(msg); if (r.chat.length > CHAT_KEEP) r.chat.shift();
  io.to(r.code).emit('chat', msg);
}
const sysMsg = (r, text) => chatPush(r, { sys: true, text });

/* ---------- chat de voz (WebRTC): o áudio vai direto entre os aparelhos; o servidor só apresenta um ao outro ---------- */
const VOICE_MAX = 6;
const nickOfSock = s => (db.users[s.data.uid] || {}).nick || '?';
function voicePeers(socket) {
  const out = [];
  for (const id of io.sockets.adapter.rooms.get(socket.data.room) || []) {
    const s = io.sockets.sockets.get(id);
    if (s && s !== socket && s.data.voice) out.push({ sid: id, name: nickOfSock(s), muted: !!s.data.vmuted });
  }
  return out;
}
function voiceOff(socket, code) {
  if (!socket.data.voice) return;
  socket.data.voice = false; socket.data.vmuted = false;
  socket.to(code || socket.data.room).emit('voice:left', { sid: socket.id });
}

function leaveRoom(socket) {
  const code = socket.data.room; if (!code) return;
  voiceOff(socket, code);
  socket.data.room = null; socket.data.spectator = false; socket.leave(code);
  const r = rooms.get(code); if (!r) return;
  const spec = r.specs.find(s => s.sid === socket.id);
  if (spec) { r.specs = r.specs.filter(s => s !== spec); sysMsg(r, spec.name + ' parou de assistir'); return sendLobby(r); }
  const mem = r.members.find(m => m.sid === socket.id);
  r.members = r.members.filter(m => m.sid !== socket.id);
  if (mem && r.members.length) sysMsg(r, mem.name + ' saiu da sala');
  if (r.game) {
    if (r.rec && socket.id in r.rec.slot) r.rec.ev.push([r.game.ticks, r.rec.slot[socket.id], 'saiu']);   // no replay ele também vira bot
    r.game.dropHuman(socket.id); if (!r.game.humansLeft()) { stopGame(r); r.rec = null; }
  }
  if (!r.members.length) {
    stopGame(r); rooms.delete(code); roomsChanged();
    io.to(code).emit('roomClosed', { reason: 'Todos os jogadores saíram, então a sala fechou.' });   // avisa quem estava assistindo
    for (const s of r.specs) { const so = io.sockets.sockets.get(s.sid); if (so) { so.leave(code); so.data.room = null; so.data.spectator = false; } }
    const tm = matchOfRoom(r);
    if (tm && tm.status !== 'encerrada') { tm.status = 'aguardando'; tm.room = null; save(); broadcastTournaments(); }   // ninguém ficou: a batalha volta a aguardar
    return;
  }
  if (r.hostSid === socket.id) r.hostSid = r.members[0].sid;
  clampBots(r); sendLobby(r);
}
function joinMember(socket, r) {
  const u = db.users[socket.data.uid];
  const taken = new Set(r.members.map(m => m.char));
  r.members.push({ sid: socket.id, uid: u.uid, name: u.nick, char: [...Array(NCHARS).keys()].find(c => !taken.has(c)), supporter: !!u.supporter, gear: gearOn(u) });
  socket.join(r.code); socket.data.room = r.code; socket.data.spectator = false;
  socket.emit('chatHistory', r.chat); sysMsg(r, u.nick + ' entrou para jogar');
}
const MAX_SPECS = 30;
function joinSpectator(socket, r) {
  const u = db.users[socket.data.uid];
  r.specs.push({ sid: socket.id, uid: u.uid, name: u.nick, supporter: !!u.supporter });
  socket.join(r.code); socket.data.room = r.code; socket.data.spectator = true;
  socket.emit('chatHistory', r.chat); sysMsg(r, u.nick + ' está assistindo');
}
// Uma conta só joga numa sala por vez: se a mesma conta já está como jogador numa sala por outra aba ou
// outro aparelho, não pode criar sala nem entrar para jogar em outra. Assistir continua liberado.
function busyElsewhere(socket) {
  for (const r of rooms.values()) if (r.members.some(m => m.uid === socket.data.uid && m.sid !== socket.id)) return r;
  return null;
}
const busyMsg = r => r.game
  ? `Você já está jogando uma partida na sala ${r.code} (em outra aba ou aparelho). Termine ou saia dela antes de entrar em outra.`
  : `Você já está na sala ${r.code} (em outra aba ou aparelho). Saia dela antes de criar ou entrar em outra.`;
function quickPlay(socket, ack) {
  const busy = busyElsewhere(socket); if (busy) return ack && ack({ ok: false, error: busyMsg(busy) });
  leaveRoom(socket);
  const r = newRoom(socket, { bots: 3, diff: 'normal', stage: 'sorteio' });
  startGame(r);
  ack && ack(roomAck(socket, r));
}
const roomAck = (socket, r) => ({ ok: true, code: r.code, you: socket.id, spectator: !!socket.data.spectator, playing: !!r.game || !!r.arena });
const newRoom = (socket, extra) => {
  const r = Object.assign({ code: newCode(), hostSid: socket.id, members: [], specs: [], chat: [], bots: 1, diff: 'normal', target: 3, stage: 'padrao', petBoxes: 1, tournament: null, game: null, loop: null }, extra);
  rooms.set(r.code, r); joinMember(socket, r); return r;
};

// só entra no socket quem está logado e já tem nick
io.use((socket, next) => {
  const u = userFromToken(socket.handshake.auth && socket.handshake.auth.token);
  if (!u) return next(new Error('login'));
  if (!u.nick) return next(new Error('nick'));
  socket.data.uid = u.uid; next();
});

// versão do site: muda a cada publicação; a página aberta compara e se atualiza sozinha
const BUILD = String(fs.statSync(path.join(__dirname, 'public', 'index.html')).mtimeMs | 0) + '-' + String(fs.statSync(path.join(__dirname, 'game.js')).mtimeMs | 0);
io.on('connection', socket => {
  socket.emit('build', BUILD);
  socket.emit('tournaments', listTournaments());
  socket.emit('rooms', listRooms());

  // Pular para o resultado: todos os jogadores de verdade já caíram e só sobraram bots
  socket.on('skipRound', (_, ack) => {
    const r = rooms.get(socket.data.room);
    if (!r || !r.game || r.arena || !r.members.some(m => m.sid === socket.id)) return ack && ack({ ok: false });
    if (r.game.humansAlive()) return ack && ack({ ok: false, error: 'Ainda tem jogador vivo na partida.' });
    const n = r.game.skipRound();
    if (n) sysMsg(r, 'Rodada adiantada: só tinha bots vivos');
    ack && ack({ ok: !!n });
  });
  // voz: entrar, sair, mutar e repassar a negociação da conexão (só entre quem está na voz da mesma sala)
  socket.on('voice:join', (_, ack) => {
    const r = rooms.get(socket.data.room);
    if (!r) return ack && ack({ ok: false, error: 'Entre numa sala para usar a voz.' });
    if (r.arena) return ack && ack({ ok: false, error: 'A Arena ao vivo não tem voz. Crie uma sala ou jogue com os amigos.' });
    if (socket.data.voice) return ack && ack({ ok: true, peers: voicePeers(socket) });
    const peers = voicePeers(socket);
    if (peers.length >= VOICE_MAX) return ack && ack({ ok: false, error: `A voz desta sala está cheia (${VOICE_MAX} pessoas).` });
    socket.data.voice = true; socket.data.vmuted = false;
    socket.to(r.code).emit('voice:joined', { sid: socket.id, name: nickOfSock(socket), muted: false });
    ack && ack({ ok: true, peers });
  });
  socket.on('voice:leave', () => voiceOff(socket));
  socket.on('voice:mute', ({ muted } = {}) => {
    if (!socket.data.voice) return;
    socket.data.vmuted = !!muted; socket.to(socket.data.room).emit('voice:mute', { sid: socket.id, muted: !!muted });
  });
  socket.on('voice:signal', ({ to, data } = {}) => {
    const t = typeof to === 'string' && io.sockets.sockets.get(to);
    if (!t || !socket.data.voice || !t.data.voice || t.data.room !== socket.data.room) return;
    if (!data || JSON.stringify(data).length > 20000) return;   // oferta/resposta/candidato: mensagem pequena
    t.emit('voice:signal', { from: socket.id, data });
  });
  // Jogar agora: sala própria com 3 bots, a partida já começa
  socket.on('quickPlay', (_, ack) => quickPlay(socket, ack));
  socket.on('create', (_, ack) => {
    const busy = busyElsewhere(socket); if (busy) return ack && ack({ ok: false, error: busyMsg(busy) });
    leaveRoom(socket);
    const r = newRoom(socket, {});
    ack && ack(roomAck(socket, r)); sendLobby(r);
  });

  // entrar numa sala para jogar (as: 'player') ou só para assistir (as: 'spectator')
  socket.on('join', ({ code, as } = {}, ack) => {
    code = String(code || '').toUpperCase().trim();
    const r = rooms.get(code);
    if (!r) return ack && ack({ ok: false, error: 'Sala não encontrada. Confira o código.' });
    if (as === 'spectator') {
      if (r.specs.length >= MAX_SPECS) return ack && ack({ ok: false, error: 'Essa sala já tem muita gente assistindo.' });
      leaveRoom(socket); joinSpectator(socket, r);
      ack && ack(roomAck(socket, r)); return sendLobby(r);
    }
    const busy = busyElsewhere(socket); if (busy) return ack && ack({ ok: false, error: busyMsg(busy) });
    if (r.arena) return quickPlay(socket, ack);   // quer jogar na arena: vai para uma sala própria contra bots
    if (r.game) return ack && ack({ ok: false, error: 'Essa sala já está no meio de uma partida. Você pode entrar para assistir.' });
    if (r.members.length >= MAX_PLAYERS) return ack && ack({ ok: false, error: 'A sala está cheia (4 jogadores).' });
    const tm = matchOfRoom(r);
    if (tm && !tm.players.includes(socket.data.uid)) return ack && ack({ ok: false, error: 'Você não está escalado para essa batalha do torneio. Você pode assistir.' });
    leaveRoom(socket); joinMember(socket, r); clampBots(r);
    ack && ack(roomAck(socket, r)); sendLobby(r);
  });

  // entrar numa batalha do torneio: só com a barra cheia. Jogar = estar escalado nela; assistir = qualquer pessoa.
  socket.on('joinMatch', ({ id, matchId, as } = {}, ack) => {
    const t = db.tournaments[id];
    if (!t) return ack && ack({ ok: false, error: 'Torneio não encontrado.' });
    ensureBracket(t);
    if (t.status === 'arrecadando') return ack && ack({ ok: false, error: 'A barra de apoio ainda não encheu. As batalhas só abrem quando chegar no valor total do torneio.' });
    const tm = t.matches.find(m => m.id === matchId);
    if (!tm) return ack && ack({ ok: false, error: 'Batalha não encontrada.' });
    const r = tm.room && rooms.get(tm.room);
    if (as === 'spectator') {
      if (!r) return ack && ack({ ok: false, error: 'Essa batalha ainda não foi aberta. Ela abre quando o primeiro jogador escalado entrar.' });
      if (r.specs.length >= MAX_SPECS) return ack && ack({ ok: false, error: 'Essa sala já tem muita gente assistindo.' });
      if (!r.specs.some(s => s.sid === socket.id)) { leaveRoom(socket); joinSpectator(socket, r); }
      ack && ack(roomAck(socket, r)); return sendLobby(r);
    }
    if (tm.status === 'encerrada') return ack && ack({ ok: false, error: 'Essa batalha já terminou.' });
    if (!tm.players.includes(socket.data.uid)) return ack && ack({ ok: false, error: 'Você não está escalado para essa batalha. Quem organiza o torneio escolhe quem joga. Você pode assistir.' });
    const busy = busyElsewhere(socket); if (busy) return ack && ack({ ok: false, error: busyMsg(busy) });
    if (r) {
      if (r.game) return ack && ack({ ok: false, error: 'Essa batalha já começou. Você pode assistir.' });
      if (!r.members.some(m => m.sid === socket.id)) { leaveRoom(socket); joinMember(socket, r); }
      ack && ack(roomAck(socket, r)); return sendLobby(r);
    }
    leaveRoom(socket);
    const nr = newRoom(socket, { tournament: t.id, matchId: tm.id, bots: 0, target: t.target });
    tm.room = nr.code; save(); broadcastTournaments();
    ack && ack(roomAck(socket, nr)); sendLobby(nr);
  });

  // chat: 1 mensagem a cada 15 s por pessoa
  socket.on('chat', ({ text } = {}, ack) => {
    const r = rooms.get(socket.data.room), u = db.users[socket.data.uid];
    if (!r || !u) return ack && ack({ ok: false, error: 'Entre numa sala para conversar.' });
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!text) return ack && ack({ ok: false, error: 'Escreva uma mensagem.' });
    const now = Date.now(), last = lastChatByUser.get(u.uid) || 0, wait = CHAT_COOLDOWN - (now - last);
    if (wait > 0) return ack && ack({ ok: false, wait: Math.ceil(wait / 1000), error: `Espere ${Math.ceil(wait / 1000)} s para mandar outra mensagem.` });
    lastChatByUser.set(u.uid, now);
    chatPush(r, { name: u.nick, supporter: !!u.supporter, spectator: !!socket.data.spectator, text });
    ack && ack({ ok: true, wait: CHAT_COOLDOWN / 1000 });
  });

  // vestir/tirar acessórios (fica salvo na conta; na sala, aparece para todo mundo)
  socket.on('gear', ({ gear } = {}, ack) => {
    const u = db.users[socket.data.uid]; if (!u || !Array.isArray(gear)) return;
    const ok = gearUnlocked(u); u.gear = [...new Set(gear.filter(k => ok.includes(k)))]; save();
    const r = rooms.get(socket.data.room), m = r && r.members.find(x => x.sid === socket.id);
    if (m && !r.game) { m.gear = u.gear; sendLobby(r); }
    if (typeof ack === 'function') ack({ ok: true, gear: u.gear });
  });
  socket.on('pick', ({ char } = {}) => {
    const r = rooms.get(socket.data.room); if (!r || r.game) return;
    const me = r.members.find(m => m.sid === socket.id);
    if (!me || !Number.isInteger(char) || char < 0 || char >= NCHARS) return;
    if (r.members.some(m => m !== me && m.char === char)) return;
    me.char = char; sendLobby(r);
  });

  socket.on('settings', (s = {}) => {
    const r = rooms.get(socket.data.room);
    if (!r || r.hostSid !== socket.id || r.game) return;
    if (['padrao', 'fogo', 'agua', 'trem', 'deserto', 'mata', 'mar', 'ceu', 'gelo', 'sorteio'].includes(s.stage)) r.stage = s.stage;
    if ([0, 1, 2, 3, 4].includes(s.petBoxes)) r.petBoxes = s.petBoxes;
    if (!r.tournament) {   // no torneio, bots e vitórias são fixos
      if (Number.isInteger(s.bots)) r.bots = s.bots;
      if (['facil', 'normal', 'dificil'].includes(s.diff)) r.diff = s.diff;
      if ([2, 3, 5].includes(s.target)) r.target = s.target;
    }
    clampBots(r); sendLobby(r);
  });

  socket.on('start', (_, ack) => {
    const r = rooms.get(socket.data.room);
    if (!r || r.hostSid !== socket.id || r.game) return;
    if (r.tournament && r.members.length < 2) return ack && ack({ ok: false, error: 'A batalha do torneio precisa de pelo menos 2 jogadores escalados na sala (sem bots). Se alguém não vier, o organizador pode dar W.O.' });
    if (r.members.length + r.bots < 2) return ack && ack({ ok: false, error: 'Precisa de pelo menos 2 participantes. Espere alguém entrar ou adicione um bot.' });
    startGame(r); ack && ack({ ok: true });
  });

  socket.on('input', input => {
    const r = rooms.get(socket.data.room);
    if (r && r.game && input && typeof input === 'object') {
      const inp = { dir: ['u', 'd', 'l', 'r'].includes(input.dir) ? input.dir : null, alt: ['u', 'd', 'l', 'r'].includes(input.alt) ? input.alt : null, bomb: !!input.bomb, pet: !!input.pet };
      r.game.setInput(socket.id, inp);
      if (r.rec && socket.id in r.rec.slot && r.rec.ev.length < 300000) r.rec.ev.push([r.game.ticks, r.rec.slot[socket.id], inp.dir || '', inp.bomb ? 1 : 0, inp.pet ? 1 : 0, inp.alt || '']);
    }
  });

  // figurinhas de pensamento: só para apoiadores, no máximo 1 a cada 1,5 s
  socket.on('emote', ({ k } = {}) => {
    const r = rooms.get(socket.data.room), u = db.users[socket.data.uid];
    if (!r || !u || !(u.supporter || isAdmin(u)) || !EMOTES.includes(k) || !r.members.some(m => m.sid === socket.id)) return;   // apoiador ou administrador, e só quem está jogando
    const now = Date.now(); if (now - (socket.data.lastEmote || 0) < 1500) return;
    socket.data.lastEmote = now;
    io.to(r.code).emit('emote', { sid: socket.id, k });
  });

  /* ---------- replays ---------- */
  // gravar a última partida da sala (até 3 por pessoa; com "replace" troca uma das antigas)
  socket.on('saveReplay', ({ replace } = {}, ack) => {
    const r = rooms.get(socket.data.room), u = db.users[socket.data.uid];
    const rec = r && r.lastRec;
    if (!u) return ack && ack({ ok: false, error: 'Entre com sua conta.' });
    if (!rec) return ack && ack({ ok: false, error: 'Não tem partida terminada nesta sala para gravar.' });
    u.replays = u.replays || [];
    if (u.replays.some(x => x.recId === rec.id)) return ack && ack({ ok: false, error: 'Você já gravou esta partida.' });
    if (replace) {
      if (!u.replays.some(x => x.id === replace)) return ack && ack({ ok: false, error: 'Gravação para substituir não encontrada.' });
      deleteReplay(u, replace);
    }
    if (u.replays.length >= MAX_REPLAYS) return ack && ack({ ok: false, full: true, list: u.replays, error: `Você já tem ${MAX_REPLAYS} partidas gravadas. Escolha uma para substituir.` });
    const id = newId(8);
    fs.mkdirSync(REPLAY_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPLAY_DIR, id + '.json'), JSON.stringify(rec));
    u.replays.push({ id, recId: rec.id, at: rec.at, savedAt: Date.now(), stage: rec.stage, winner: rec.winner, players: rec.players, secs: Math.round(rec.ticks / 60), tournament: rec.tournament });
    save(); ack && ack({ ok: true, list: u.replays });
  });
  // assistir: o servidor repete a partida e manda só para quem está assistindo
  socket.on('watchReplay', ({ id } = {}, ack) => {
    const u = db.users[socket.data.uid];
    if (!u || !(u.replays || []).some(x => x.id === id)) return ack && ack({ ok: false, error: 'Gravação não encontrada.' });
    let rec; try { rec = JSON.parse(fs.readFileSync(path.join(REPLAY_DIR, id + '.json'), 'utf8')); } catch (e) { return ack && ack({ ok: false, error: 'Não consegui abrir essa gravação.' }); }
    leaveRoom(socket); stopReplay(socket);
    const g = createGame({ humans: rec.humans.map((h, i) => ({ sid: 'r' + i, name: h.name, char: h.char, supporter: h.supporter, gear: h.gear })),
      bots: rec.bots, diff: rec.diff, target: rec.target, stage: rec.stage, seed: rec.seed, pets: rec.pets || 3, stages: rec.stages, petBoxes: rec.petBoxes, rules: rec.rules || 1 });
    const rp = { g, ev: rec.ev, k: 0, paused: false, speed: 1, n: 0, total: rec.ticks || 0 };
    rp.timer = setInterval(() => {
      if (rp.paused) return;
      for (let s = 0; s < rp.speed && g.state !== 'over'; s++) {
        while (rp.k < rp.ev.length && rp.ev[rp.k][0] <= g.ticks) {   // aplica os comandos gravados neste passo
          const e = rp.ev[rp.k++];
          if (e[2] === 'saiu') g.dropHuman('r' + e[1]);
          else g.setInput('r' + e[1], { dir: e[2] || null, alt: e[5] || null, bomb: !!e[3], pet: !!e[4] });
        }
        g.update(STEP);
      }
      if (++rp.n % SEND_EVERY === 0 || g.state === 'over') { const sn = g.snapshot(); sn.replay = { t: g.ticks, total: rp.total, paused: rp.paused, speed: rp.speed }; socket.emit('state', sn); }
      if (g.state === 'over') { const w = g.winner; const sn = g.snapshot(); socket.emit('replayEnd', { name: w.name, char: w.char, id: w.id, wins: w.wins, target: sn.target, players: sn.players.map(p => ({ name: p.name, char: p.char, gear: p.gear || [], wins: p.wins, human: !!p.human, supporter: !!p.supporter, total: null, gained: 0, winner: p.id === w.id })) }); stopReplay(socket); }
    }, TICK);
    socket.data.replay = rp;
    ack && ack({ ok: true, meta: u.replays.find(x => x.id === id) });
  });
  socket.on('replayCtl', ({ pause, speed } = {}) => {
    const rp = socket.data.replay; if (!rp) return;
    if (typeof pause === 'boolean') rp.paused = pause;
    if ([1, 2, 4].includes(speed)) rp.speed = speed;
  });
  socket.on('replayStop', () => stopReplay(socket));

  socket.on('leave', () => leaveRoom(socket));
  socket.on('disconnect', () => { leaveRoom(socket); stopReplay(socket); });
});

server.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`Pavio Curto rodando em http://localhost:${PORT}${BASE_PATH}/`);
  lan.forEach(ip => console.log(`Na mesma rede Wi-Fi: http://${ip}:${PORT}`));
  console.log('Login Google:', GOOGLE_CLIENT_ID ? 'configurado' : 'NÃO configurado' + (DEV_LOGIN ? ' (login de teste ligado)' : ''));
  console.log('Pix:', pay.enabled() ? 'Mercado Pago automático' : 'manual (organizador confirma)' + (PIX_KEY ? '' : ' - defina PIX_KEY'));
  console.log('Organizadores:', ADMINS.length ? ADMINS.join(', ') : 'nenhum (defina ADMIN_EMAILS)');
});
