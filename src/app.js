import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// Moments are soft parts of a day, not clock times.
const BANDS = {
  matin: { word: 'matin', start: 9 * 60, end: 12 * 60 },
  midi: { word: 'midi', start: 12 * 60, end: 14 * 60 },
  aprem: { word: 'après-midi', start: 14 * 60 + 30, end: 18 * 60 },
  soir: { word: 'soir', start: 19 * 60, end: 22 * 60 },
};
const SLOT_RE = /^(\d{4}-\d{2}-\d{2}):(matin|midi|aprem|soir)$/;
const REMIND_BEFORE_MS = 30 * 60 * 1000;
const MAX_CANDLES = 40;
const WEEK_MS = 7 * 86400000;

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

// "2026-10-18:soir" → "dimanche soir"
export function slotWords(slot) {
  const [, date, band] = slot.match(SLOT_RE);
  const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  return `${day} ${BANDS[band].word}`;
}

// Wall-clock time in a time zone → real instant.
function zonedTime(date, minutes, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess).map((p) => [p.type, p.value]));
  const seen = Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (seen - guess));
}

function slotStart(slot, tz) {
  const [, date, band] = slot.match(SLOT_RE);
  return zonedTime(date, BANDS[band].start, tz);
}

function yesterday() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

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
 */
