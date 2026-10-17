import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const COLORS = ['rose', 'ciel', 'menthe', 'miel', 'lilas', 'peche'];
const KINDS = { call: '📞', meet: '🫶' };
// Moments are soft parts of a day, not clock times.
const BANDS = {
  matin: { word: 'matin', start: 9 * 60, end: 12 * 60 },
  midi: { word: 'midi', start: 12 * 60, end: 14 * 60 },
  aprem: { word: 'après-midi', start: 14 * 60 + 30, end: 18 * 60 },
  soir: { word: 'soir', start: 19 * 60, end: 22 * 60 },
};
const SLOT_RE = /^(\d{4}-\d{2}-\d{2}):(matin|midi|aprem|soir)$/;
const REMIND_BEFORE_MS = 30 * 60 * 1000;
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

  const publicUser = (u) => ({ id: u.id, name: u.name, color: u.color });

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

  function skyOf(a, b) {
    const key = pairKey(a, b);
    db.skies[key] ||= { cells: {}, announced: [], paintedNotice: {} };
    const sky = db.skies[key];
    const keep = yesterday();
    for (const uid of Object.keys(sky.cells)) sky.cells[uid] = sky.cells[uid].filter((s) => s.slice(0, 10) >= keep);
    sky.announced = sky.announced.filter((s) => s.slice(0, 10) >= keep);
    return sky;
  }

  const overlap = (sky, a, b) => (sky.cells[a] || []).filter((s) => (sky.cells[b] || []).includes(s)).sort();

  function momentFor(m, me) {
    const other = db.users[m.from === me.id ? m.to : m.from];
    return { id: m.id, kind: m.kind, slot: m.slot, at: m.at, with: other ? publicUser(other) : null };
  }

  function snapshot(me) {
    const now = Date.now();
    const since = now - WEEK_MS;
    const people = store.peopleOf(me.id).map((p) => {
      const between = (from, to) => db.pings.filter((x) => x.from === from && x.to === to && x.at > since).map((x) => x.at);
      const sky = skyOf(me.id, p.id);
      return {
        ...publicUser(p),
        pingsFromThem: between(p.id, me.id),
        pingsFromMe: between(me.id, p.id),
        sky: { mine: sky.cells[me.id] || [], theirs: sky.cells[p.id] || [] },
      };
    });
    const moments = Object.values(db.moments)
      .filter((m) => (m.from === me.id || m.to === me.id) && m.status === 'confirmed' && new Date(m.at).getTime() > now - 3 * 3600000)
      .map((m) => momentFor(m, me))
      .sort((a, b) => new Date(a.at) - new Date(b.at));
    return {
      me: { ...publicUser(me), code: me.code, seenAt: me.seenAt || 0, hasPush: (me.subs || []).length > 0 },
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

  const cleanColor = (c) => (COLORS.includes(c) ? c : COLORS[0]);

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
    await notify(inviter, { title: me.name, body: 'est arrivé·e. Envoie-lui une première pensée 💗', tag: `join-${me.id}` });
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
      name: cleanName(body.name), color: cleanColor(body.color), tz: validTz(body.tz),
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
    if (body.color !== undefined) me.color = cleanColor(body.color);
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

  // Paint my free moments in the sky I share with someone.
  route('PUT', /^\/api\/sky\/([\w-]+)$/, async (req, [otherId], body) => {
    const me = requireUser(req);
    const other = requirePerson(me, otherId);
    if (!Array.isArray(body.cells)) throw new HttpError(400, 'Ciel invalide');
    const keep = yesterday();
    const sky = skyOf(me.id, other.id);
    const before = sky.cells[me.id] || [];
    sky.cells[me.id] = [...new Set(body.cells.filter((s) => typeof s === 'string' && SLOT_RE.test(s) && s.slice(0, 10) >= keep))]
      .sort()
      .slice(0, 28);
    const fresh = overlap(sky, me.id, other.id).filter((s) => !sky.announced.includes(s));
    store.save();

    if (fresh.length) {
      sky.announced.push(...fresh);
      await notify(other, {
        title: `${me.name} & toi`,
        body: `Vos ciels se croisent ${slotWords(fresh[0])} ☁️`,
        tag: `sky-${pairKey(me.id, other.id)}`,
        url: `/?sky=${me.id}`,
      });
    } else if (sky.cells[me.id].some((s) => !before.includes(s))) {
      // Gently tell the other side there is something to paint along with — once a day at most.
      const last = sky.paintedNotice[me.id] || 0;
      if (Date.now() - last > 86400000) {
        sky.paintedNotice[me.id] = Date.now();
        await notify(other, {
          title: me.name,
          body: 'a peint ses moments libres dans votre ciel ☁️',
          tag: `sky-${pairKey(me.id, other.id)}`,
          url: `/?sky=${me.id}`,
        });
      }
    }
    return snapshot(me);
  });

  // Turn a shared free moment into a planned one. Both already said yes by painting it.
  route('POST', /^\/api\/moments$/, async (req, _, body) => {
    const me = requireUser(req);
    const other = requirePerson(me, body.with);
    const kind = KINDS[body.kind] ? body.kind : 'call';
    if (typeof body.slot !== 'string' || !SLOT_RE.test(body.slot)) throw new HttpError(400, 'Moment invalide');
    const at = new Date(body.at);
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 6 * 3600000) throw new HttpError(400, 'Ce moment est passé');
    if (!overlap(skyOf(me.id, other.id), me.id, other.id).includes(body.slot)) {
      throw new HttpError(409, "Ce moment n'est plus libre des deux côtés");
    }
    const existing = Object.values(db.moments).find((m) => m.status === 'confirmed' && m.slot === body.slot
      && pairKey(m.from, m.to) === pairKey(me.id, other.id));
    if (existing) return momentFor(existing, me);
    const m = { id: id(), from: me.id, to: other.id, kind, slot: body.slot, at: at.toISOString(), status: 'confirmed', createdAt: Date.now() };
    db.moments[m.id] = m;
    store.save();
    await notify(other, {
      title: me.name,
      body: `C'est calé : ${slotWords(m.slot)} ${KINDS[kind]}`,
      tag: `moment-${m.id}`,
    });
    return momentFor(m, me);
  });

  route('POST', /^\/api\/moments\/([\w-]+)\/cancel$/, async (req, [mid]) => {
    const me = requireUser(req);
    const m = db.moments[mid];
    if (!m || (m.from !== me.id && m.to !== me.id)) throw new HttpError(404, 'Moment introuvable');
    if (m.status !== 'confirmed') return { ok: true };
    m.status = 'cancelled';
    // Take that moment out of my sky so it does not come straight back.
    const sky = skyOf(m.from, m.to);
    sky.cells[me.id] = (sky.cells[me.id] || []).filter((s) => s !== m.slot);
    store.save();
    const other = db.users[m.from === me.id ? m.to : m.from];
    if (other) {
      await notify(other, {
        title: me.name,
        body: `ne peut plus ${slotWords(m.slot)}. On repeint notre ciel ?`,
        tag: `moment-${m.id}`,
      });
    }
    return { ok: true };
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
    const title = `${KINDS[m.kind]} ${other?.name ?? ''}`.replace(/[,;\\\r\n]/g, ' ');
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
        const body = m.kind === 'call' ? `Ton appel avec ${other.name}, c'est bientôt 📞` : `Tu retrouves ${other.name} bientôt 🫶`;
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
      description: 'Deux petits êtres qui se rapprochent quand on pense l’un à l’autre.',
      start_url: start,
      scope: '/',
      display: 'standalone',
      background_color: '#F3E7DC',
      theme_color: '#F3E7DC',
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
