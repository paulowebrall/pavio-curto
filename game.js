// Simulação da partida. Roda só no servidor (autoritativo): os navegadores
// mandam comandos e recebem o estado pronto para desenhar.
const COLS = 15, ROWS = 13, N = COLS * ROWS;
const idx = (x, y) => y * COLS + x;
const inB = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS = { u: { x: 0, y: -1 }, d: { x: 0, y: 1 }, l: { x: -1, y: 0 }, r: { x: 1, y: 0 } };
const BOT_NAMES = ['Brasa', 'Gelo', 'Broto', 'Faísca', 'Kaze', 'Estrela', 'Canela', 'Trovão', 'Marconis', 'Walker'];
const NCHARS = BOT_NAMES.length;   // 10 personagens
const SPAWNS = [[1, 1], [13, 11], [13, 1], [1, 11]];
const PU_TEXT = { bomb: '+1 BOMBA', fire: '+ ALCANCE', speed: '+ VELOCIDADE', kick: 'CHUTE!', glove: 'LUVINHA!', cat: 'GATO!', roo: 'CANGURU!', tank: 'TANQUE!', lion: 'LEÃO!', dragon: 'DRAGÃO!', toucan: 'TUCABUM!' };
// Luvinha: arremessa a bomba 3 casas. Se cair em bloco/bomba, quica 1 casa por vez. Na parede de fora, sai do outro lado.
const THROW_DIST = 3, THROW_TIME = .35, BOUNCE_TIME = .13;
// Velocidade de andar: 1/3 mais lenta que a versão anterior (3.4 → 2.27 casas/s).
const SPEED0 = 3.4 * 2 / 3, SPEED_STEP = .55 * 2 / 3, SPEED_MAX = 6.2 * 2 / 3;
const KICK_STEP = .14;          // bomba chutada anda 1 casa a cada 0,14 s (metade da velocidade antiga)
// Pets: tempo de recarga da habilidade (s)
const PET_CD = { cat: 3, roo: 1, tank: .6, lion: 7, dragon: 4, toucan: 6 };
const RULES_NOW = 6;   // 3 = bots usam bem os poderes dos pets; 4 = poder do pet não atravessa bomba; 5 = diagonal inteligente e esquina tolerante para jogadores; 6 = ovo do Tucabum vira mina
const PETS = ['cat', 'roo', 'tank', 'lion', 'dragon', 'toucan'];   // novos pets entram sempre no fim (replays antigos sorteiam só entre os primeiros)
// Tucabum: bota um ovo-mina que explode se outro jogador encostar (dura 3 s). Regras 5: o ovo chocava e o filhote perseguia
const EGG_HATCH = .6, CHICK_LIFE = 2.5, CHICK_SPEED = 3.8, CHICK_RANGE = 1, EGG_MINE_TIME = 3;
// Leão: escudo com cara de leão que segura o fogo por um tempo. Dragão: cospe fogo 3 casas e deixa quem pegar atordoado
const LION_TIME = 2.5, BREATH_LEN = 3, BREATH_SHOW = .5, STUN_TIME = 2;
const DASH_TIME = 1, DASH_MULT = 2.2, JUMP_TIME = .4, UNMOUNT_SHIELD = 1.5;
// Fases
const STAGES = ['padrao', 'fogo', 'agua', 'trem', 'deserto', 'mata', 'mar', 'ceu', 'gelo'];
// Gelo: 2 casas de gelo rachado por rodada; depois de 3 passadas o gelo abre um buraco e ninguém passa mais ali
const CRACKS = 2, CRACK_PASSES = 3;
// Fundo do mar: a baleia surge numa casa, engole quem estiver nela e cospe 3 s depois
const WHALE_WARN = 1.6, WHALE_HOLD = 3, WHALE_EMERGE = .6;   // mergulha com quem engoliu e reaparece em outro lugar 0,6 s antes de cuspir
// Deserto: tornado que ocupa 1 casa, anda um tempo e arremessa quem pegar
const TORNADO_WARN = 1.5, TORNADO_LIFE = 6, TORNADO_STEP = .45;
// Mata: túneis de folhas de 5 ou 6 casas, sorteados a cada rodada; quem passa por baixo some da vista
const LEAF_TUNNELS = [2, 3], LEAF_LEN = [5, 6];
// Trem: trilho na linha do meio, entra por uma das pontas e atravessa a arena
const TRAIN_LEN = 4, TRAIN_SPEED = 7, TRAIN_WARN = 2.2;   // 4 carros (locomotiva + 3 vagões), 7 casas/s, 2,2 s de aviso
// 5 traçados de trilho com curvas; a cada rodada sorteia um.
// Cada traçado é uma lista de pontos de virada; o 1º e o último ficam na parede de fora (são os túneis).
const TRACK_LAYOUTS = [
  { name: 'Zigue-zague', way: [[0, 4], [4, 4], [4, 8], [10, 8], [10, 4], [14, 4]] },
  { name: 'Curva em U', way: [[5, 0], [5, 9], [9, 9], [9, 0]] },
  { name: 'Escada', way: [[0, 3], [3, 3], [3, 6], [7, 6], [7, 9], [14, 9]] },
  { name: 'Volta grande', way: [[0, 8], [5, 8], [5, 3], [9, 3], [9, 8], [14, 8]] },
  { name: 'Reta do meio', way: [[0, 6], [14, 6]] }
];
function buildPath(way) {   // liga os pontos de virada casa por casa
  const cells = [way[0].slice()];
  for (let i = 1; i < way.length; i++) {
    let [x, y] = cells[cells.length - 1]; const [tx, ty] = way[i];
    while (x !== tx || y !== ty) { x += Math.sign(tx - x); y += Math.sign(ty - y); cells.push([x, y]); }
  }
  return cells;
}
// posição (x, y) de algo a "f" casas do começo do caminho; fora das pontas, continua reto (dentro do túnel)
function pathPos(cells, f) {
  const L = cells.length;
  if (f <= 0) { const [a, b] = [cells[0], cells[1]]; return [a[0] + (a[0] - b[0]) * -f, a[1] + (a[1] - b[1]) * -f]; }
  if (f >= L - 1) { const [a, b] = [cells[L - 1], cells[L - 2]]; const e = f - (L - 1); return [a[0] + (a[0] - b[0]) * e, a[1] + (a[1] - b[1]) * e]; }
  const i = Math.floor(f), k = f - i, a = cells[i], b = cells[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}
const VOLCANOES = [[4, 4], [10, 4], [4, 8], [10, 8]];   // fogo: vulcões no lugar de 4 pilares
const VOLC_RANGE = 2, RUMBLE = 1.6;                     // alcance da erupção e tempo de aviso (tremendo)
const RIVER_X = [5, 9];                                 // água: 2 rios que descem das cachoeiras
const DRIFT = 1.1, BOMB_DRIFT_STEP = .55;               // correnteza empurra jogadores e bombas para baixo
const DIFF = {
  facil: { aggr: .3, cd: 1.6, react: .5, hunt: .3 },
  normal: { aggr: .65, cd: .8, react: .25, hunt: .65 },
  dificil: { aggr: .95, cd: .3, react: .06, hunt: 1 }
};
const FUSE = 2.5, FLAME = 0.5, ROUND_TIME = Number(process.env.PAVIO_ROUND_TIME) || 120;   // PAVIO_ROUND_TIME só para testes
const SPIRAL = (() => {
  const o = []; let x0 = 1, y0 = 1, x1 = COLS - 2, y1 = ROWS - 2;
  while (x0 <= x1 && y0 <= y1) {
    for (let x = x0; x <= x1; x++) o.push([x, y0]);
    for (let y = y0 + 1; y <= y1; y++) o.push([x1, y]);
    if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) o.push([x, y1]);
    if (x1 > x0) for (let y = y1 - 1; y > y0; y--) o.push([x0, y]);
    x0++; y0++; x1--; y1--;
  }
  return o;
})();

/**
 * humans: [{ sid, name }] na ordem das vagas; bots: quantos completar.
 * Retorna { update(dt), snapshot(), setInput(sid, input), dropHuman(sid), state, winner }.
 */