export function createApp({ dataDir, vapidPublicKey, sendPush }) {
  const store = new Store(dataDir);
  const db = store.data;

  // ---------- helpers ----------

  const publicUser = (u) => ({ id: u.id, name: u.name });
  const keep = () => yesterday();
  const candlesOf = (u) => (u.free || []).filter((s) => s.slice(0, 10) >= keep());

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

  function momentFor(m, me) {
    const other = db.users[m.from === me.id ? m.to : m.from];
    return { id: m.id, slot: m.slot, at: m.at, with: other ? publicUser(other) : null };
  }

  function snapshot(me) {
    const now = Date.now();
    const since = now - WEEK_MS;
    const people = store.peopleOf(me.id).map((p) => {
      const between = (from, to) => db.pings.filter((x) => x.from === from && x.to === to && x.at > since).map((x) => x.at);
      return {
        ...publicUser(p),
        pingsFromThem: between(p.id, me.id),
        pingsFromMe: between(me.id, p.id),
        candles: candlesOf(p),
      };
    });
    const moments = Object.values(db.moments)
      .filter((m) => (m.from === me.id || m.to === me.id) && m.status === 'confirmed' && new Date(m.at).getTime() > now - 3 * 3600000)
      .map((m) => momentFor(m, me))
      .sort((a, b) => new Date(a.at) - new Date(b.at));
    return {
      me: { ...publicUser(me), code: me.code, seenAt: me.seenAt || 0, hasPush: (me.subs || []).length > 0, candles: candlesOf(me) },
      people,
      moments,
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

  function validTz(tz) {
    try {
      new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
      return tz;
    } catch {
      return 'Europe/Paris';
    }
  }

  async function connect(me, inviter) {
    if (!inviter || inviter.id === me.id) return false;
    if (!store.link(me.id, inviter.id)) return false;
    store.save();
    await notify(inviter, { title: me.name, body: "vient d'arriver de l'autre côté du lac 🏡", tag: `join-${me.id}` });
    return true;
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
      name: cleanName(body.name), tz: validTz(body.tz), free: [],
      subs: [], unread: 0, seenAt: Date.now(), createdAt: Date.now(),
    };
    while (store.userByCode(user.code)) user.code = code();
    db.users[user.id] = user;
    store.save();
    await connect(user, store.userByCode(body.invite));
    return { token: user.token, ...snapshot(user) };
  });

  route('GET', /^\/api\/me$/, (req) => snapshot(requireUser(req)));

  route('PATCH', /^\/api\/me$/, (req, _, body) => {
    const me = requireUser(req);
    if (body.name !== undefined) me.name = cleanName(body.name);
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

  route('POST', /^\/api\/pings$/, async (req, _, body) => {
    const me = requireUser(req);
    const to = requirePerson(me, body.to);
    const now = Date.now();
    const last = db.pings.findLast((p) => p.from === me.id && p.to === to.id);
    // Ignore accidental double taps.
    if (last && now - last.at < 2000) return { ok: true };
    db.pings.push({ from: me.id, to: to.id, at: now });
    if (db.pings.length > 5000) db.pings.splice(0, db.pings.length - 5000);
    const recent = db.pings.filter((p) => p.from === me.id && p.to === to.id && now - p.at < 12 * 3600000).length;
    await notify(to, {
      title: me.name,
      body: recent > 1 ? `pense encore à toi 💗 ×${recent}` : 'pense à toi 💗',
      tag: `ping-${me.id}`,
    });
    return { ok: true };
  });

  // Candles: "I am free then". Two candles at the same moment become a star — a moment together.
  route('PUT', /^\/api\/candles$/, async (req, _, body) => {
    const me = requireUser(req);
    if (!Array.isArray(body.slots)) throw new HttpError(400, 'Bougies invalides');
    const before = candlesOf(me);
    me.free = [...new Set(body.slots.filter((x) => typeof x === 'string' && SLOT_RE.test(x) && x.slice(0, 10) >= keep()))]
      .sort()
      .slice(0, MAX_CANDLES);
    const lit = me.free.filter((x) => !before.includes(x));
    const blown = before.filter((x) => !me.free.includes(x));
    store.save();

    const pair = (a, b) => pairKey(a, b);
    const confirmed = () => Object.values(db.moments).filter((m) => m.status === 'confirmed');

    // Blowing out a candle lets go of the stars it made.
    for (const m of confirmed().filter((x) => blown.includes(x.slot) && (x.from === me.id || x.to === me.id))) {
      m.status = 'cancelled';
      const other = db.users[m.from === me.id ? m.to : m.from];
      if (other) await notify(other, { title: me.name, body: `ne peut plus ${slotWords(m.slot)}. Sa bougie s'est éteinte 🕯️`, tag: `moment-${m.id}` });
    }

    let starred = false;
    for (const p of store.peopleOf(me.id)) {
      for (const slot of lit.filter((x) => candlesOf(p).includes(x))) {
        if (confirmed().some((m) => m.slot === slot && pair(m.from, m.to) === pair(me.id, p.id))) continue;
        const m = { id: id(), from: me.id, to: p.id, slot, at: slotStart(slot, me.tz).toISOString(), status: 'confirmed', createdAt: Date.now() };
        db.moments[m.id] = m;
        starred = true;
        store.save();
        await notify(p, { title: me.name, body: `Une étoile pour ${slotWords(slot)} ✨ Vous vous retrouvez.`, tag: `moment-${m.id}` });
      }
    }

    // Lighting a lonely candle gently lets the others know — once a day at most.
    if (lit.length && !starred && Date.now() - (me.candleNoticeAt || 0) > 20 * 3600000) {
      me.candleNoticeAt = Date.now();
      store.save();
      for (const p of store.peopleOf(me.id)) {
        await notify(p, { title: me.name, body: `a allumé une bougie pour ${slotWords(lit[0])} 🕯️`, tag: `candle-${me.id}`, url: `/?t=${encodeURIComponent(lit[0])}` });
      }
    }
    return snapshot(me);
  });

  route('GET', /^\/api\/moments\/([\w-]+)\.ics$/, (req, [mid], _, res, url) => {
    const m = db.moments[mid];
    if (!m || m.status !== 'confirmed') throw new HttpError(404, 'Moment introuvable');
    const viewer = url.searchParams.get('for');
    const other = db.users[viewer === m.from ? m.to : m.from];
    const band = BANDS[m.slot.match(SLOT_RE)[2]];
    const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const start = new Date(m.at);
    const end = new Date(start.getTime() + (band.end - band.start) * 60000);
    const title = `✨ ${other?.name ?? ''}`.replace(/[,;\\\r\n]/g, ' ');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pense a toi//FR', 'BEGIN:VEVENT',
      `UID:${m.id}@pense-a-toi`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${title}`, 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="moment.ics"' });
    res.end(ics);
    return undefined;
  });

  // ---------- reminders ----------

  async function sendReminders(now = Date.now()) {
    for (const m of Object.values(db.moments)) {
      if (m.status !== 'confirmed' || m.reminded) continue;
      const t = new Date(m.at).getTime();
      if (t - now > REMIND_BEFORE_MS || t < now) continue;
      m.reminded = true;
      store.save();
      for (const [uid, otherId] of [[m.from, m.to], [m.to, m.from]]) {
        const user = db.users[uid];
        const other = db.users[otherId];
        if (!user || !other) continue;
        const body = `Ton moment avec ${other.name}, c'est bientôt ✨`;
        await notify(user, { title: 'Pense à toi', body, tag: `remind-${m.id}`, unread: false });
      }
    }
  }

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
      description: 'Un petit lac, des lanternes : dire « je pense à toi » et se retrouver.',
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

  const reminderTimer = setInterval(() => sendReminders().catch(console.error), 60 * 1000);
  reminderTimer.unref();
  server.on('close', () => {
    clearInterval(reminderTimer);
    store.flush();
  });

  return { server, store, sendReminders };
}
