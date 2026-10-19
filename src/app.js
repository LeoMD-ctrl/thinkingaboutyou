import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { openMeteo, coarse } from './weather.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const WEEK_MS = 7 * 86400000;
const DAY_MS = 86400000;
const WEATHER_FRESH_MS = 30 * 60000;

// The decors one can live in. Every map shares the same gestures.
export const MAPS = ['campagne', 'jardin', 'ocean', 'montagne'];
// A sign appears when each one has sent at least this many thoughts to the other over the last week.
export const SIGN_THRESHOLD = 3;
// The only words a mot doux can carry.
export const WORDS = ['courage !', 'belle journée', "je t'embrasse", 'tu me manques', "j'ai hâte de te voir", 'douce nuit'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

const id = () => crypto.randomBytes(9).toString('base64url');
const code = () => Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const pairKey = (a, b) => [a, b].sort().join(':');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.dataDir   where db.json lives
 * @param {string} opts.vapidPublicKey
 * @param {(sub: object, payload: string) => Promise<void>} opts.sendPush
 *        rejects with { statusCode: 404|410 } when the subscription is gone
 * @param {(lat: number, lon: number) => Promise<{kind: string, temp: number}>} [opts.fetchWeather]
 */
export function createApp({ dataDir, vapidPublicKey, sendPush, fetchWeather = openMeteo }) {
  const store = new Store(dataDir);
  const db = store.data;

  // ---------- helpers ----------

  const publicUser = (u) => ({ id: u.id, name: u.name });

  async function notify(user, { title, body, tag, url = '/', unread = true }) {
    if (unread) user.unread = (user.unread || 0) + 1;
    store.save();
    const payload = JSON.stringify({ title, body, tag, url, badge: user.unread || 0 });
    await Promise.all((user.subs || []).map(async (sub) => {
      try {
        await sendPush(sub, payload);
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          user.subs = user.subs.filter((s) => s.endpoint !== sub.endpoint);
          store.save();
        } else {
          console.warn('push failed', err?.statusCode || '', err?.body || err?.message || err);
        }
      }
    }));
  }

  // ---------- weather (opt-in) ----------

  const pending = new Set();
  async function refreshWeather(user) {
    const w = user.weather;
    if (!w || pending.has(user.id)) return;
    pending.add(user.id);
    try {
      const now = await fetchWeather(w.lat, w.lon);
      if (user.weather === w) {
        Object.assign(w, now, { at: Date.now() });
        store.save();
      }
    } catch (err) {
      console.warn('weather failed', err?.message || err);
    } finally {
      pending.delete(user.id);
    }
  }

  // What others may know: the kind of weather and the temperature, never the place.
  function weatherOf(user) {
    const w = user.weather;
    if (!w) return null;
    if (Date.now() - (w.at || 0) > WEATHER_FRESH_MS) refreshWeather(user);
    return w.kind ? { kind: w.kind, temp: w.temp } : null;
  }

  const thoughts = (from, to, since) => db.pings.filter((p) => p.from === from && p.to === to && p.at > since);

  // The sign between two people: alive while both keep thinking of each other.
  // Each appearance is an episode; a mot doux can be sent once per episode.
  function signOf(a, b, now = Date.now()) {
    const key = pairKey(a, b);
    const since = now - WEEK_MS;
    const alive = thoughts(a, b, since).length >= SIGN_THRESHOLD && thoughts(b, a, since).length >= SIGN_THRESHOLD;
    if (alive && !db.signs[key]) {
      db.signs[key] = { since: now, sent: {} };
      store.save();
    } else if (!alive && db.signs[key]) {
      delete db.signs[key];
      store.save();
    }
    return db.signs[key] || null;
  }

  function snapshot(me) {
    const now = Date.now();
    const people = store.peopleOf(me.id).map(({ user: p, place }) => {
      const sign = signOf(me.id, p.id, now);
      return {
        ...publicUser(p),
        place,
        pingsFromThem: thoughts(p.id, me.id, now - WEEK_MS).map((x) => x.at),
        pingsFromMe: thoughts(me.id, p.id, now - WEEK_MS).map((x) => x.at),
        mots: thoughts(p.id, me.id, now - DAY_MS).filter((x) => x.word).map((x) => ({ at: x.at, word: x.word })),
        sign: sign ? { since: sign.since, sent: Boolean(sign.sent[me.id]) } : null,
        weather: weatherOf(p),
      };
    });
    return {
      me: {
        ...publicUser(me), code: me.code, map: me.map || MAPS[0], seenAt: me.seenAt || 0, hasPush: (me.subs || []).length > 0,
        sharesWeather: Boolean(me.weather), weather: weatherOf(me),
      },
      people,
      words: WORDS,
    };
  }

  function requireUser(req) {
    const auth = req.headers.authorization || '';
    const user = store.userByToken(auth.replace(/^Bearer\s+/i, ''));
    if (!user) throw new HttpError(401, 'Qui es-tu ?');
    return user;
  }

  function requirePerson(me, otherId) {
    const other = db.users[otherId];
    if (!other || !store.linked(me.id, other.id)) throw new HttpError(404, 'Personne introuvable');
    return other;
  }

  function cleanName(name) {
    const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!n) throw new HttpError(400, 'Il nous faut un prénom 🙂');
    return n;
  }

  const cleanMap = (m) => (MAPS.includes(m) ? m : MAPS[0]);

  function validTz(tz) {
    try {
      new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
      return tz;
    } catch {
      return 'Europe/Paris';
    }
  }

  async function connect(me, inviter) {
    if (!inviter || inviter.id === me.id) return;
    const result = store.link(me.id, inviter.id);
    if (result === 'full') throw new HttpError(409, 'Il n’y a plus de place sur l’une de vos cartes');
    if (result !== 'linked') return;
    store.save();
    await notify(inviter, { title: me.name, body: "vient d'arriver près de chez toi 🏡", tag: `join-${me.id}` });
  }

  // ---------- routes ----------

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  route('GET', /^\/api\/config$/, () => ({ vapidPublicKey }));

  route('GET', /^\/api\/invites\/([A-Za-z0-9]+)$/, (req, [c]) => {
    const u = store.userByCode(c);
    if (!u) throw new HttpError(404, 'Ce code ne mène nulle part 🥲');
    return { from: publicUser(u) };
  });

  route('POST', /^\/api\/users$/, async (req, _, body) => {
    const user = {
      id: id(), token: crypto.randomBytes(24).toString('base64url'), code: code(),
      name: cleanName(body.name), map: cleanMap(body.map), tz: validTz(body.tz),
      subs: [], unread: 0, seenAt: Date.now(), createdAt: Date.now(),
    };
    while (store.userByCode(user.code)) user.code = code();
    db.users[user.id] = user;
    store.save();
    await connect(user, store.userByCode(body.invite)).catch(() => {});
    return { token: user.token, ...snapshot(user) };
  });

  route('GET', /^\/api\/me$/, (req) => snapshot(requireUser(req)));

  route('PATCH', /^\/api\/me$/, (req, _, body) => {
    const me = requireUser(req);
    if (body.name !== undefined) me.name = cleanName(body.name);
    if (body.map !== undefined) me.map = cleanMap(body.map);
    if (body.tz !== undefined) me.tz = validTz(body.tz);
    store.save();
    return snapshot(me);
  });

  route('POST', /^\/api\/seen$/, (req) => {
    const me = requireUser(req);
    me.seenAt = Date.now();
    me.unread = 0;
    store.save();
    return { ok: true };
  });

  route('POST', /^\/api\/push$/, (req, _, body) => {
    const me = requireUser(req);
    const sub = body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) {
      throw new HttpError(400, 'Abonnement invalide');
    }
    me.subs = (me.subs || []).filter((s) => s.endpoint !== sub.endpoint);
    me.subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    me.subs = me.subs.slice(-5);
    store.save();
    return { ok: true };
  });

  route('POST', /^\/api\/connect$/, async (req, _, body) => {
    const me = requireUser(req);
    const inviter = store.userByCode(body.code);
    if (!inviter) throw new HttpError(404, 'Ce code ne mène nulle part 🥲');
    if (inviter.id === me.id) throw new HttpError(400, "C'est ton propre code 😄");
    await connect(me, inviter);
    return snapshot(me);
  });

  // Sharing my weather: coarse coordinates only, and it can be stopped at any time.
  route('PUT', /^\/api\/weather$/, async (req, _, body) => {
    const me = requireUser(req);
    const lat = coarse(body.lat);
    const lon = coarse(body.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new HttpError(400, 'Position invalide');
    }
    const moved = !me.weather || me.weather.lat !== lat || me.weather.lon !== lon;
    if (moved) me.weather = { lat, lon };
    store.save();
    if (moved) await refreshWeather(me);
    return snapshot(me);
  });

  route('DELETE', /^\/api\/weather$/, (req) => {
    const me = requireUser(req);
    delete me.weather;
    store.save();
    return snapshot(me);
  });

  // Letting someone go: quietly, nobody is told.
  route('POST', /^\/api\/unlink$/, (req, _, body) => {
    const me = requireUser(req);
    const other = requirePerson(me, body.id);
    store.unlink(me.id, other.id);
    delete db.signs[pairKey(me.id, other.id)];
    store.save();
    return snapshot(me);
  });

  route('POST', /^\/api\/pings$/, async (req, _, body) => {
    const me = requireUser(req);
    const to = requirePerson(me, body.to);
    const now = Date.now();
    const last = db.pings.findLast((p) => p.from === me.id && p.to === to.id);
    // Ignore accidental double taps.
    if (last && now - last.at < 2000) return snapshot(me);
    db.pings.push({ from: me.id, to: to.id, at: now });
    if (db.pings.length > 5000) db.pings.splice(0, db.pings.length - 5000);
    const recent = thoughts(me.id, to.id, now - 12 * 3600000).length;
    await notify(to, {
      title: me.name,
      body: recent > 1 ? `pense encore à toi 💗 ×${recent}` : 'pense à toi 💗',
      tag: `ping-${me.id}`,
    });
    return snapshot(me);
  });

  // A mot doux: a thought carrying one of a few words, sent once per sign.
  route('POST', /^\/api\/mots$/, async (req, _, body) => {
    const me = requireUser(req);
    const to = requirePerson(me, body.to);
    if (!WORDS.includes(body.word)) throw new HttpError(400, 'Ce mot-là n’existe pas');
    const sign = signOf(me.id, to.id);
    if (!sign) throw new HttpError(409, 'Il n’y a pas de signe entre vous pour le moment');
    if (sign.sent[me.id]) throw new HttpError(409, 'Ton mot doux est déjà parti');
    sign.sent[me.id] = body.word;
    db.pings.push({ from: me.id, to: to.id, at: Date.now(), word: body.word });
    store.save();
    await notify(to, { title: me.name, body: `pense à toi · ${body.word}`, tag: `mot-${me.id}` });
    return snapshot(me);
  });

  // ---------- http ----------

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/manifest.webmanifest') return serveManifest(res, url);
    if (rel === '/' || rel === '/index.html') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    let content = fs.readFileSync(file);
    const ext = path.extname(file);
    if (rel === '/index.html') {
      // iOS installs the page's manifest: point its start_url at the invite so the
      // freshly installed app still knows who invited you.
      const invite = url.searchParams.get('invite');
      if (invite && /^[A-Za-z0-9]{6}$/.test(invite)) {
        content = content.toString().replace('/manifest.webmanifest', `/manifest.webmanifest?invite=${invite.toUpperCase()}`);
      }
    }
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.png' ? 'public, max-age=86400' : 'no-cache',
    });
    return res.end(content);
  }

  function serveManifest(res, url) {
    const invite = url.searchParams.get('invite');
    const start = invite && /^[A-Za-z0-9]{6}$/.test(invite) ? `/?invite=${invite.toUpperCase()}` : '/';
    const manifest = {
      name: 'Pense à toi',
      short_name: 'Pense à toi',
      description: 'Un petit monde où dire « je pense à toi » à ceux qu’on aime.',
      start_url: start,
      scope: '/',
      display: 'standalone',
      background_color: '#2E2F63',
      theme_color: '#A99BE6',
      lang: 'fr',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
    res.writeHead(200, { 'Content-Type': TYPES['.webmanifest'], 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(manifest));
  }

  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32 * 1024) throw new HttpError(413, 'Trop gros');
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'JSON invalide');
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');
        return serveStatic(req, res, url);
      }
      const r = routes.find((x) => x.method === req.method && x.pattern.test(url.pathname));
      if (!r) throw new HttpError(404, 'Introuvable');
      const params = url.pathname.match(r.pattern).slice(1);
      const body = req.method === 'GET' ? {} : await readJson(req);
      const result = await r.handler(req, params, body, res, url);
      if (result === undefined) return undefined;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(result));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: status === 500 ? 'Oups, petit souci 🥲' : err.message }));
    }
  });

  // Keep shared weather fresh even when nobody is looking.
  const weatherTimer = setInterval(() => {
    for (const u of Object.values(db.users)) if (u.weather) refreshWeather(u);
  }, WEATHER_FRESH_MS);
  weatherTimer.unref();
  server.on('close', () => {
    clearInterval(weatherTimer);
    store.flush();
  });

  return { server, store };
}
