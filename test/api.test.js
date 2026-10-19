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

// Thoughts sent a while ago, written straight into the store (the API ignores rapid double taps).
function pastThoughts(from, to, n, ageMs = 3600000) {
  for (let i = 0; i < n; i++) app.store.data.pings.push({ from, to, at: Date.now() - ageMs - i * 60000 });
}
const signup = async (name, extra = {}) => (await call('POST', '/api/users', { body: { name, tz: 'Europe/Paris', ...extra } })).json;

test('the whole little story: invite, thoughts, a sign, a mot doux', async () => {
  const leo = await signup('Léo', { map: 'campagne' });
  assert.ok(leo.token);
  assert.match(leo.me.code, /^[A-Z0-9]{6}$/);
  assert.equal(leo.me.map, 'campagne');
  await call('POST', '/api/push', { token: leo.token, body: { subscription: sub('leo') } });

  // Maman opens Léo's invite and settles in the first place of his map, and he in hers.
  const invite = await call('GET', `/api/invites/${leo.me.code}`);
  assert.deepEqual(invite.json.from, { id: leo.me.id, name: 'Léo' });
  const maman = await signup('Maman', { invite: leo.me.code, map: 'pas-une-carte' });
  assert.equal(maman.me.map, 'campagne');
  assert.equal(maman.people[0].name, 'Léo');
  assert.equal(maman.people[0].place, 0);
  assert.match(lastPushTo('leo').body, /vient d'arriver/);
  await call('POST', '/api/push', { token: maman.token, body: { subscription: sub('maman') } });

  // A thought.
  await call('POST', '/api/pings', { token: maman.token, body: { to: leo.me.id } });
  assert.equal(lastPushTo('leo').title, 'Maman');
  assert.equal(lastPushTo('leo').body, 'pense à toi 💗');
  assert.equal(lastPushTo('leo').badge, 2);

  // No sign until both have thought of each other three times this week.
  pastThoughts(maman.me.id, leo.me.id, 2);
  pastThoughts(leo.me.id, maman.me.id, 2);
  let view = (await call('GET', '/api/me', { token: leo.token })).json;
  assert.equal(view.people[0].sign, null);
  assert.equal((await call('POST', '/api/mots', { token: leo.token, body: { to: maman.me.id, word: 'courage !' } })).status, 409);
  view = (await call('POST', '/api/pings', { token: leo.token, body: { to: maman.me.id } })).json;
  assert.equal(view.people[0].sign.sent, false, 'a sign appears on the third thought each way');
  assert.deepEqual(view.words.length, 6);

  // A mot doux: one of the six words, once per sign.
  assert.equal((await call('POST', '/api/mots', { token: leo.token, body: { to: maman.me.id, word: 'je t’aime à la folie' } })).status, 400);
  view = (await call('POST', '/api/mots', { token: leo.token, body: { to: maman.me.id, word: 'courage !' } })).json;
  assert.equal(view.people[0].sign.sent, true);
  assert.equal(lastPushTo('maman').title, 'Léo');
  assert.equal(lastPushTo('maman').body, 'pense à toi · courage !');
  assert.equal((await call('POST', '/api/mots', { token: leo.token, body: { to: maman.me.id, word: 'douce nuit' } })).status, 409);

  // Maman sees it as a word from Léo, and it counts as one more thought; she can still send hers.
  const hers = (await call('GET', '/api/me', { token: maman.token })).json.people[0];
  assert.deepEqual(hers.mots.map((m) => m.word), ['courage !']);
  assert.equal(hers.pingsFromThem.length, 4);
  assert.equal(hers.sign.sent, false);
  assert.equal((await call('POST', '/api/mots', { token: maman.token, body: { to: leo.me.id, word: 'belle journée' } })).status, 200);
});

test('a sign fades when the thoughts stop, and comes back as a new one', async () => {
  const a = await signup('Alix');
  const b = await signup('Basile', { invite: a.me.code });
  pastThoughts(a.me.id, b.me.id, 3, 6 * 86400000);
  pastThoughts(b.me.id, a.me.id, 3, 6 * 86400000);
  const first = (await call('GET', '/api/me', { token: a.token })).json.people[0].sign;
  assert.ok(first);
  await call('POST', '/api/mots', { token: a.token, body: { to: b.me.id, word: 'tu me manques' } });

  // A week later, those thoughts are too old: the sign is gone.
  for (const p of app.store.data.pings) if ([a.me.id, b.me.id].includes(p.from)) p.at -= 2 * 86400000;
  assert.equal((await call('GET', '/api/me', { token: a.token })).json.people[0].sign, null);

  // Thinking of each other again brings a new sign, and a new mot doux.
  pastThoughts(a.me.id, b.me.id, 3);
  pastThoughts(b.me.id, a.me.id, 3);
  const again = (await call('GET', '/api/me', { token: a.token })).json.people[0].sign;
  assert.equal(again.sent, false);
  assert.ok(again.since > first.since);
});

test('six places per map, and letting someone go quietly', async () => {
  const host = await signup('Hôte');
  const guests = [];
  for (let i = 0; i < 6; i++) guests.push(await signup(`Invité ${i}`, { invite: host.me.code }));
  let mine = (await call('GET', '/api/me', { token: host.token })).json;
  assert.deepEqual(mine.people.map((p) => p.place), [0, 1, 2, 3, 4, 5]);

  // The map is full.
  const late = await signup('En retard');
  assert.equal((await call('POST', '/api/connect', { token: late.token, body: { code: host.me.code } })).status, 409);

  // Letting the third guest go tells nobody, and frees their place for the next one.
  const before = sent.length;
  mine = (await call('POST', '/api/unlink', { token: host.token, body: { id: guests[2].me.id } })).json;
  assert.equal(sent.length, before);
  assert.deepEqual(mine.people.map((p) => p.place), [0, 1, 3, 4, 5]);
  const gone = (await call('GET', '/api/me', { token: guests[2].token })).json;
  assert.equal(gone.people.length, 0, 'their account remains, without the link');
  assert.equal((await call('POST', '/api/pings', { token: guests[2].token, body: { to: host.me.id } })).status, 404);

  mine = (await call('POST', '/api/connect', { token: late.token, body: { code: host.me.code } })).json;
  const host2 = (await call('GET', '/api/me', { token: host.token })).json;
  assert.equal(host2.people.find((p) => p.name === 'En retard').place, 2);
  assert.equal(host2.people.find((p) => p.name === 'Invité 3').place, 3, 'everyone else keeps their place');
});

test('guards: auth, strangers, bad codes, dead subscriptions', async () => {
  assert.equal((await call('GET', '/api/me')).status, 401);
  const a = await signup('Solo');
  const stranger = (await call('POST', '/api/users', { body: { name: 'Inconnu' } })).json;
  assert.equal((await call('POST', '/api/pings', { token: a.token, body: { to: stranger.me.id } })).status, 404);
  assert.equal((await call('POST', '/api/unlink', { token: a.token, body: { id: stranger.me.id } })).status, 404);
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
