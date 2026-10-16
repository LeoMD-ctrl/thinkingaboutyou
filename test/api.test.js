import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

const sent = [];
let base;
let app;
let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pat-'));
  app = createApp({
    dataDir: dir,
    vapidPublicKey: 'test-key',
    sendPush: async (sub, payload) => {
      if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) });
    },
  });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://localhost:${app.server.address().port}`;
});

after(async () => {
  const closed = new Promise((r) => app.server.close(r));
  app.server.closeAllConnections();
  await closed;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const sub = (name) => ({ endpoint: `https://push.example/${name}`, keys: { p256dh: 'p', auth: 'a' } });
const lastPushTo = (name) => sent.filter((s) => s.endpoint.endsWith(`/${name}`)).at(-1);

test('the whole little story: invite, hearts, and finding a moment', async () => {
  const leo = (await call('POST', '/api/users', { body: { name: 'Léo', emoji: '🐻', tz: 'Europe/Paris' } })).json;
  assert.ok(leo.token);
  assert.match(leo.me.code, /^[A-Z0-9]{6}$/);
  await call('POST', '/api/push', { token: leo.token, body: { subscription: sub('leo') } });

  // Maman opens Léo's invite.
  const invite = await call('GET', `/api/invites/${leo.me.code}`);
  assert.equal(invite.json.from.name, 'Léo');
  const maman = (await call('POST', '/api/users', { body: { name: 'Maman', emoji: '🌷', invite: leo.me.code } })).json;
  assert.equal(maman.people.length, 1);
  assert.equal(maman.people[0].name, 'Léo');
  assert.match(lastPushTo('leo').body, /a rejoint/);
  await call('POST', '/api/push', { token: maman.token, body: { subscription: sub('maman') } });

  // A heart.
  assert.equal((await call('POST', '/api/pings', { token: maman.token, body: { to: maman.people[0].id } })).status, 200);
  const ping = lastPushTo('leo');
  assert.equal(ping.title, '🌷 Maman');
  assert.equal(ping.body, 'pense à toi 💗');
  assert.equal(ping.badge, 2);
  const leoView = (await call('GET', '/api/me', { token: leo.token })).json;
  assert.equal(leoView.people[0].pingsFromThem.length, 1);

  // Seen resets the badge.
  await call('POST', '/api/seen', { token: leo.token });

  // Léo proposes a call with two slots.
  const t1 = new Date(Date.now() + 2 * 86400000).toISOString();
  const t2 = new Date(Date.now() + 3 * 86400000).toISOString();
  const proposed = (await call('POST', '/api/moments', {
    token: leo.token, body: { with: leoView.people[0].id, kind: 'call', slots: [t2, t1, t1] },
  })).json;
  assert.deepEqual(proposed.slots, [t1, t2]);
  assert.match(lastPushTo('maman').body, /aimerait t'appeler/);

  const mamanView = (await call('GET', '/api/me', { token: maman.token })).json;
  assert.equal(mamanView.moments.length, 1);
  assert.equal(mamanView.moments[0].mine, false);

  // Léo cannot accept his own proposal; Maman can.
  assert.equal((await call('POST', `/api/moments/${proposed.id}/accept`, { token: leo.token, body: { slot: t1 } })).status, 404);
  const ok = await call('POST', `/api/moments/${proposed.id}/accept`, { token: maman.token, body: { slot: t2 } });
  assert.equal(ok.json.status, 'confirmed');
  assert.equal(ok.json.at, t2);
  assert.match(lastPushTo('leo').body, /C'est calé/);
  assert.equal(lastPushTo('leo').badge, 1);

  // Calendar file.
  const ics = await fetch(`${base}/api/moments/${proposed.id}.ics`);
  assert.equal(ics.status, 200);
  assert.match(await ics.text(), /BEGIN:VEVENT/);

  // Reminder fires once, 30 minutes before.
  const before = sent.length;
  await app.sendReminders(new Date(t2).getTime() - 20 * 60000);
  await app.sendReminders(new Date(t2).getTime() - 10 * 60000);
  assert.equal(sent.length - before, 2);
  assert.match(lastPushTo('maman').body, /Dans 20 min : appel avec Léo/);
});

test('counter-proposal replaces the original, cancel notifies', async () => {
  const a = (await call('POST', '/api/users', { body: { name: 'Léa', emoji: '🐱' } })).json;
  const b = (await call('POST', '/api/users', { body: { name: 'Sam', emoji: '🦊', invite: a.me.code } })).json;
  await call('POST', '/api/push', { token: a.token, body: { subscription: sub('lea') } });
  const soon = new Date(Date.now() + 86400000).toISOString();
  const later = new Date(Date.now() + 5 * 86400000).toISOString();
  const m1 = (await call('POST', '/api/moments', { token: a.token, body: { with: b.people[0].id, kind: 'meet', slots: [soon] } })).json;
  const m2 = (await call('POST', '/api/moments', { token: b.token, body: { with: b.people[0].id, kind: 'meet', slots: [later], replaces: m1.id } })).json;
  const view = (await call('GET', '/api/me', { token: a.token })).json;
  assert.deepEqual(view.moments.map((m) => m.id), [m2.id]);
  await call('POST', `/api/moments/${m2.id}/accept`, { token: a.token, body: { slot: later } });
  await call('POST', `/api/moments/${m2.id}/cancel`, { token: b.token });
  assert.match(lastPushTo('lea').body, /ne peut plus/);
});

test('guards: auth, strangers, bad codes, past slots, dead subscriptions', async () => {
  assert.equal((await call('GET', '/api/me')).status, 401);
  const a = (await call('POST', '/api/users', { body: { name: 'Solo' } })).json;
  const stranger = (await call('POST', '/api/users', { body: { name: 'Inconnu' } })).json;
  assert.equal((await call('POST', '/api/pings', { token: a.token, body: { to: stranger.me.id } })).status, 404);
  assert.equal((await call('POST', '/api/connect', { token: a.token, body: { code: 'NOPE00' } })).status, 404);
  assert.equal((await call('POST', '/api/connect', { token: a.token, body: { code: a.me.code } })).status, 400);
  assert.equal((await call('POST', '/api/users', { body: { name: '   ' } })).status, 400);

  const linked = (await call('POST', '/api/connect', { token: stranger.token, body: { code: a.me.code } })).json;
  assert.equal(linked.people.length, 1);
  const past = new Date(Date.now() - 3600000).toISOString();
  assert.equal((await call('POST', '/api/moments', { token: a.token, body: { with: stranger.me.id, slots: [past] } })).status, 400);

  await call('POST', '/api/push', { token: a.token, body: { subscription: sub('gone') } });
  await call('POST', '/api/pings', { token: stranger.token, body: { to: a.me.id } });
  assert.equal(app.store.userByToken(a.token).subs.length, 0);
});

test('serves the app with an invite-aware manifest', async () => {
  const html = await (await fetch(`${base}/?invite=abc123`)).text();
  assert.match(html, /manifest\.webmanifest\?invite=ABC123/);
  const manifest = await (await fetch(`${base}/manifest.webmanifest?invite=ABC123`)).json();
  assert.equal(manifest.start_url, '/?invite=ABC123');
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
});
