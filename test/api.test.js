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

// Slot keys for the next days, in the same shape the app paints them.
function day(offset) {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
}
const slot = (offset, band) => `${day(offset)}:${band}`;
const startOf = (offset) => new Date(`${day(offset)}T19:00:00`).toISOString();

test('the whole little story: invite, thoughts, painting the sky, a moment', async () => {
  const leo = (await call('POST', '/api/users', { body: { name: 'Léo', color: 'ciel', tz: 'Europe/Paris' } })).json;
  assert.ok(leo.token);
  assert.equal(leo.me.color, 'ciel');
  assert.match(leo.me.code, /^[A-Z0-9]{6}$/);
  await call('POST', '/api/push', { token: leo.token, body: { subscription: sub('leo') } });

  // Maman opens Léo's invite.
  const invite = await call('GET', `/api/invites/${leo.me.code}`);
  assert.deepEqual(invite.json.from, { id: leo.me.id, name: 'Léo', color: 'ciel' });
  const maman = (await call('POST', '/api/users', { body: { name: 'Maman', color: 'rose', invite: leo.me.code } })).json;
  assert.equal(maman.people[0].name, 'Léo');
  assert.match(lastPushTo('leo').body, /arrivé/);
  await call('POST', '/api/push', { token: maman.token, body: { subscription: sub('maman') } });

  // A thought, then another one.
  await call('POST', '/api/pings', { token: maman.token, body: { to: leo.me.id } });
  assert.equal(lastPushTo('leo').title, 'Maman');
  assert.equal(lastPushTo('leo').body, 'pense à toi 💗');
  assert.equal(lastPushTo('leo').badge, 2);
  await new Promise((r) => setTimeout(r, 2100));
  await call('POST', '/api/pings', { token: maman.token, body: { to: leo.me.id } });
  assert.match(lastPushTo('leo').body, /encore.*×2/);
  const leoView = (await call('GET', '/api/me', { token: leo.token })).json;
  assert.equal(leoView.people[0].pingsFromThem.length, 2);
  assert.equal(leoView.people[0].pingsFromMe.length, 0);
  await call('POST', '/api/seen', { token: leo.token });

  // Léo paints his free moments: Maman hears about it once.
  const painted = await call('PUT', `/api/sky/${maman.me.id}`, { token: leo.token, body: { cells: [slot(2, 'soir'), slot(3, 'midi'), 'nonsense', slot(-5, 'soir')] } });
  assert.deepEqual(painted.json.people[0].sky.mine, [slot(2, 'soir'), slot(3, 'midi')]);
  assert.match(lastPushTo('maman').body, /a peint/);
  const quiet = sent.length;
  await call('PUT', `/api/sky/${maman.me.id}`, { token: leo.token, body: { cells: [slot(2, 'soir'), slot(3, 'midi'), slot(4, 'matin')] } });
  assert.equal(sent.length, quiet, 'no second "painted" notice the same day');

  // A moment can only be planned where both skies meet.
  const early = await call('POST', '/api/moments', { token: maman.token, body: { with: leo.me.id, slot: slot(2, 'soir'), at: startOf(2), kind: 'meet' } });
  assert.equal(early.status, 409);

  // Maman paints too: their skies meet, Léo is told.
  const mamanSky = (await call('PUT', `/api/sky/${leo.me.id}`, { token: maman.token, body: { cells: [slot(2, 'soir'), slot(5, 'aprem')] } })).json;
  assert.deepEqual(mamanSky.people[0].sky.theirs, [slot(2, 'soir'), slot(3, 'midi'), slot(4, 'matin')]);
  assert.match(lastPushTo('leo').body, /Vos ciels se croisent .* soir/);

  const m = (await call('POST', '/api/moments', { token: maman.token, body: { with: leo.me.id, slot: slot(2, 'soir'), at: startOf(2), kind: 'meet' } })).json;
  assert.equal(m.slot, slot(2, 'soir'));
  assert.match(lastPushTo('leo').body, /C'est calé : .* soir 🫶/);
  const again = (await call('POST', '/api/moments', { token: leo.token, body: { with: maman.me.id, slot: slot(2, 'soir'), at: startOf(2), kind: 'call' } })).json;
  assert.equal(again.id, m.id, 'the same moment is not planned twice');
  assert.equal((await call('GET', '/api/me', { token: leo.token })).json.moments.length, 1);

  // Calendar entry is named after the other person.
  const ics = await (await fetch(`${base}/api/moments/${m.id}.ics?for=${leo.me.id}`)).text();
  assert.match(ics, /SUMMARY:🫶 Maman/);

  // Reminder fires once, shortly before.
  const before = sent.length;
  await app.sendReminders(new Date(m.at).getTime() - 20 * 60000);
  await app.sendReminders(new Date(m.at).getTime() - 10 * 60000);
  assert.equal(sent.length - before, 2);
  assert.match(lastPushTo('maman').body, /Tu retrouves Léo bientôt/);

  // Cancelling tells the other one and clears that spot from my sky.
  await call('POST', `/api/moments/${m.id}/cancel`, { token: leo.token });
  assert.match(lastPushTo('maman').body, /ne peut plus .* soir/);
  const after = (await call('GET', '/api/me', { token: leo.token })).json;
  assert.equal(after.moments.length, 0);
  assert.ok(!after.people[0].sky.mine.includes(slot(2, 'soir')));
});

test('guards: auth, strangers, bad codes, dead subscriptions', async () => {
  assert.equal((await call('GET', '/api/me')).status, 401);
  const a = (await call('POST', '/api/users', { body: { name: 'Solo', color: 'not-a-color' } })).json;
  assert.equal(a.me.color, 'rose');
  const stranger = (await call('POST', '/api/users', { body: { name: 'Inconnu' } })).json;
  assert.equal((await call('POST', '/api/pings', { token: a.token, body: { to: stranger.me.id } })).status, 404);
  assert.equal((await call('PUT', `/api/sky/${stranger.me.id}`, { token: a.token, body: { cells: [] } })).status, 404);
  assert.equal((await call('POST', '/api/connect', { token: a.token, body: { code: 'NOPE00' } })).status, 404);
  assert.equal((await call('POST', '/api/connect', { token: a.token, body: { code: a.me.code } })).status, 400);
  assert.equal((await call('POST', '/api/users', { body: { name: '   ' } })).status, 400);

  const linked = (await call('POST', '/api/connect', { token: stranger.token, body: { code: a.me.code } })).json;
  assert.equal(linked.people.length, 1);

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
