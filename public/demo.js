// A pretend world for the demo: no server, no account. A few close ones live in
// the countryside and answer back. Everything starts over when the page reloads.

const HOUR = 3600000;
const DAY = 24 * HOUR;
const WORDS = ['courage !', 'belle journée', "je t'embrasse", 'tu me manques', "j'ai hâte de te voir", 'douce nuit'];
const KINDS = ['rain', 'clear', 'snow', 'fog', 'overcast', 'storm', 'cloudy'];
const ago = (ms) => Date.now() - ms;

const me = { id: 'moi', name: 'Toi', code: 'DEMO42', map: 'campagne', seenAt: ago(DAY), weather: null };
let kindTurn = 0;

const people = [
  {
    id: 'maman', name: 'Maman', place: 0, weather: { kind: 'rain', temp: 12 },
    fromThem: [ago(40 * 60000), ago(5 * HOUR), ago(2 * DAY)], fromMe: [ago(20 * HOUR), ago(2 * DAY), ago(3 * DAY)], mots: [],
  },
  { id: 'lea', name: 'Léa', place: 1, weather: { kind: 'clear', temp: 19 }, fromThem: [ago(2 * HOUR)], fromMe: [ago(DAY + HOUR)], mots: [] },
  { id: 'papa', name: 'Papa', place: 2, weather: { kind: 'snow', temp: -2 }, fromThem: [], fromMe: [ago(4 * DAY)], mots: [] },
  {
    id: 'mamie', name: 'Mamie', place: 3, weather: null,
    fromThem: [ago(3 * HOUR)], fromMe: [], mots: [{ at: ago(3 * HOUR), word: 'belle journée' }],
  },
];
// A sign is an episode: a mot doux can be sent once per appearance.
const signs = new Map();

function signOf(p) {
  const week = ago(7 * DAY);
  const alive = p.fromThem.filter((t) => t > week).length >= 3 && p.fromMe.filter((t) => t > week).length >= 3;
  if (alive && !signs.has(p.id)) signs.set(p.id, { since: Date.now(), sent: false, theirs: false });
  if (!alive) signs.delete(p.id);
  return signs.get(p.id) || null;
}

function snapshot() {
  return {
    me: { ...me, sharesWeather: Boolean(me.weather) },
    people: people.map((p) => {
      const sign = signOf(p);
      return {
        id: p.id, name: p.name, place: p.place, weather: p.weather,
        pingsFromThem: p.fromThem.filter((t) => t > ago(7 * DAY)),
        pingsFromMe: p.fromMe.filter((t) => t > ago(7 * DAY)),
        mots: p.mots.filter((m) => m.at > ago(DAY)),
        sign: sign ? { since: sign.since, sent: sign.sent } : null,
      };
    }),
    words: WORDS,
  };
}

const changed = () => window.dispatchEvent(new Event('pat-demo'));
const later = (ms, fn) => setTimeout(() => { fn(); changed(); }, ms);
const find = (id) => {
  const p = people.find((x) => x.id === id);
  if (!p) throw new Error('Personne introuvable');
  return p;
};
const lastReply = new Map();

// Close ones think back, a few seconds later (not every time, not too often).
function thinkBack(p, word) {
  if (Date.now() - (lastReply.get(p.id) || 0) < 15000) return;
  lastReply.set(p.id, Date.now());
  later(4000 + Math.random() * 4000, () => {
    const at = Date.now();
    p.fromThem.push(at);
    const sign = signOf(p);
    if (word && sign && !sign.theirs) {
      sign.theirs = true;
      p.mots.push({ at, word });
    }
  });
}

export async function demoApi(path, { method = 'GET', body = {} } = {}) {
  await new Promise((r) => setTimeout(r, 120));
  const route = `${method} ${path.replace(/\?.*$/, '')}`;
  switch (route) {
    case 'GET /api/me':
    case 'PATCH /api/me':
      if (body.map) me.map = body.map;
      return snapshot();
    case 'POST /api/users':
      me.name = String(body.name || 'Toi').trim().slice(0, 24) || 'Toi';
      return { token: 'demo', ...snapshot() };
    case 'POST /api/seen':
    case 'POST /api/push':
      return { ok: true };
    case 'GET /api/config':
      return {};
    case 'POST /api/pings': {
      const p = find(body.to);
      p.fromMe.push(Date.now());
      thinkBack(p);
      return snapshot();
    }
    case 'POST /api/mots': {
      const p = find(body.to);
      const sign = signOf(p);
      if (!sign) throw new Error('Il n’y a pas de signe entre vous pour le moment');
      if (sign.sent) throw new Error('Ton mot doux est déjà parti');
      sign.sent = true;
      p.fromMe.push(Date.now());
      lastReply.delete(p.id);
      thinkBack(p, "je t'embrasse");
      return snapshot();
    }
    case 'POST /api/unlink': {
      const i = people.findIndex((x) => x.id === body.id);
      if (i >= 0) people.splice(i, 1);
      return snapshot();
    }
    case 'POST /api/connect': {
      const taken = new Set(people.map((p) => p.place));
      const place = [0, 1, 2, 3, 4, 5].find((k) => !taken.has(k));
      if (place === undefined) throw new Error('Il n’y a plus de place sur ta carte');
      const n = people.length;
      people.push({ id: `ami-${n}`, name: ['Jo', 'Sam', 'Nina', 'Tom'][n % 4], place, weather: null, fromThem: [], fromMe: [], mots: [] });
      return snapshot();
    }
    case 'PUT /api/weather':
      // In the demo, every time you switch it on, the sky picks a new weather.
      me.weather = { kind: KINDS[kindTurn++ % KINDS.length], temp: 8 + (kindTurn * 5) % 15 };
      return snapshot();
    case 'DELETE /api/weather':
      me.weather = null;
      return snapshot();
    default:
      throw new Error('Pas disponible dans la démo');
  }
}