// sorteio com semente: com a mesma semente e os mesmos comandos, a partida se repete igual (é assim que o replay funciona)
function makeRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function createGame({ humans, bots, diff, target, stage, seed, pets, stages, petBoxes, rules }) {
  // regras: 2 = bomba começa com fogo de 1 casa e a explosão destrói a caixa do pet. Replays antigos (sem isso) usam as regras 1.
  const RULES = rules || RULES_NOW, RANGE0 = RULES >= 2 ? 1 : 2;
  const nBoxes = Number.isInteger(petBoxes) ? Math.max(0, Math.min(4, petBoxes)) : 1;   // quantas caixas-surpresa de pet por rodada (quem cria a sala escolhe)
  const stageList = STAGES.slice(0, stages || STAGES.length);   // o Sorteio do replay usa as fases que existiam quando ele foi gravado
  // replays gravados antes do leão e do dragão sorteiam só entre os 3 pets antigos
  const petList = PETS.slice(0, pets || PETS.length);
  seed = Number.isInteger(seed) ? seed : (Math.random() * 2 ** 31) | 0;
  const rnd = makeRng(seed);
  let ticks = 0;   // quantos passos a partida já rodou (o replay usa para encaixar os comandos)
  // petTaken: o único pet da partida já foi pego (não aparece mais caixa-surpresa)
  const G = { diff: DIFF[diff] ? diff : 'normal', target, time: 0, players: [], ev: [], petTaken: false };
  // id = vaga (onde nasce); char = personagem escolhido (visual). Bots ficam com os personagens que sobraram.
  const used = new Set();
  humans.forEach((h, i) => {
    let ch = Number.isInteger(h.char) && h.char >= 0 && h.char < NCHARS && !used.has(h.char) ? h.char : [...Array(NCHARS).keys()].find(c => !used.has(c));
    used.add(ch);
    G.players.push({ id: i, char: ch, name: h.name, sid: h.sid, uid: h.uid || null, human: true, supporter: !!h.supporter, gear: Array.isArray(h.gear) ? h.gear.filter(k => ['bota', 'escudo', 'mascara'].includes(k)) : [], wins: 0, input: { dir: null, bomb: false } });
  });
  for (let b = 0; b < bots && G.players.length < 4; b++) {
    const free = [...Array(NCHARS).keys()].filter(c => !used.has(c));   // bot sorteia um personagem entre os que sobraram
    const i = G.players.length, ch = free[(rnd() * free.length) | 0]; used.add(ch);
    G.players.push({ id: i, char: ch, name: BOT_NAMES[ch] + ' (bot)', sid: null, human: false, wins: 0, input: { dir: null, bomb: false } });
  }

  function newRound() {
    G.grid = new Uint8Array(N); G.flame = new Float32Array(N); G.fdir = new Uint8Array(N);
    G.pu = new Array(N).fill(null); G.bombs = []; G.breaking = []; G.drops = []; G.breaths = []; G.chicks = [];
    G.stage = stage === 'sorteio' ? stageList[(rnd() * stageList.length) | 0] : (STAGES.includes(stage) ? stage : 'padrao');
    G.river = new Uint8Array(N);
    if (G.stage === 'agua') for (const x of RIVER_X) for (let y = 1; y < ROWS - 1; y++) G.river[idx(x, y)] = 1;
    G.volc = G.stage === 'fogo' ? VOLCANOES.map(([x, y]) => ({ x, y, t: 10 + rnd() * 6 })) : [];
    G.layout = G.stage === 'trem' ? TRACK_LAYOUTS[(rnd() * TRACK_LAYOUTS.length) | 0] : null;
    G.path = G.layout ? buildPath(G.layout.way) : [];
    G.onTrack = new Uint8Array(N);
    for (let p = 1; p < G.path.length - 1; p++) { const [x, y] = G.path[p]; G.onTrack[idx(x, y)] = 1; }
    G.train = G.layout ? { s: 'idle', t: 9 + rnd() * 5, x: 0, dir: 1, k: 0 } : null;
    G.whale = G.stage === 'mar' ? { s: 'idle', t: 8 + rnd() * 4, x: 0, y: 0 } : null;
    G.tornado = G.stage === 'deserto' ? { s: 'idle', t: 7 + rnd() * 4, x: 0, y: 0, life: 0, step: 0 } : null;
    G.canopy = new Uint8Array(N); G.tunnels = [];
    if (G.stage === 'mata') {   // túneis de folhas em lugares sorteados, sem encostar nos cantos de início
      const nearSpawn = (x, y) => SPAWNS.some(([sx, sy]) => Math.abs(x - sx) + Math.abs(y - sy) <= 2);
      const want = LEAF_TUNNELS[(rnd() * LEAF_TUNNELS.length) | 0];
      for (let tries = 0; tries < 200 && G.tunnels.length < want; tries++) {
        const h = rnd() < .5, len = LEAF_LEN[(rnd() * LEAF_LEN.length) | 0];
        const x0 = 1 + ((rnd() * ((h ? COLS - 2 - len : COLS - 2) )) | 0), y0 = 1 + ((rnd() * ((h ? ROWS - 2 : ROWS - 2 - len))) | 0);
        const cells = []; for (let k = 0; k < len; k++) cells.push(h ? [x0 + k, y0] : [x0, y0 + k]);
        if (cells.some(([x, y]) => x < 1 || y < 1 || x > COLS - 2 || y > ROWS - 2 || nearSpawn(x, y) || G.canopy[idx(x, y)])) continue;
        for (const [x, y] of cells) G.canopy[idx(x, y)] = 1;
        G.tunnels.push({ h, cells });
      }
    }
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const i = idx(x, y);
      if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0 && !G.onTrack[i] && !G.canopy[i])) { G.grid[i] = 1; continue; }   // sem pilares no trilho nem no túnel de folhas
      if (G.canopy[i]) continue;   // o túnel de folhas é um corredor livre
      if (G.river[i]) continue;   // não tem caixote dentro do rio
      const near = SPAWNS.some(([sx, sy]) => Math.abs(x - sx) + Math.abs(y - sy) <= 1);
      if (!near && rnd() < .7) G.grid[i] = 2;
    }
    // gelo rachado em 2 casas sorteadas, longe dos cantos de início (o caixote que estivesse ali sai)
    G.cracks = [];
    if (G.stage === 'gelo') for (let tries = 0; tries < 300 && G.cracks.length < CRACKS; tries++) {
      const x = 1 + ((rnd() * (COLS - 2)) | 0), y = 1 + ((rnd() * (ROWS - 2)) | 0), i = idx(x, y);
      if (G.grid[i] === 1 || SPAWNS.some(([sx, sy]) => Math.abs(x - sx) + Math.abs(y - sy) <= 2) || G.cracks.some(c => Math.abs(c.x - x) + Math.abs(c.y - y) < 3)) continue;
      G.grid[i] = 0; G.cracks.push({ x, y, n: 0, open: false });
    }
    // Um pet por rodada: fica escondido num caixote sorteado (ninguém leva o pet para a rodada seguinte).
    G.petTaken = false;
    const crates = []; for (let i = 0; i < N; i++) if (G.grid[i] === 2) crates.push(i);
    if (nBoxes === 1) G.petCrates = crates.length ? [crates[(rnd() * crates.length) | 0]] : [];   // igual ao de antes (replays antigos)
    else { G.petCrates = []; for (let k = 0; k < nBoxes && crates.length; k++) G.petCrates.push(crates.splice((rnd() * crates.length) | 0, 1)[0]); }
    G.players.forEach((p, i) => {
      const [sx, sy] = SPAWNS[i];
      Object.assign(p, {
        x: sx, y: sy, alive: true, deathT: 0, speed: SPEED0, maxBombs: 1, active: 0, range: RANGE0, kick: false, glove: false,
        mount: null,   // nada passa para a próxima rodada: nem itens, nem pet
        train: false, trainK: 0, whale: false, lastCell: -1,
        petCd: 0, dashT: 0, jump: null, inv: 0, shieldT: 0, stunT: 0,
        face: { x: 0, y: 1 }, moving: false, ai: { next: null, wait: .3 + rnd() * .3, stuck: 0, cd: 0 }
      });
      p.input.bomb = false; p.input.pet = false;
      // Teste: PAVIO_DEBUG_PETS=1 npm start faz todo mundo começar montado (gato, canguru, tanque...)
      if (process.env.PAVIO_DEBUG_PETS) { const dl = process.env.PAVIO_DEBUG_PETS.split(',').filter(t => PETS.includes(t)); p.mount = dl.length ? dl[i % dl.length] : PETS[i % PETS.length]; p.maxBombs = 3; }
    });
    if (process.env.PAVIO_DEBUG_PETS && !G.petTaken) G.pu[idx(2, 1)] = 'pet';   // teste: caixa-surpresa ao lado do P1
    G.timer = ROUND_TIME; G.sd = null; G.state = 'countdown'; G.cd = 3; G.lastCd = 4; G.banner = null;
    G.ev.push(['round']);
  }

  const bombAt = (x, y) => G.bombs.find(b => !b.fly && b.x === x && b.y === y);   // bomba voando não ocupa casa

  // ---------- luvinha ----------
  // casa boa para a bomba pousar: livre e sem ninguém (se tiver alguém, a bomba quica na cabeça)
  const headAt = (x, y) => G.players.find(o => o.alive && !o.train && !o.whale && Math.round(o.x) === x && Math.round(o.y) === y);
  function landOk(x, y) { const i = idx(x, y); return G.grid[i] === 0 && !bombAt(x, y) && !G.pu[i] && !headAt(x, y); }

  // ---------- itens que a pessoa carrega ----------
  function itemsOf(p) {
    const list = [];
    for (let i = 1; i < p.maxBombs; i++) list.push('bomb');
    for (let i = RANGE0; i < p.range; i++) list.push('fire');
    for (let i = 0, n = Math.round((p.speed - SPEED0) / SPEED_STEP); i < n; i++) list.push('speed');
    if (p.kick) list.push('kick');
    if (p.glove) list.push('glove');
    return list;
  }
  function removeItem(p, t) {
    if (t === 'bomb') p.maxBombs--; else if (t === 'fire') p.range--;
    else if (t === 'speed') p.speed = Math.max(SPEED0, p.speed - SPEED_STEP);
    else if (t === 'kick') p.kick = false; else if (t === 'glove') p.glove = false;
  }
  // espalha itens em casas livres aleatórias do campo
  function scatter(types) {
    const free = [];
    for (let i = 0; i < N; i++) {
      const x = i % COLS, y = (i / COLS) | 0;
      if (G.grid[i] === 0 && !G.pu[i] && G.flame[i] <= 0 && !bombAt(x, y) && !headAt(x, y)) free.push(i);
    }
    for (const t of types) {
      if (!free.length) break;
      const i = free.splice((rnd() * free.length) | 0, 1)[0];
      G.pu[i] = t; G.ev.push(['scatter', i % COLS, (i / COLS) | 0]);
    }
  }
  // bomba da luvinha caiu na cabeça: a vítima perde 1 poder, que vai parar num lugar aleatório
  function stripItem(p) {
    const list = itemsOf(p); if (!list.length) return;
    const t = list[(rnd() * list.length) | 0];
    removeItem(p, t); scatter([t]); G.ev.push(['stolen', p.x, p.y, t]);
  }
  function throwBomb(p, b) {
    const dx = p.face.x, dy = p.face.y; if (!dx && !dy) return false;
    const seq = []; let x = b.x, y = b.y;
    for (let k = 0; k < 40; k++) {
      const step = k === 0 ? THROW_DIST : 1;
      for (let s = 0; s < step; s++) {
        x += dx; y += dy;
        if (x < 1) x = COLS - 2; else if (x > COLS - 2) x = 1;      // atravessa a parede de fora
        if (y < 1) y = ROWS - 2; else if (y > ROWS - 2) y = 1;
      }
      seq.push([x, y]);
      if (landOk(x, y)) break;
    }
    if (!seq.length || !landOk(...seq[seq.length - 1])) return false;
    b.fly = { seq, i: 0, t: 0, fx: b.x, fy: b.y, dx, dy, by: p, hit: new Set() }; b.slide = null; b.pass = new Set(); b.drift = 0;
    G.ev.push(['throw']); return true;
  }
  function gloveAction(p) {
    if (!p.glove) return false;
    const cx = Math.round(p.x), cy = Math.round(p.y);
    let b = bombAt(cx, cy);                                                   // em cima da bomba
    if (!b) b = bombAt(cx + p.face.x, cy + p.face.y);                         // ou com a bomba logo à frente
    return b ? throwBomb(p, b) : false;
  }
  function passable(x, y, p) {
    if (!inB(x, y) || G.grid[idx(x, y)] !== 0) return false;
    const b = bombAt(x, y); return !(b && !b.pass.has(p));
  }
  // anda num eixo; devolve true se o jogador saiu do lugar
  function axisMove(p, dx, dy, d) {
    const along = dx ? 'x' : 'y', perp = dx ? 'y' : 'x', dir = dx || dy;
    const cp = Math.round(p[perp]), off = p[perp] - cp, ca = Math.round(p[along]);
    const ax = dx ? ca + dx : cp, ay = dx ? cp : ca + dy;
    const x0 = p.x, y0 = p.y;
    if (Math.abs(off) > .02) {
      if (passable(ax, ay, p)) { const s = Math.min(Math.abs(off), d); p[perp] -= Math.sign(off) * s; if (Math.abs(p[perp] - cp) <= .02) p[perp] = cp; }
      else if (RULES >= 5 && p.human && Math.abs(off) >= .3) {   // esquina tolerante: quase alinhado com o corredor do outro lado, escorrega para ele
        const c2 = cp + Math.sign(off), bx = dx ? ca + dx : c2, by = dx ? c2 : ca + dy;
        if (passable(bx, by, p) && passable(dx ? ca : c2, dx ? c2 : ca, p)) { const s = Math.min(Math.abs(c2 - p[perp]), d); p[perp] += Math.sign(off) * s; if (Math.abs(p[perp] - c2) <= .02) p[perp] = c2; }
      }
      return p.x !== x0 || p.y !== y0;
    }
    p[perp] = cp;
    const nv = p[along] + dir * d;
    if (passable(ax, ay, p)) { p[along] = nv; return true; }
    const b = bombAt(ax, ay);
    if (b && p.kick && !b.slide && Math.abs(p[along] - ca) < .3) { b.slide = { dx, dy, acc: 0 }; G.ev.push(['kick']); }
    p[along] = dir > 0 ? Math.min(nv, Math.max(p[along], ca)) : Math.max(nv, Math.min(p[along], ca));
    return p.x !== x0 || p.y !== y0;
  }
  function placeBomb(p) { return placeBombAt(p, Math.round(p.x), Math.round(p.y)); }
  function placeBombAt(p, x, y) {
    if (p.active >= p.maxBombs || !inB(x, y) || bombAt(x, y) || G.grid[idx(x, y)] !== 0) return false;
    const pass = new Set();
    for (const o of G.players) if (o.alive && Math.abs(o.x - x) < .98 && Math.abs(o.y - y) < .98) pass.add(o);
    G.bombs.push({ x, y, t: FUSE, range: p.range, owner: p, pass, slide: null });
    p.active++; G.ev.push(['place']); return true;
  }
  function setFlame(x, y, d) { const i = idx(x, y); if (G.flame[i] <= 0) G.fdir[i] = 0; G.flame[i] = FLAME; G.fdir[i] |= d; }
  function explode(b) {
    G.bombs.splice(G.bombs.indexOf(b), 1); b.owner.active--;
    setFlame(b.x, b.y, 3); G.ev.push(['boom']);
    for (const [dx, dy] of D4) {
      for (let k = 1; k <= b.range; k++) {
        const x = b.x + dx * k, y = b.y + dy * k, i = idx(x, y), gv = G.grid[i];
        if (gv === 1) break;
        if (gv === 2) { G.grid[i] = 3; G.breaking.push({ i, t: .55 }); setFlame(x, y, dx ? 1 : 2); break; }
        if (gv === 3) break;
        setFlame(x, y, dx ? 1 : 2);
        if (G.pu[i]) { if (G.pu[i] !== 'pet' || RULES >= 2) { if (G.pu[i] === 'pet') G.ev.push(['petburn', x, y]); G.pu[i] = null; } break; }   // a explosão da bomba destrói itens e também a caixa do pet
        const o = bombAt(x, y); if (o) { o.t = 0; break; }
      }
    }
  }
  // Vulcão (fase do fogo): solta fogo em cruz ao redor, como uma bomba que não tem dono
  function erupt(v) {
    G.ev.push(['erupt']);
    for (const [dx, dy] of D4) {
      for (let k = 1; k <= VOLC_RANGE; k++) {
        const x = v.x + dx * k, y = v.y + dy * k, i = idx(x, y), gv = G.grid[i];
        if (gv === 1) break;
        if (gv === 2) { G.grid[i] = 3; G.breaking.push({ i, t: .55 }); setFlame(x, y, dx ? 1 : 2); break; }
        if (gv === 3) break;
        setFlame(x, y, dx ? 1 : 2);
        if (G.pu[i]) { if (G.pu[i] !== 'pet') G.pu[i] = null; break; }
        const o = bombAt(x, y); if (o) { o.t = 0; break; }
      }
    }
  }
  // morreu: perde todos os itens, que se espalham pelo campo (o pet volta a ser caixa-surpresa)
  function kill(p) {
    if (!p.alive) return;
    p.alive = false; p.deathT = 0; p.train = false;
    const drop = itemsOf(p); if (p.mount) drop.push('pet');
    p.maxBombs = 1; p.range = RANGE0; p.speed = SPEED0; p.kick = false; p.glove = false; p.mount = null; p.shieldT = 0;
    G.ev.push(['die', p.id]);
    if (drop.length) scatter(drop);
  }
  function dropWall(c) {
    if (G.grid[c] === 1) return;
    G.grid[c] = 1; G.pu[c] = null; G.flame[c] = 0;
    const x = c % COLS, y = (c / COLS) | 0, b = bombAt(x, y);
    if (b) { G.bombs.splice(G.bombs.indexOf(b), 1); b.owner.active--; }
    G.breaking = G.breaking.filter(k => k.i !== c);
    for (const p of G.players) if (p.alive && !p.train && !p.whale && Math.round(p.x) === x && Math.round(p.y) === y) kill(p);
    G.drops.push({ c, t: .35 }); G.ev.push(['thud']);
  }
  function pickup(p) {
    const c = idx(Math.round(p.x), Math.round(p.y)); let t = G.pu[c]; if (!t) return;
    G.pu[c] = null;
    if (t === 'pet') { t = petList[(rnd() * petList.length) | 0]; G.petTaken = true; }   // caixa-surpresa: sorteia o pet
    if (t === 'bomb') p.maxBombs = Math.min(8, p.maxBombs + 1);
    else if (t === 'fire') p.range = Math.min(8, p.range + 1);
    else if (t === 'speed') p.speed = Math.min(SPEED_MAX, p.speed + SPEED_STEP);
    else if (t === 'kick') p.kick = true;
    else if (t === 'glove') p.glove = true;
    else { p.mount = t; p.petCd = 0; p.dashT = 0; }   // monta no pet (troca se já tiver um)
    G.ev.push(['pick', p.x, p.y, t, PU_TEXT[t]]);
  }

  // Habilidade do pet (tecla E / Shift)
  function usePet(p) {
    if (!p.mount || p.petCd > 0 || p.jump) return;
    const fx = p.face.x, fy = p.face.y, cx = Math.round(p.x), cy = Math.round(p.y);
    if (p.mount === 'cat') {
      // Gato: arrancada de super velocidade
      p.dashT = DASH_TIME; p.petCd = PET_CD.cat; G.ev.push(['dash']);
    } else if (p.mount === 'roo') {
      // Canguru: pula por cima de 1 bloco ou bomba e cai 2 casas à frente
      const tx = cx + fx * 2, ty = cy + fy * 2;
      if (!inB(tx, ty) || G.grid[idx(tx, ty)] !== 0 || bombAt(tx, ty)) return;
      if (RULES >= 4 && bombAt(cx + fx, cy + fy)) return;   // não pula por cima de bomba (só de bloco)
      p.jump = { x0: p.x, y0: p.y, x1: tx, y1: ty, t: 0 };
      p.petCd = PET_CD.roo; G.ev.push(['jump']);
    } else if (p.mount === 'tank') {
      // Tanque: solta todas as bombas disponíveis em fila na frente
      let x = cx + fx, y = cy + fy, n = 0;
      while (p.active < p.maxBombs && inB(x, y) && G.grid[idx(x, y)] === 0 && !bombAt(x, y) && !G.pu[idx(x, y)]) {
        placeBombAt(p, x, y); n++; x += fx; y += fy;
      }
      if (n) { p.petCd = PET_CD.tank; G.ev.push(['tank']); }
    } else if (p.mount === 'lion') {
      // Leão: levanta o escudo; enquanto ele estiver de pé, o fogo não pega
      p.shieldT = LION_TIME; p.petCd = PET_CD.lion; G.ev.push(['roar']);
    } else if (p.mount === 'dragon') {
      // Dragão: cospe fogo até 3 casas à frente (para em parede e bloco); quem estiver no caminho fica atordoado 2 s
      if (!fx && !fy) return;
      let len = 0;
      for (let k = 1; k <= BREATH_LEN; k++) { const x = cx + fx * k, y = cy + fy * k; if (!inB(x, y) || (G.grid[idx(x, y)] !== 0 && G.grid[idx(x, y)] !== 4) || (RULES >= 4 && bombAt(x, y))) break; len = k; }   // o fogo do dragão para na bomba
      p.petCd = PET_CD.dragon; G.breaths.push({ x: cx, y: cy, dx: fx, dy: fy, len, t: BREATH_SHOW }); G.ev.push(['breath']);
      for (const o of G.players) {
        if (o === p || !o.alive || o.jump || o.train || o.whale) continue;
        const ox = Math.round(o.x), oy = Math.round(o.y), k = fx ? (ox - cx) * fx : (oy - cy) * fy;
        if (k < 1 || k > len || (fx ? oy !== cy : ox !== cx)) continue;
        if (o.shieldT > 0) { G.ev.push(['blocked', o.x, o.y]); continue; }   // o escudo do leão segura o fogo do dragão também
        o.stunT = STUN_TIME; o.moving = false; o.dashT = 0; if (o.ai) o.ai.next = null; G.ev.push(['stun', o.x, o.y]);
      }
    } else if (p.mount === 'toucan') {
      // Tucabum: bota um ovo onde está; ele choca e o filhote sai correndo atrás do inimigo mais perto
      if (G.grid[idx(cx, cy)] !== 0) return;
      if (RULES >= 6 && G.chicks.some(c => Math.round(c.x) === cx && Math.round(c.y) === cy)) return;   // já tem ovo aqui
      G.chicks.push({ x: cx, y: cy, nx: cx, ny: cy, st: 'egg', t: RULES >= 6 ? EGG_MINE_TIME : EGG_HATCH, owner: p, fx: fx || 0, fy: fy || 1, moving: false, target: null });
      p.petCd = PET_CD.toucan; G.ev.push(['egg', cx, cy]);
    }
  }
  // Tucabum: ovo → filhote que persegue o inimigo mais perto e explode ao encostar (ou quando o tempo acaba)
  function chickTarget(c) {
    let best = null, bd = 1e9;
    for (const o of G.players) { if (o === c.owner || !o.alive || o.train || o.whale) continue;
      const d = Math.abs(o.x - c.x) + Math.abs(o.y - c.y); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  function chickStep(sx, sy, tx, ty) {   // próxima casa no caminho mais curto (sem atravessar parede, bloco nem bomba)
    if (sx === tx && sy === ty) return null;
    const prev = new Int16Array(N).fill(-1), start = idx(sx, sy), goal = idx(tx, ty), q = [start]; prev[start] = start;
    for (let h = 0; h < q.length; h++) { const c = q[h]; if (c === goal) break; const x = c % COLS, y = (c / COLS) | 0;
      for (const [dx, dy] of D4) { const nx = x + dx, ny = y + dy, n = idx(nx, ny);
        if (!inB(nx, ny) || prev[n] !== -1 || G.grid[n] !== 0 || (bombAt(nx, ny) && n !== goal)) continue; prev[n] = c; q.push(n); } }
    let end = goal;
    if (prev[goal] === -1) {   // sem caminho até o alvo: vai para a casa alcançável mais perto dele
      let bd = Math.abs(sx - tx) + Math.abs(sy - ty); end = -1;
      for (const c of q) { const d = Math.abs(c % COLS - tx) + Math.abs(((c / COLS) | 0) - ty); if (d < bd) { bd = d; end = c; } }
      if (end < 0) return null;
    }
    let c = end; while (prev[c] !== start) c = prev[c];
    return [c % COLS, (c / COLS) | 0];
  }
  function chickBoom(c) {
    G.chicks.splice(G.chicks.indexOf(c), 1);
    const x = Math.round(c.x), y = Math.round(c.y), b = bombAt(x, y);
    if (b) b.t = 0;   // explode a bomba que estiver ali
    else { c.owner.active++; G.bombs.push({ x, y, t: 0, range: CHICK_RANGE, owner: c.owner, pass: new Set(), slide: null }); }   // o explode() devolve esse +1
    G.ev.push(['chickboom', x, y]);
  }
  function chickUpdate(dt) {
    for (const c of G.chicks.slice()) {
      c.t -= dt;
      const cx = Math.round(c.x), cy = Math.round(c.y);
      if (G.flame[idx(cx, cy)] > 0 || G.grid[idx(cx, cy)] !== 0) { chickBoom(c); continue; }   // fogo ou parede caindo em cima: explode na hora
      if (RULES >= 6) {   // ovo-mina: explode quando outro jogador encosta; some sozinho depois de 3 s
        if (c.t <= 0) { G.chicks.splice(G.chicks.indexOf(c), 1); G.ev.push(['eggfade', cx, cy]); continue; }
        if (G.players.some(o => o !== c.owner && o.alive && !o.train && !o.whale && !o.jump && Math.abs(o.x - cx) < .6 && Math.abs(o.y - cy) < .6)) chickBoom(c);
        continue;
      }
      if (c.st === 'egg') { if (c.t <= 0) { c.st = 'chick'; c.t = CHICK_LIFE; G.ev.push(['hatch', c.x, c.y]); } continue; }
      if (c.t <= 0) { chickBoom(c); continue; }
      if (!c.target || !c.target.alive || c.target.train || c.target.whale) c.target = chickTarget(c);
      const tg = c.target;
      if (tg && Math.abs(tg.x - c.x) < .6 && Math.abs(tg.y - c.y) < .6) { chickBoom(c); continue; }
      if (c.nx === c.x && c.ny === c.y) { const st = tg && chickStep(cx, cy, Math.round(tg.x), Math.round(tg.y)); if (st) { c.nx = st[0]; c.ny = st[1]; } }
      const d = CHICK_SPEED * dt, ddx = c.nx - c.x, ddy = c.ny - c.y;
      if (ddx || ddy) { c.fx = Math.sign(ddx); c.fy = Math.sign(ddy); c.moving = true; } else c.moving = false;
      if (Math.abs(ddx) + Math.abs(ddy) <= d) { c.x = c.nx; c.y = c.ny; }
      else { c.x += Math.sign(ddx) * Math.min(Math.abs(ddx), d); c.y += Math.sign(ddy) * Math.min(Math.abs(ddy), d); }
    }
  }
  // Pegou fogo: se estiver montado, perde o pet e fica piscando um pouco; se não, morre.
  // ---------- trem ----------
  // embarcar: na casa colada no trilho, com um vagão passando do lado (vale também nas curvas)
  function tryBoard(p) {
    const tr = G.train; if (!tr || tr.s !== 'run' || p.train) return false;
    const P = G.path, max = P.length - 2;
    if (G.onTrack[idx(Math.round(p.x), Math.round(p.y))]) return false;   // em cima do trilho não dá: precisa estar do lado
    for (let k = 1; k < TRAIN_LEN; k++) {   // só nos vagões, não na locomotiva
      const f = tr.x - tr.dir * k; if (f < 1 || f > max) continue;
      const [wx, wy] = pathPos(P, f);
      if (Math.abs(wx - p.x) + Math.abs(wy - p.y) < 1.35) {
        p.train = true; p.trainK = k; p.moving = false; if (p.ai) p.ai.next = null;
        G.ev.push(['board', p.id]); return true;
      }
    }
    return false;
  }
  function trainUpdate(dt) {
    const tr = G.train, P = G.path, L = P.length, max = L - 2;
    if (tr.s !== 'run') {
      tr.t -= dt;
      if (tr.s === 'idle' && tr.t <= TRAIN_WARN) { tr.s = 'warn'; G.ev.push(['trainwarn']); }
      if (tr.t <= 0) { tr.s = 'run'; tr.dir = rnd() < .5 ? 1 : -1; tr.x = tr.dir > 0 ? -1 : L; G.ev.push(['trainrun']); }
      return;
    }
    tr.x += tr.dir * TRAIN_SPEED * dt;
    // o trem passa por cima de tudo: quebra caixotes, detona bombas, some com itens e atropela quem estiver no trilho
    for (let k = 0; k < TRAIN_LEN; k++) {
      const f = tr.x - tr.dir * k, c = Math.round(f);
      if (c < 1 || c > max) continue;
      const [cx, cy] = P[c], i = idx(cx, cy), [fx, fy] = pathPos(P, f);
      if (G.grid[i] === 2) { G.grid[i] = 3; G.breaking.push({ i, t: .3 }); G.ev.push(['trainsmash']); }
      const b = bombAt(cx, cy); if (b && b.t > 0) b.t = 0;
      if (G.pu[i] && G.pu[i] !== 'pet') G.pu[i] = null;
      for (const p of G.players) if (p.alive && !p.train && !p.jump && G.onTrack[idx(Math.round(p.x), Math.round(p.y))] &&
        Math.abs(p.x - fx) + Math.abs(p.y - fy) < .8) hit(p);
    }
    // passageiros vão junto e descem no fim da linha (do outro lado do caminho)
    const end = tr.dir > 0 ? max : 1;
    for (const p of G.players) if (p.train) {
      const w = tr.x - tr.dir * p.trainK, arrived = tr.dir > 0 ? w >= end : w <= end;
      const [px, py] = arrived ? P[end] : pathPos(P, w);
      p.x = px; p.y = py;
      if (arrived) { const [bx, by] = P[end - tr.dir]; p.face = { x: Math.sign(px - bx), y: Math.sign(py - by) };
        p.train = false; p.inv = Math.max(p.inv, 1.2); G.ev.push(['trainoff', p.id]); }
    }
    const tail = tr.x - tr.dir * (TRAIN_LEN - 1);
    if (tr.dir > 0 ? tail > L + 1 : tail < -2) { tr.s = 'idle'; tr.t = 11 + rnd() * 6; }
  }
  // ---------- baleia (fundo do mar) ----------
  function whaleUpdate(dt) {
    const w = G.whale;
    if (w.s === 'idle') {
      w.t -= dt; if (w.t > 0) return;
      // surge perto de alguém (na casa dele), senão numa casa livre qualquer
      const alive = G.players.filter(p => p.alive && !p.train && !p.whale);
      const tgt = alive.length && rnd() < .75 ? alive[(rnd() * alive.length) | 0] : null;
      let cell = tgt ? [Math.round(tgt.x), Math.round(tgt.y)] : null;
      if (!cell || G.grid[idx(cell[0], cell[1])] !== 0) { const c = freeCells(); if (!c.length) { w.t = 2; return; } cell = c[(rnd() * c.length) | 0]; }
      [w.x, w.y] = cell; w.s = 'warn'; w.t = WHALE_WARN; G.ev.push(['whalewarn']); return;
    }
    if (w.s === 'warn') {
      w.t -= dt; if (w.t > 0) return;
      w.s = 'up'; w.t = WHALE_HOLD; w.moved = false; let n = 0;
      for (const p of G.players) if (p.alive && !p.train && !p.whale && !p.jump && Math.round(p.x) === w.x && Math.round(p.y) === w.y) {
        p.whale = true; p.x = w.x; p.y = w.y; p.moving = false; p.dashT = 0; if (p.ai) p.ai.next = null; n++; }
      G.ev.push(['gulp', n]);
      w.empty = !n; if (!n) { w.t = WHALE_EMERGE; w.moved = true; }   // não pegou ninguém: só volta para baixo
      return;
    }
    w.t -= dt;
    if (!w.moved && w.t <= WHALE_EMERGE) {   // nada por baixo da arena e surge numa casa livre sorteada
      w.moved = true; const c = freeCells();
      if (c.length) [w.x, w.y] = c[(rnd() * c.length) | 0];
      for (const p of G.players) if (p.whale) { p.x = w.x; p.y = w.y; }
      G.ev.push(['whaleup']);
    }
    if (w.t <= 0) {   // cospe quem engoliu e mergulha
      for (const p of G.players) if (p.whale) { p.whale = false; p.x = w.x; p.y = w.y; p.inv = Math.max(p.inv, 1); G.ev.push(['spit', w.x, w.y]); }
      w.s = 'idle'; w.t = 9 + rnd() * 4;
    }
  }
  // ---------- tornado (deserto) ----------
  function freeCells(minFrom) {   // casas livres, opcionalmente longe de um ponto
    const out = [];
    for (let i = 0; i < N; i++) { const x = i % COLS, y = (i / COLS) | 0;
      if (G.grid[i] === 0 && !G.pu[i] && G.flame[i] <= 0 && !bombAt(x, y) && !headAt(x, y) && (!minFrom || Math.abs(x - minFrom[0]) + Math.abs(y - minFrom[1]) >= 4)) out.push([x, y]); }
    return out;
  }
  function tornadoUpdate(dt) {
    const tw = G.tornado;
    if (tw.s === 'idle') { tw.t -= dt; if (tw.t <= 0) { const c = freeCells(); if (!c.length) { tw.t = 2; return; }
      [tw.x, tw.y] = c[(rnd() * c.length) | 0]; tw.s = 'warn'; tw.t = TORNADO_WARN; G.ev.push(['tornadowarn']); } return; }
    if (tw.s === 'warn') { tw.t -= dt; if (tw.t <= 0) { tw.s = 'run'; tw.t = TORNADO_LIFE; tw.step = TORNADO_STEP; G.ev.push(['tornadoland']); } return; }
    tw.t -= dt; tw.step -= dt;
    if (tw.step <= 0) {   // anda 1 casa para um lado sorteado (só por chão livre)
      tw.step = TORNADO_STEP;
      const opts = D4.map(([dx, dy]) => [tw.x + dx, tw.y + dy]).filter(([x, y]) => inB(x, y) && G.grid[idx(x, y)] === 0);
      if (opts.length) [tw.x, tw.y] = opts[(rnd() * opts.length) | 0];
    }
    const i = idx(tw.x, tw.y);
    for (const p of G.players) if (p.alive && !p.train && !p.whale && !p.jump && p.inv <= 0 && Math.round(p.x) === tw.x && Math.round(p.y) === tw.y) {
      const c = freeCells([tw.x, tw.y]); if (!c.length) continue;   // arremessa para longe
      const [nx, ny] = c[(rnd() * c.length) | 0]; G.ev.push(['tornadohit', p.x, p.y, nx, ny]);
      p.x = nx; p.y = ny; p.inv = 1.2; if (p.ai) p.ai.next = null;
    }
    const b = bombAt(tw.x, tw.y);
    if (b) { const c = freeCells([tw.x, tw.y]); if (c.length) { [b.x, b.y] = c[(rnd() * c.length) | 0]; b.slide = null; b.pass = new Set(); } }   // leva a bomba embora
    if (G.pu[i] && G.pu[i] !== 'pet') { const t = G.pu[i]; G.pu[i] = null; scatter([t]); }   // itens voam para outro lugar
    if (tw.t <= 0) { tw.s = 'idle'; tw.t = 8 + rnd() * 5; }
  }
  function hit(p, fire) {
    if (!p.alive || p.jump || p.inv > 0 || p.train || p.whale) return;
    if (fire && p.shieldT > 0) return;   // escudo do leão de pé   // dentro do trem ou da baleia = imune
    if (p.mount) { p.mount = null; p.dashT = 0; p.shieldT = 0; p.inv = UNMOUNT_SHIELD; G.ev.push(['unmount', p.x, p.y]); }
    else kill(p);
  }

  // ---------- bots ----------
  function blastCells(x, y, r, cb) {
    cb(x, y);
    for (const [dx, dy] of D4) for (let k = 1; k <= r; k++) {
      const cx = x + dx * k, cy = y + dy * k, i = idx(cx, cy), gv = G.grid[i];
      if (gv === 1) break; cb(cx, cy); if (gv === 2 || gv === 3 || G.pu[i] || bombAt(cx, cy)) break;
    }
  }
  function dangerMap(extra) {
    const D = new Float32Array(N).fill(99);
    const list = G.bombs.map(b => ({ x: b.x, y: b.y, r: b.range, t: b.t })); if (extra) list.push(extra);
    for (const v of G.volc) if (v.t < 3) list.push({ x: v.x, y: v.y, r: VOLC_RANGE, t: v.t });   // bots fogem do vulcão
    if (RULES < 6) for (const c of G.chicks) list.push({ x: Math.round(c.x), y: Math.round(c.y), r: CHICK_RANGE, t: c.st === 'egg' ? c.t + .3 : Math.min(c.t, .5) });   // e do filhote do Tucabum
    const trainDanger = G.train && G.train.s !== 'idle';   // bots saem do trilho quando o sino toca
    for (let pass = 0; pass < 3; pass++) for (const a of list) blastCells(a.x, a.y, a.r, (cx, cy) => { for (const o of list) if (o !== a && o.x === cx && o.y === cy && o.t > a.t) o.t = a.t; });
    for (const a of list) blastCells(a.x, a.y, a.r, (cx, cy) => { const i = idx(cx, cy); if (a.t < D[i]) D[i] = a.t; });
    for (let i = 0; i < N; i++) if (G.flame[i] > 0 || G.grid[i] === 3) D[i] = Math.min(D[i], 0);
    if (G.whale && G.whale.s === 'warn') { const i = idx(G.whale.x, G.whale.y); D[i] = Math.min(D[i], G.whale.t); }   // bots fogem da baleia
    if (RULES >= 6) for (const c of G.chicks) { const i = idx(Math.round(c.x), Math.round(c.y)); D[i] = Math.min(D[i], .3); }   // bots não pisam no ovo-mina
    if (G.tornado && G.tornado.s !== 'idle') for (const [dx, dy] of [[0, 0], ...D4]) { const x = G.tornado.x + dx, y = G.tornado.y + dy; if (inB(x, y)) D[idx(x, y)] = Math.min(D[idx(x, y)], 1); }   // bots desviam do tornado
    if (trainDanger) for (let p = 1; p < G.path.length - 1; p++) { const [x, y] = G.path[p], i = idx(x, y); D[i] = Math.min(D[i], G.train.s === 'run' ? 0 : Math.max(0, G.train.t)); }
    return D;
  }
  function bfs(sx, sy, D, mode, goal, spd, maxD) {
    maxD = maxD || 40;
    const dist = new Int16Array(N).fill(-1), prev = new Int16Array(N).fill(-1), s0 = idx(sx, sy), q = [s0]; dist[s0] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], cx = c % COLS, cy = (c / COLS) | 0;
      if (goal(cx, cy, c, dist[c])) { let s = c; while (prev[s] !== -1 && prev[s] !== s0) s = prev[s]; return { first: c === s0 ? null : s, target: c, dist: dist[c] }; }
      if (dist[c] >= maxD) continue;
      for (const [dx, dy] of D4) {
        const nx = cx + dx, ny = cy + dy, n = idx(nx, ny);
        if (dist[n] !== -1 || G.grid[n] !== 0 || bombAt(nx, ny)) continue;
        if (mode === 'safe' && D[n] < 99) continue;
        if (mode === 'escape' && D[n] < (dist[c] + 1) / spd + .25) continue;
        dist[n] = dist[c] + 1; prev[n] = c; q.push(n);
      }
    }
    return null;
  }
  function enemyInBlast(p, x, y) {
    let hit = false;
    blastCells(x, y, p.range, (cx, cy) => { for (const o of G.players) if (o !== p && o.alive && Math.round(o.x) === cx && Math.round(o.y) === cy) hit = true; });
    return hit;
  }
  const setNext = (p, c) => { p.ai.next = { x: c % COLS, y: (c / COLS) | 0 }; };
  function think(p) {
    const a = p.ai, P = DIFF[G.diff], cx = Math.round(p.x), cy = Math.round(p.y), spd = p.speed, D = dangerMap(), here = idx(cx, cy);
    if (D[here] < 99) { const r = bfs(cx, cy, D, 'escape', (x, y, c) => D[c] === 99, spd); if (r && r.first != null) setNext(p, r.first); return; }
    if (p.active < p.maxBombs && a.cd <= 0) {
      const nearBlock = D4.some(([dx, dy]) => G.grid[idx(cx + dx, cy + dy)] === 2);
      const hits = enemyInBlast(p, cx, cy);
      if ((hits && rnd() < P.aggr) || (nearBlock && rnd() < .85)) {
        const D2 = dangerMap({ x: cx, y: cy, r: p.range, t: FUSE });
        const r = bfs(cx, cy, D2, 'escape', (x, y, c) => D2[c] === 99, spd, 10);
        if (r && r.first != null && r.dist / spd < FUSE - .5) { placeBomb(p); a.cd = P.cd; setNext(p, r.first); return; }
      }
    }
    let r = bfs(cx, cy, D, 'safe', (x, y, c) => !!G.pu[c], spd, 7);
    if (!r && rnd() < P.hunt) {
      const atk = new Uint8Array(N);
      for (const o of G.players) if (o !== p && o.alive) blastCells(Math.round(o.x), Math.round(o.y), Math.max(1, p.range - 1), (x, y) => { atk[idx(x, y)] = 1; });
      r = bfs(cx, cy, D, 'safe', (x, y, c, d) => d > 0 && atk[c] === 1, spd, 16);
    }
    if (!r) r = bfs(cx, cy, D, 'safe', (x, y, c, d) => d > 0 && D4.some(([dx, dy]) => G.grid[idx(x + dx, y + dy)] === 2), spd, 20);
    if (r && r.first != null) { setNext(p, r.first); return; }
    const opts = D4.map(([dx, dy]) => [cx + dx, cy + dy]).filter(([x, y]) => passable(x, y, p) && D[idx(x, y)] === 99);
    if (opts.length && rnd() < .5) { const [x, y] = opts[(rnd() * opts.length) | 0]; setNext(p, idx(x, y)); }
  }
  function botPet(p) {
    if (!p.mount || p.petCd > 0 || p.jump) return;
    if (RULES >= 3) return botPetSmart(p);
    const cx = Math.round(p.x), cy = Math.round(p.y);
    if (p.mount === 'lion') {
      let danger = G.flame[idx(cx, cy)] > 0;
      for (const b of G.bombs) if (!danger && b.t < .5) blastCells(b.x, b.y, b.range, (x, y) => { if (x === cx && y === cy) danger = true; });
      if (danger) usePet(p);
    } else if (p.mount === 'dragon' && rnd() < .05) {
      for (const [dx, dy] of D4) for (let k = 1; k <= BREATH_LEN; k++) {
        const x = cx + dx * k, y = cy + dy * k; if (!inB(x, y) || (G.grid[idx(x, y)] !== 0 && G.grid[idx(x, y)] !== 4)) break;
        if (G.players.some(o => o !== p && o.alive && o.stunT <= 0 && Math.round(o.x) === x && Math.round(o.y) === y)) { p.face = { x: dx, y: dy }; usePet(p); return; }
      }
    }
  }
  // inimigo em linha reta, sem parede/bloco no meio, até 'max' casas: devolve a direção
  function enemyInLine(p, max, needAwake) {
    const cx = Math.round(p.x), cy = Math.round(p.y);
    for (const [dx, dy] of D4) for (let k = 1; k <= max; k++) {
      const x = cx + dx * k, y = cy + dy * k; if (!inB(x, y) || (G.grid[idx(x, y)] !== 0 && G.grid[idx(x, y)] !== 4) || (RULES >= 4 && bombAt(x, y))) break;
      if (G.players.some(o => o !== p && o.alive && !o.train && !o.whale && (!needAwake || o.stunT <= 0) && Math.round(o.x) === x && Math.round(o.y) === y)) return { x: dx, y: dy, k };
    }
    return null;
  }
  // bots usando de verdade cada pet
  function botPetSmart(p) {
    const cx = Math.round(p.x), cy = Math.round(p.y), here = idx(cx, cy), m = p.mount;
    const D = dangerMap(), danger = D[here] < 1.3;
    const useFacing = (dx, dy) => { p.face = { x: dx, y: dy }; usePet(p); if (p.ai) p.ai.next = null; };
    if (m === 'lion') {   // escudo quando o fogo vai pegar e não dá tempo de fugir, ou quando um dragão está mirando
      if (D[here] < .55 || (danger && rnd() < .04)) usePet(p);
      else if (G.players.some(o => o !== p && o.alive && Math.abs(Math.round(o.x) - cx) + Math.abs(Math.round(o.y) - cy) <= 3) && rnd() < (G.bombs.length ? .03 : .008)) usePet(p);   // inimigo chegando perto (mais ainda se tiver bomba no campo)
    } else if (m === 'dragon') {   // cospe fogo em quem estiver na mira (e depois o bot já pensa em bomba)
      const e = enemyInLine(p, BREATH_LEN, true); if (e && rnd() < .35) useFacing(e.x, e.y);
    } else if (m === 'toucan') {   // bota o ovo quando tem inimigo por perto e ele não está em perigo
      if (!danger && G.players.some(o => o !== p && o.alive && !o.train && !o.whale && Math.abs(Math.round(o.x) - cx) + Math.abs(Math.round(o.y) - cy) <= 6) && rnd() < .04) usePet(p);
    } else if (m === 'cat') {   // arrancada para fugir da explosão, ou para ir atrás de alguém
      if (p.moving && (danger || rnd() < .006)) usePet(p);
    } else if (m === 'roo') {   // pula por cima de bloco/bomba para fugir, ou quando ficou travado
      const stuck = p.ai && p.ai.stuck > .15;
      if (danger || stuck || rnd() < .006) {
        let best = null;
        for (const [dx, dy] of D4) {
          const mx = cx + dx, my = cy + dy, tx = cx + dx * 2, ty = cy + dy * 2;
          if (!inB(tx, ty) || G.grid[idx(tx, ty)] !== 0 || bombAt(tx, ty)) continue;
          if (RULES >= 4 && bombAt(mx, my)) continue;   // não pula bomba
          const over = G.grid[idx(mx, my)] !== 0 || !!bombAt(mx, my), safe = D[idx(tx, ty)];
          const score = safe + (over ? 2 : 0);
          if ((danger ? safe > 1.5 : over) && (!best || score > best.s)) best = { dx, dy, s: score };
        }
        if (best) useFacing(best.dx, best.dy);
      }
    } else if (m === 'tank') {   // solta a fila de bombas em quem estiver na frente, se tiver para onde fugir
      const free = p.maxBombs - p.active;
      if (free >= 1 && !danger) { const e = enemyInLine(p, free + 1, false);
        if (e && rnd() < .15) { const back = D4.some(([dx, dy]) => (dx !== e.x || dy !== e.y) && inB(cx + dx, cy + dy) && G.grid[idx(cx + dx, cy + dy)] === 0 && !bombAt(cx + dx, cy + dy));
          if (back) useFacing(e.x, e.y); } }
    }
  }
  function botUpdate(p, dt) {
    const a = p.ai, P = DIFF[G.diff]; a.cd -= dt;
    botPet(p);
    if (a.wait > 0) { a.wait -= dt; p.moving = false; return; }
    if (!a.next) { think(p); if (!a.next) { a.wait = .12 + rnd() * .2; p.moving = false; return; } }
    const n = a.next, ox = p.x, oy = p.y, d = p.speed * (RULES >= 3 && p.dashT > 0 ? DASH_MULT : 1) * dt,   // a arrancada do gato vale para o bot também
       ddx = n.x - p.x, ddy = n.y - p.y;
    if (Math.abs(ddx) > .001) { const s = Math.sign(ddx); p.face = { x: s, y: 0 }; axisMove(p, s, 0, Math.min(d, Math.abs(ddx))); }
    else if (Math.abs(ddy) > .001) { const s = Math.sign(ddy); p.face = { x: 0, y: s }; axisMove(p, 0, s, Math.min(d, Math.abs(ddy))); }
    p.moving = true;
    if (Math.abs(n.x - p.x) < .002 && Math.abs(n.y - p.y) < .002) { p.x = n.x; p.y = n.y; a.next = null; a.stuck = 0; a.wait = rnd() * P.react; }
    else if (Math.abs(p.x - ox) + Math.abs(p.y - oy) < 1e-4) { a.stuck += dt; if (a.stuck > .35) { a.next = null; a.stuck = 0; } }
  }

  // ---------- loop ----------
  function simulate(dt) {
    if (G.sd) {
      G.sd.acc += dt;
      while (G.sd.acc >= .2 && G.sd.i < SPIRAL.length) {
        G.sd.acc -= .2; let c;
        do { const [x, y] = SPIRAL[G.sd.i++]; c = idx(x, y); } while (G.grid[c] === 1 && G.sd.i < SPIRAL.length);
        dropWall(c);
      }
    }
    for (const p of G.players) {
      if (!p.alive) { p.deathT += dt; continue; }
      if (p.inv > 0) p.inv -= dt;
      if (p.petCd > 0) p.petCd -= dt;
      if (p.dashT > 0) p.dashT -= dt;
      if (p.shieldT > 0) p.shieldT -= dt;
      if (p.jump) {
        const j = p.jump; j.t += dt; const k = Math.min(1, j.t / JUMP_TIME);
        p.x = j.x0 + (j.x1 - j.x0) * k; p.y = j.y0 + (j.y1 - j.y0) * k; p.moving = true;
        if (k >= 1) { p.jump = null; p.x = j.x1; p.y = j.y1; pickup(p); }
        continue;
      }
      if (p.train || p.whale) { p.input.bomb = false; p.input.pet = false; p.moving = false; continue; }   // dentro do trem ou da baleia: não dá para agir
      if (p.stunT > 0) { p.stunT -= dt; p.input.bomb = false; p.input.pet = false; p.moving = false; continue; }   // atordoado pelo fogo do dragão: não anda nem age
      if (p.human) {
        const d = DIRS[p.input.dir];
        const spd = p.speed * (p.dashT > 0 ? DASH_MULT : 1);
        const alt = RULES >= 5 ? DIRS[p.input.alt] : null;   // diagonal: se a direção principal está bloqueada, anda pela outra
        if (d) { if (axisMove(p, d.x, d.y, spd * dt) || !alt) p.face = d; else if (axisMove(p, alt.x, alt.y, spd * dt)) p.face = alt; else p.face = d; p.moving = true; } else p.moving = false;
        if (p.input.bomb) { p.input.bomb = false; if (!gloveAction(p)) placeBomb(p); }   // com luvinha: arremessa a bomba se tiver uma em cima/à frente
        if (p.input.pet) { p.input.pet = false; if (!tryBoard(p)) usePet(p); }   // E: embarca no trem se estiver passando do lado; senão, usa o pet
      } else botUpdate(p, dt);
      // correnteza do rio: empurra para baixo quem está parado ou andando no sentido do rio
      if (G.river[idx(Math.round(p.x), Math.round(p.y))] && Math.abs(p.x - Math.round(p.x)) <= .02) {
        const horiz = p.human ? (p.input.dir === 'l' || p.input.dir === 'r') : (p.ai.next && p.ai.next.x !== Math.round(p.x));
        if (!horiz) axisMove(p, 0, 1, DRIFT * dt);
      }
      pickup(p);
      const c = idx(Math.round(p.x), Math.round(p.y));
      if (c !== p.lastCell) { p.lastCell = c; const ck = G.cracks.find(k => !k.open && idx(k.x, k.y) === c); if (ck && ck.n < CRACK_PASSES) { ck.n++; G.ev.push(['crack', ck.n]); } }
    }
    // gelo que já levou 3 passadas abre assim que ficar vazio (sem ninguém nem bomba em cima)
    for (const k of G.cracks) if (!k.open && k.n >= CRACK_PASSES && !bombAt(k.x, k.y) &&
      !G.players.some(p => p.alive && Math.round(p.x) === k.x && Math.round(p.y) === k.y)) {
      const i = idx(k.x, k.y); k.open = true; G.grid[i] = 4; G.pu[i] = null; G.ev.push(['icebreak']);   // 4 = buraco no gelo: o fogo passa por cima, gente e bomba não
    }
    for (const v of G.volc) { v.t -= dt; if (v.t <= 0) { erupt(v); v.t = 9 + rnd() * 5; } }
    if (G.train) trainUpdate(dt);
    if (G.tornado) tornadoUpdate(dt);
    if (G.whale) whaleUpdate(dt);
    const bombFree = (nx, ny) => { const i = idx(nx, ny);
      return inB(nx, ny) && G.grid[i] === 0 && !bombAt(nx, ny) && !G.pu[i] && !G.players.some(p => p.alive && Math.round(p.x) === nx && Math.round(p.y) === ny); };
    for (const b of G.bombs) {
      b.t -= dt;
      if (b.fly) {   // bomba arremessada: arco até a 1ª casa, depois quiques curtos
        const f = b.fly, dur = f.i === 0 ? THROW_TIME : BOUNCE_TIME;
        f.t += dt;
        const [tx, ty] = f.seq[f.i], k = Math.min(1, f.t / dur);
        const jumpWrap = Math.abs(tx - f.fx) > THROW_DIST || Math.abs(ty - f.fy) > THROW_DIST;   // atravessou a parede: some e aparece do outro lado
        if (jumpWrap) {
          // desenha saindo pela borda e entrando pelo outro lado
          const ux = f.fx + f.dx * (f.i === 0 ? THROW_DIST : 1) * k, uy = f.fy + f.dy * (f.i === 0 ? THROW_DIST : 1) * k;
          b.vx = ((ux - 1) % (COLS - 2) + (COLS - 2)) % (COLS - 2) + 1; b.vy = ((uy - 1) % (ROWS - 2) + (ROWS - 2)) % (ROWS - 2) + 1;
        } else { b.vx = f.fx + (tx - f.fx) * k; b.vy = f.fy + (ty - f.fy) * k; }
        b.vz = Math.sin(Math.PI * k) * (f.i === 0 ? 1 : .35);
        if (f.t >= dur) {
          f.fx = tx; f.fy = ty; f.i++; f.t = 0;
          const v = headAt(tx, ty);   // caiu na cabeça de alguém: tira 1 poder (uma vez por arremesso) e a bomba quica
          if (v && v !== f.by && !f.hit.has(v)) { f.hit.add(v); stripItem(v); }
          if (f.i >= f.seq.length && !landOk(tx, ty)) {   // a casa foi ocupada durante o voo (ex.: arena fechando): quica mais uma
            let nx = tx + f.dx, ny = ty + f.dy;
            if (nx < 1) nx = COLS - 2; else if (nx > COLS - 2) nx = 1;
            if (ny < 1) ny = ROWS - 2; else if (ny > ROWS - 2) ny = 1;
            f.seq.push([nx, ny]);
          }
          if (f.i >= f.seq.length) {   // pousou
            b.x = tx; b.y = ty; b.fly = null; b.vx = tx; b.vy = ty; b.vz = 0; b.t = Math.max(b.t, .4);
            for (const o of G.players) if (o.alive && Math.abs(o.x - b.x) < .98 && Math.abs(o.y - b.y) < .98) b.pass.add(o);
            G.ev.push(['land']);
          } else G.ev.push(['bounce']);
        }
        continue;
      }
      b.vx = b.x; b.vy = b.y;   // posição para desenhar (desliza suave entre as casas)
      if (b.slide) {
        b.slide.acc += dt;
        while (b.slide && b.slide.acc >= KICK_STEP) {
          b.slide.acc -= KICK_STEP;
          const nx = b.x + b.slide.dx, ny = b.y + b.slide.dy;
          if (bombFree(nx, ny)) { b.x = nx; b.y = ny; } else b.slide = null;
        }
        if (b.slide && bombFree(b.x + b.slide.dx, b.y + b.slide.dy)) {
          const f = b.slide.acc / KICK_STEP; b.vx = b.x + b.slide.dx * f; b.vy = b.y + b.slide.dy * f;
        } else { b.vx = b.x; b.vy = b.y; }
      }
      // bomba no rio desce com a correnteza, deslizando
      if (!b.slide && G.river[idx(b.x, b.y)]) {
        if (bombFree(b.x, b.y + 1)) {
          b.drift = (b.drift || 0) + dt;
          if (b.drift >= BOMB_DRIFT_STEP) { b.drift -= BOMB_DRIFT_STEP; b.y += 1; }
          b.vy = b.y + (bombFree(b.x, b.y + 1) && G.river[idx(b.x, b.y)] ? b.drift / BOMB_DRIFT_STEP : 0);
        } else { b.drift = 0; b.vy = b.y; }
      } else b.drift = 0;
      for (const p of b.pass) if (Math.abs(p.x - b.x) >= .98 || Math.abs(p.y - b.y) >= .98) b.pass.delete(p);
    }
    chickUpdate(dt);
    // bomba que encosta no fogo ainda aceso (resto de outra explosão) explode também
    for (const b of G.bombs) if (!b.fly && b.t > 0 && G.flame[idx(b.x, b.y)] > 0) b.t = 0;
    let boom = true;
    while (boom) { boom = false; for (const b of G.bombs.slice()) if (b.t <= 0 && !b.fly && G.bombs.includes(b)) { explode(b); boom = true; } }
    for (let i = 0; i < N; i++) if (G.flame[i] > 0) { G.flame[i] -= dt; if (G.flame[i] <= 0) { G.flame[i] = 0; G.fdir[i] = 0; } }
    for (const k of G.breaking) {
      k.t -= dt;
      if (k.t <= 0) {
        G.grid[k.i] = 0;
        if (G.petCrates.includes(k.i)) G.pu[k.i] = 'pet';
        else if (rnd() < .38) {
          const r = rnd();
          G.pu[k.i] = r < .3 ? 'bomb' : r < .6 ? 'fire' : r < .78 ? 'speed' : r < .89 ? 'kick' : 'glove';
        }
      }
    }
    G.breaking = G.breaking.filter(k => k.t > 0);
    for (const b of G.breaths) b.t -= dt; G.breaths = G.breaths.filter(b => b.t > 0);
    for (const p of G.players) if (p.alive && G.flame[idx(Math.round(p.x), Math.round(p.y))] > 0) hit(p, true);
    for (const d of G.drops) d.t -= dt; G.drops = G.drops.filter(d => d.t > 0);
  }

  function update(dt) {
    ticks++;
    G.time += dt;
    if (G.state === 'over') return;
    if (G.banner) { G.banner.t -= dt; if (G.banner.t <= 0) G.banner = null; }
    if (G.state === 'countdown') {
      G.cd -= dt; const s = Math.ceil(G.cd);
      if (s !== G.lastCd && s > 0) { G.lastCd = s; G.ev.push(['tick']); }
      if (G.cd <= 0) { G.state = 'play'; G.ev.push(['go']); G.banner = { text: 'JÁ!', t: .7, big: true }; }
    }
    if (G.state === 'play' || G.state === 'ending') simulate(dt);
    else for (const p of G.players) if (!p.alive) p.deathT += dt;
    if (G.state === 'play') {
      if (!G.sd) { G.timer -= dt; if (G.timer <= 0) { G.timer = 0; G.sd = { i: 0, acc: 0 }; G.banner = { text: 'TEMPO! A ARENA VAI FECHAR', t: 2.2 }; } }
      if (G.players.filter(p => p.alive).length <= 1) { G.state = 'ending'; G.endT = 1.3; }
    } else if (G.state === 'ending') {
      G.endT -= dt;
      if (G.endT <= 0) {
        const alive = G.players.filter(p => p.alive); let text = 'EMPATE!', color = null;
        if (alive.length === 1) { alive[0].wins++; text = alive[0].name.toUpperCase() + ' VENCEU A RODADA'; color = alive[0].char; G.ev.push(['win']); }
        G.state = 'result'; G.resT = 2.2; G.banner = { text, color, t: 2.2 };
      }
    } else if (G.state === 'result') {
      G.resT -= dt;
      if (G.resT <= 0) {
        const champ = G.players.find(p => p.wins >= G.target);
        if (champ) { G.state = 'over'; G.winner = champ; } else newRound();
      }
    }
  }

  function snapshot() {
    const pu = [], fl = [];
    for (let i = 0; i < N; i++) { if (G.pu[i]) pu.push([i, G.pu[i]]); if (G.flame[i] > 0) fl.push([i, G.fdir[i], +G.flame[i].toFixed(3)]); }
    const ev = G.ev; G.ev = [];
    return {
      cracks: G.cracks.length ? G.cracks.map(k => [k.x, k.y, k.n, k.open ? 1 : 0]) : null,
      breaths: G.breaths.length ? G.breaths.map(b => [b.x, b.y, b.dx, b.dy, b.len, +b.t.toFixed(2)]) : null,
      chicks: G.chicks.length ? G.chicks.map(c => [+c.x.toFixed(3), +c.y.toFixed(3), c.st === 'egg' ? 0 : 1, +Math.max(0, c.t).toFixed(2), c.fx, c.fy, c.moving ? 1 : 0, c.owner.char]) : null,
      whale: G.whale ? { s: G.whale.s, x: G.whale.x, y: G.whale.y, t: +Math.max(0, G.whale.t).toFixed(2), e: !!G.whale.empty } : null,
      tornado: G.tornado ? { s: G.tornado.s, x: G.tornado.x, y: G.tornado.y, t: +Math.max(0, G.tornado.t).toFixed(2) } : null,
      tunnels: G.tunnels.length ? G.tunnels : null,
      train: G.train ? { s: G.train.s, x: +G.train.x.toFixed(3), dir: G.train.dir, t: +Math.max(0, G.train.t).toFixed(2) } : null,
      path: G.path, layout: G.layout ? G.layout.name : null,
      stage: G.stage, volc: G.volc.map(v => [v.x, v.y, v.t < RUMBLE ? +(1 - v.t / RUMBLE).toFixed(2) : 0]),
      s: G.state, timer: Math.ceil(G.timer), sd: !!G.sd, cd: +G.cd.toFixed(2), banner: G.banner,
      grid: Array.prototype.join.call(G.grid, ''), pu, fl,
      bombs: G.bombs.map(b => [+(b.vx ?? b.x).toFixed(3), +(b.vy ?? b.y).toFixed(3), +Math.max(0, b.t).toFixed(2), +(b.vz || 0).toFixed(2)]),
      brk: G.breaking.map(k => [k.i, +k.t.toFixed(2)]),
      drops: G.drops.map(d => [d.c, +d.t.toFixed(2)]),
      players: G.players.map(p => ({
        id: p.id, char: p.char, name: p.name, supporter: !!p.supporter, gear: p.gear && p.gear.length ? p.gear : undefined, sid: p.sid, human: p.human, wins: p.wins,
        x: +p.x.toFixed(3), y: +p.y.toFixed(3), alive: p.alive, deathT: +p.deathT.toFixed(2),
        fx: p.face.x, fy: p.face.y, moving: p.moving,
        mount: p.mount, dash: p.dashT > 0, inv: p.inv > 0, sh: p.shieldT > 0 ? +p.shieldT.toFixed(2) : 0, st: p.stunT > 0,
        tr: !!p.train, wh: !!p.whale,
        jz: p.jump ? +Math.sin(Math.PI * Math.min(1, p.jump.t / JUMP_TIME)).toFixed(3) : 0,
        pc: p.mount ? +Math.max(0, p.petCd / PET_CD[p.mount]).toFixed(2) : 0
      })),
      target: G.target, ev
    };
  }

  function setInput(sid, input) {
    const p = G.players.find(q => q.sid === sid && q.human); if (!p) return;
    if (input.dir === null || DIRS[input.dir]) p.input.dir = input.dir;
    const a = DIRS[input.alt], d = DIRS[p.input.dir];   // segunda direção (diagonal): só vale se for perpendicular à principal
    p.input.alt = a && d && (a.x !== 0) !== (d.x !== 0) ? input.alt : null;
    if (input.bomb) p.input.bomb = true;
    if (input.pet) p.input.pet = true;
  }
  // Quem sai no meio da partida vira bot, para a partida não travar.
  function dropHuman(sid) {
    const p = G.players.find(q => q.sid === sid); if (!p) return;
    p.human = false; p.sid = null; p.name = p.name + ' (saiu)'; p.input.dir = null;
    if (p.ai) { p.ai.next = null; p.ai.wait = 0; }
  }

  newRound();
  return {
    update, snapshot, setInput, dropHuman,
    get state() { return G.state; },
    get winner() { return G.winner; },
    get seed() { return seed; },
    get ticks() { return ticks; },
    humansLeft() { return G.players.some(p => p.human); },
    humansAlive() { return G.players.some(p => p.human && p.alive); },
    // só bots vivos: roda o resto da rodada de uma vez (mesmos passos de sempre, então o replay fica igual).
    // Para quando a rodada termina; os efeitos do caminho (explosões etc.) são descartados para não chegarem todos juntos.
    skipRound(maxSteps) {
      if (G.state !== 'play' || G.players.some(p => p.human && p.alive)) return 0;
      let n = 0; const lim = maxSteps || 60 * 240;
      while (G.state === 'play' && n < lim) { update(1 / 60); n++; }
      G.ev = []; return n;
    },
    _G: process.env.PAVIO_DEBUG_PETS || process.env.PAVIO_TEST ? G : undefined
  };
}

module.exports = { STAGES, PETS, RULES_NOW, createGame };
