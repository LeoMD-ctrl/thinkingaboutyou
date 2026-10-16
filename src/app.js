import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const KINDS = { call: { emoji: '📞', word: 'appel' }, meet: { emoji: '🫶', word: 'moment ensemble' } };
const REMIND_BEFORE_MS = 30 * 60 * 1000;
const MAX_SLOTS = 3;

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

function validTz(tz) {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
    return tz;
  } catch {
    return 'Europe/Paris';
  }
}

export function formatSlot(iso, tz) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: validTz(tz),
  }).format(new Date(iso));
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

  const publicUser = (u) => ({ id: u.id, name: u.name, emoji: u.emoji });

  async function notify(user, { title, body, tag, url = '/', unread = true }) {
    if (unread) user.unread = (user.unread || 0) + 1;
    store.save();
    const payload = JSON.stringify({ title, body, tag, url, badge: user.unread || 0 });
    const subs = user.subs || [];
    await Promise.all(subs.map(async (sub) => {
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

  function visibleMoment(m, now = Date.now()) {
    if (m.status === 'confirmed') return new Date(m.at).getTime() > now - 2 * 3600 * 1000;
    if (m.status === 'proposed') return m.slots.some((s) => new Date(s).getTime() > now);
    return false;
  }

  function momentFor(m, me) {
    const other = db.users[m.from === me.id ? m.to : m.from];
    return {
      id: m.id, kind: m.kind, status: m.status, mine: m.from === me.id,
      with: other ? publicUser(other) : null, slots: m.slots, at: m.at, createdAt: m.createdAt,
    };
  }

  function snapshot(me) {
    const now = Date.now();
    const since = now - 48 * 3600 * 1000;
    const people = store.peopleOf(me.id).map((p) => {
      const fromThem = db.pings.filter((x) => x.from === p.id && x.to === me.id && x.at > since).map((x) => x.at);
      const fromMe = db.pings.filter((x) => x.from === me.id && x.to === p.id).map((x) => x.at);
      return { ...publicUser(p), pingsFromThem: fromThem, lastFromMe: fromMe.length ? Math.max(...fromMe) : null };
    });
    const moments = Object.values(db.moments)
      .filter((m) => (m.from === me.id || m.to === me.id) && visibleMoment(m, now))
      .map((m) => momentFor(m, me))
      .sort((a, b) => new Date(a.at || a.slots[0]) - new Date(b.at || b.slots[0]));
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

  function cleanEmoji(emoji) {
    const e = String(emoji || '').trim();
    return e && [...e].length <= 4 ? e : '🌷';
  }

  async function connect(me, inviter) {
    if (!inviter || inviter.id === me.id) return false;
    if (!store.link(me.id, inviter.id)) return false;
    store.save();
    await notify(inviter, {
      title: `${me.emoji} ${me.name}`,
      body: `a rejoint Pense à toi ! Envoie-lui un premier cœur 💗`,
      tag: `join-${me.id}`,
    });
    return true;
  }

  function parseSlots(slots) {
    if (!Array.isArray(slots)) throw new HttpError(400, 'Propose au moins un moment');
    const now = Date.now();
    const clean = [...new Set(slots.map((s) => new Date(s)).filter((d) => !Number.isNaN(d.getTime()) && d.getTime() > now - 60000).map((d) => d.toISOString()))]
      .sort()
      .slice(0, MAX_SLOTS);
    if (!clean.length) throw new HttpError(400, 'Propose au moins un moment à venir');
    return clean;
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
      name: cleanName(body.name), emoji: cleanEmoji(body.emoji), tz: validTz(body.tz),
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
    if (body.emoji !== undefined) me.emoji = cleanEmoji(body.emoji);
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
    if (db.pings.length > 2000) db.pings.splice(0, db.pings.length - 2000);
    const today = db.pings.filter((p) => p.from === me.id && p.to === to.id && now - p.at < 12 * 3600 * 1000).length;
    await notify(to, {
      title: `${me.emoji} ${me.name}`,
      body: today > 1 ? `pense encore à toi 💗 ×${today}` : 'pense à toi 💗',
      tag: `ping-${me.id}`,
    });
    return { ok: true };
  });

  route('POST', /^\/api\/moments$/, async (req, _, body) => {
    const me = requireUser(req);
    const to = requirePerson(me, body.with);
    const kind = KINDS[body.kind] ? body.kind : 'call';
    const slots = parseSlots(body.slots);
    if (body.replaces) {
      const old = db.moments[body.replaces];
      if (old && (old.from === me.id || old.to === me.id) && old.status === 'proposed') old.status = 'replaced';
    }
    const m = { id: id(), from: me.id, to: to.id, kind, slots, at: null, status: 'proposed', createdAt: Date.now() };
    db.moments[m.id] = m;
    store.save();
    const what = kind === 'call' ? "aimerait t'appeler 📞" : 'aimerait te voir 🫶';
    await notify(to, {
      title: `${me.emoji} ${me.name}`,
      body: `${what} Quand es-tu dispo ?`,
      tag: `moment-${m.id}`,
      url: `/?moment=${m.id}`,
    });
    return momentFor(m, me);
  });

  route('POST', /^\/api\/moments\/([\w-]+)\/accept$/, async (req, [mid], body) => {
    const me = requireUser(req);
    const m = db.moments[mid];
    if (!m || m.to !== me.id) throw new HttpError(404, 'Moment introuvable');
    if (m.status !== 'proposed') throw new HttpError(409, 'Ce moment a déjà été réglé');
    const slot = m.slots.find((s) => s === body.slot);
    if (!slot) throw new HttpError(400, 'Ce créneau ne fait pas partie des propositions');
    m.status = 'confirmed';
    m.at = slot;
    store.save();
    const from = db.users[m.from];
    if (from) {
      await notify(from, {
        title: `${me.emoji} ${me.name}`,
        body: `C'est calé ! ${KINDS[m.kind].emoji} ${formatSlot(slot, from.tz)}`,
        tag: `moment-${m.id}`,
        url: `/?moment=${m.id}`,
      });
    }
    return momentFor(m, me);
  });

  route('POST', /^\/api\/moments\/([\w-]+)\/cancel$/, async (req, [mid]) => {
    const me = requireUser(req);
    const m = db.moments[mid];
    if (!m || (m.from !== me.id && m.to !== me.id)) throw new HttpError(404, 'Moment introuvable');
    if (m.status !== 'proposed' && m.status !== 'confirmed') return { ok: true };
    const wasConfirmed = m.status === 'confirmed';
    m.status = 'cancelled';
    store.save();
    const other = db.users[m.from === me.id ? m.to : m.from];
    if (other && (wasConfirmed || m.to === me.id)) {
      await notify(other, {
        title: `${me.emoji} ${me.name}`,
        body: wasConfirmed
          ? `ne peut plus pour ${KINDS[m.kind].emoji} ${formatSlot(m.at, other.tz)}. On trouve un autre moment ?`
          : `n'est pas dispo à ces moments-là. On en trouve un autre ?`,
        tag: `moment-${m.id}`,
      });
    }
    return { ok: true };
  });

  route('GET', /^\/api\/moments\/([\w-]+)\.ics$/, (req, [mid], _, res) => {
    const m = db.moments[mid];
    if (!m || m.status !== 'confirmed') throw new HttpError(404, 'Moment introuvable');
    const a = db.users[m.from];
    const b = db.users[m.to];
    const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const start = new Date(m.at);
    const end = new Date(start.getTime() + (m.kind === 'call' ? 30 : 120) * 60000);
    const title = `${KINDS[m.kind].emoji} ${a?.name ?? ''} & ${b?.name ?? ''}`.replace(/[,;\\]/g, ' ');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pense a toi//FR', 'BEGIN:VEVENT',
      `UID:${m.id}@pense-a-toi`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${title}`, 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `inline; filename="moment.ics"` });
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
      const mins = Math.max(1, Math.round((t - now) / 60000));
      for (const [me, otherId] of [[m.from, m.to], [m.to, m.from]]) {
        const user = db.users[me];
        const other = db.users[otherId];
        if (!user || !other) continue;
        const body = m.kind === 'call'
          ? `Dans ${mins} min : appel avec ${other.name} 📞`
          : `Dans ${mins} min : tu retrouves ${other.name} 🫶`;
        await notify(user, { title: 'Pense à toi 💗', body, tag: `remind-${m.id}`, url: `/?moment=${m.id}`, unread: false });
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
    res.end(content);
  }

  function serveManifest(res, url) {
    const invite = url.searchParams.get('invite');
    const start = invite && /^[A-Za-z0-9]{6}$/.test(invite) ? `/?invite=${invite.toUpperCase()}` : '/';
    const manifest = {
      name: 'Pense à toi',
      short_name: 'Pense à toi',
      description: 'Un petit cœur pour dire « je pense à toi », et un moment pour se retrouver.',
      start_url: start,
      scope: '/',
      display: 'standalone',
      background_color: '#FFF6F1',
      theme_color: '#FFF6F1',
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
      const result = await r.handler(req, params, body, res);
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
