// Pense à toi — a little lake. The people you love live on the far shore.
// Touch their home to send a lantern; slide the sky to travel in time;
// hold your dock to light a candle ("I'm free then"). Two candles make a star.

import { W, H, PHASES, PLACES, DOCK, LAKE_CENTER, CLOUDS, backSVG, frontSVG, cloudSVG, placeSVG, plotSVG, glowSprite } from './scene.js';
import { createLife } from './life.js';

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const NS = 'http://www.w3.org/2000/svg';

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const params = new URLSearchParams(location.search);
let invite = (params.get('invite') || '').toUpperCase() || null;
let travelTo = params.get('t');

const HOURS_PER_SCREEN = 10;
const MAX_OFFSET = 7 * 24 - 1;
const LANTERN_TINTS = ['#FFD36E', '#FFB98A', '#FFC2D4', '#D8C8FF'];

const state = {
  token: load('token'),
  data: null,
  inviter: null,
  offset: 0, // hours travelled into the future
  phase: null,
  slot: undefined,
  arriving: new Set(), // ping timestamps currently flying in
  known: null, // ping timestamps already shown
  config: null,
};
let life = null;

function load(k) {
  try { return localStorage.getItem(`pat:${k}`); } catch { return null; }
}
function save(k, v) {
  try { v == null ? localStorage.removeItem(`pat:${k}`) : localStorage.setItem(`pat:${k}`, v); } catch { /* private mode */ }
}

// ---------- API ----------

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) {
    save('token', null);
    state.token = null;
    state.data = null;
    showWelcome();
  }
  if (!res.ok) throw new Error(json.error || 'Oups, petit souci');
  return json;
}

// What the world shows: your data, or a preview before you have an account.
function world() {
  if (state.data) return state.data;
  return { me: { candles: [] }, people: state.inviter ? [{ ...state.inviter, pingsFromThem: [], pingsFromMe: [], candles: [] }] : [], moments: [] };
}

// ---------- Time ----------

const BANDS = [
  { key: 'matin', word: 'matin', from: 6, to: 12, start: 9 },
  { key: 'midi', word: 'midi', from: 12, to: 14.25, start: 12 },
  { key: 'aprem', word: 'après-midi', from: 14.25, to: 18.5, start: 14.5 },
  { key: 'soir', word: 'soir', from: 18.5, to: 23, start: 19 },
];
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hourOf = (d) => d.getHours() + d.getMinutes() / 60;
const viewTime = () => new Date(Date.now() + state.offset * 3600000);

function slotAt(d) {
  const h = hourOf(d);
  const band = BANDS.find((b) => h >= b.from && h < b.to);
  return band ? `${dateKey(d)}:${band.key}` : null;
}

function slotStart(slot) {
  const [date, key] = slot.split(':');
  const [y, m, d] = date.split('-').map(Number);
  const band = BANDS.find((b) => b.key === key);
  return new Date(y, m - 1, d, Math.floor(band.start), (band.start % 1) * 60);
}

function dayWord(d) {
  const n = Math.round((new Date(d).setHours(12, 0, 0, 0) - new Date().setHours(12, 0, 0, 0)) / 86400000);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long' });
}

function slotWords(slot) {
  const d = slotStart(slot);
  const band = BANDS.find((b) => b.key === slot.split(':')[1]);
  const day = dayWord(d);
  if (day === "aujourd'hui") return `${band.key === 'aprem' ? 'cet' : 'ce'} ${band.word}`;
  return `${day} ${band.word}`;
}

function timeWords(d) {
  const slot = slotAt(d);
  if (slot) return slotWords(slot);
  const h = hourOf(d);
  const night = new Date(d);
  if (h < 6) night.setDate(night.getDate() - 1);
  const day = dayWord(night);
  return day === "aujourd'hui" ? 'cette nuit' : `${day}, la nuit`;
}

// Phase blend across the day.
const KEYS = [[0, 'night'], [5, 'night'], [7, 'morning'], [10.5, 'day'], [16.5, 'day'], [19, 'dusk'], [21.5, 'night'], [24, 'night']];
function blendAt(h) {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [a, from] = KEYS[i];
    const [b, to] = KEYS[i + 1];
    if (h >= a && h < b) return { from, to, k: (h - a) / (b - a) };
  }
  return { from: 'night', to: 'night', k: 0 };
}

// ---------- World ----------

const layerUrls = {};
function layerUrl(kind, phase, i) {
  const key = `${kind}-${phase}-${i ?? ''}`;
  if (!layerUrls[key]) {
    const c = PHASES[phase];
    const svg = kind === 'back' ? backSVG(c) : kind === 'front' ? frontSVG(c) : cloudSVG(c, i);
    layerUrls[key] = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  }
  return layerUrls[key];
}

function buildWorld() {
  const phases = Object.keys(PHASES);
  const svgOpen = (cls) => `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">`;
  app.innerHTML = `
    <div class="world">
      <div class="layers">${phases.map((p) => `<img alt="" data-back="${p}" src="${layerUrl('back', p)}">`).join('')}</div>
      ${svgOpen('bodies')}<g id="moon"></g><g id="sun"></g>
        <g id="clouds">${CLOUDS.map(({ box: [x, y, w, h] }, i) => `<image class="drift" style="animation-delay:-${i * 17}s" x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('')}</g></svg>
      <div class="layers">${phases.map((p) => `<img alt="" data-front="${p}" src="${layerUrl('front', p)}">`).join('')}</div>
      ${svgOpen('overlay')}
        <g id="o-reflect"></g><g id="o-back"></g><g id="o-static"></g><g id="o-water"></g><g id="o-front"></g><g id="o-fx"></g>
        <g id="o-cloud" opacity="0"><path d="M112 116a26 26 0 0 1 38-22 34 34 0 0 1 62 0 30 30 0 0 1 54 12 22 22 0 0 1 12 36H118a22 22 0 0 1-6-26z" fill="#FFF8F1" opacity=".92"/><text x="${W / 2}" y="129" text-anchor="middle"></text></g>
      </svg>
      <div class="hint"></div>
      <div class="top"></div>
    </div>
    <div class="card-root"></div>`;
  state.phase = null;
  state.slot = undefined;
  life?.stop();
  life = createLife({
    back: $('#o-back', app),
    water: $('#o-water', app),
    front: $('#o-front', app),
    ripple: (x, y, size) => ripples(x, y, size),
    say: (x, y, text) => label(x, y, text),
  });
  bindGestures($('.overlay', app));
  applyTime();
  life.start();
}

function applyTime() {
  const overlay = $('.overlay', app);
  if (!overlay) return;
  const t = viewTime();
  const h = hourOf(t);
  const { from, to, k } = blendAt(h);
  for (const kind of ['back', 'front']) {
    app.querySelectorAll(`[data-${kind}]`).forEach((img) => {
      const p = img.dataset[kind];
      const on = p === from ? 1 : p === to ? k : 0;
      img.style.opacity = on;
      img.style.zIndex = p === to ? 2 : p === from ? 1 : 0;
    });
  }
  const dominant = k < 0.5 ? from : to;
  const c = PHASES[dominant];

  // Sun by day, moon by night, sliding along an arc behind the hills.
  const sunT = (h - 6) / 15;
  const moonT = ((h - 19.5 + 24) % 24) / 11;
  const arc = (u, top) => ({ x: 20 + 350 * u, y: 480 - top * Math.sin(Math.PI * Math.min(1, Math.max(0, u))) });
  const sun = arc(sunT, 340);
  const moon = arc(moonT, 300);
  const edge = (u) => Math.max(0, Math.min(1, u * 10, (1 - u) * 10));
  const sunVis = edge(sunT);
  const moonVis = edge(moonT) * (1 - 0.6 * sunVis);
  const sunUp = sunVis > 0;
  const moonUp = moonVis > 0;
  const sunG = $('#sun', app);
  const moonG = $('#moon', app);
  if (dominant !== state.phase) {
    sunG.innerHTML = `<image href="${glowSprite(c.sunHalo, 200)}" x="-120" y="-120" width="240" height="240"/><circle r="44" fill="${c.sun}"/>`;
    moonG.innerHTML = `<image href="${glowSprite('#C9B8F0', 160)}" x="-90" y="-90" width="180" height="180" opacity=".8"/><circle r="28" fill="#FFF4D6"/><circle cx="9" cy="-6" r="24" fill="#5B4F8E" opacity=".18"/>`;
  }
  sunG.setAttribute('transform', `translate(${sun.x} ${sun.y})`);
  sunG.style.opacity = sunVis;
  moonG.setAttribute('transform', `translate(${moon.x} ${moon.y})`);
  moonG.style.opacity = moonVis;

  // Its reflection on the lake when low on the horizon.
  const body = sunUp ? sun : moon;
  const low = Math.max(0, 1 - (480 - body.y) / 160);
  $('#o-reflect', app).innerHTML = (sunUp || moonUp) && low > 0.05
    ? `<g stroke="${sunUp ? c.sun : '#FFF4D6'}" stroke-width="4" fill="none" opacity="${0.75 * low}">
         <ellipse cx="${body.x}" cy="512" rx="58" ry="5"/><ellipse cx="${body.x}" cy="526" rx="34" ry="3"/><ellipse cx="${body.x}" cy="538" rx="16" ry="2"/></g>`
    : '';

  // The day written in a cloud while you travel.
  const cloud = $('#o-cloud', app);
  cloud.style.opacity = state.offset > 0.3 ? 1 : 0;
  $('text', cloud).textContent = timeWords(t);

  const slot = slotAt(t);
  if (dominant !== state.phase) {
    app.querySelectorAll('#clouds image').forEach((img, i) => img.setAttribute('href', layerUrl('cloud', dominant, i)));
    life.setPhase(dominant);
  }
  if (dominant !== state.phase || slot !== state.slot) {
    state.phase = dominant;
    state.slot = slot;
    drawStatic();
  }
}

// Places, lights, candles, stars and lanterns.
function drawStatic() {
  const g = $('#o-static', app);
  if (!g) return;
  const c = PHASES[state.phase || 'day'];
  const { me, people, moments } = world();
  const slot = state.slot;
  const traveling = state.offset > 0.3;
  let out = '';

  // Homes of the people you love. Their window glows warmer the more they thought of you.
  people.slice(0, PLACES.length).forEach((p, i) => {
    const place = PLACES[i];
    const warmth = Math.min(1, (p.pingsFromThem || []).reduce((s, t) => s + 0.5 ** ((Date.now() - t) / (8 * 3600000)), 0) / 2);
    const glow = Math.min(1, c.lit * 0.5 + warmth * 0.8);
    const [wx, wy] = place.window;
    out += `<image class="window-glow" data-glow="${i}" href="${glowSprite(c.light, 120)}" x="${wx - 34}" y="${wy - 34}" width="68" height="68" opacity="${glow}"/>`;
    if (place.chimney && warmth > 0.1) {
      const [cx, cy] = place.chimney;
      out += `<g class="smoke" opacity="${0.5 + warmth / 2}">${[0, 1, 2].map((k) => `<circle cx="${cx}" cy="${cy}" r="3.4" fill="${c.cloud}" style="animation-delay:${k * 1.3}s"/>`).join('')}</g>`;
    }
    if (place.type === 'phare' && (state.phase === 'dusk' || state.phase === 'night')) {
      out += `<g transform="translate(${wx} ${wy})"><path class="beam" d="M0 0 L150 -15 L150 15Z" fill="${c.light}" opacity=".2"/></g>`;
    }
    out += placeSVG(place, c);
    out += `<rect data-place="${i}" x="${place.x - 30}" y="${place.y - 78}" width="60" height="88" fill-opacity="0" pointer-events="all"/>`;
  });
  if (people.length < PLACES.length && state.data) {
    const place = PLACES[people.length];
    out += plotSVG(place, c);
    out += `<rect data-plot x="${place.x - 26}" y="${place.y - 48}" width="52" height="56" fill-opacity="0" pointer-events="all"/>`;
  }

  // Candles at the moment you are looking at.
  if (slot) {
    if (me.candles.includes(slot)) out += candleSVG(DOCK.x, DOCK.y - 2, 1, 'mine');
    people.slice(0, PLACES.length).forEach((p, i) => {
      if ((p.candles || []).includes(slot)) out += candleSVG(PLACES[i].x + 18, PLACES[i].y + 2, 0.6);
    });
  }

  // Stars: moments together. The one you are looking at shines big above the lake;
  // upcoming ones wait small above their home, touch them to travel there.
  for (const m of moments) {
    const i = people.findIndex((p) => p.id === m.with?.id);
    if (i < 0 || i >= PLACES.length) continue;
    if (m.slot === slot) {
      out += starSVG((DOCK.x + PLACES[i].x) / 2, 370, 1.4, m.slot);
    } else if (!traveling && slotStart(m.slot) > Date.now() - 3 * 3600000) {
      out += starSVG(PLACES[i].x, PLACES[i].y - 112, 0.7, m.slot);
    }
  }

  // Lanterns: thoughts received in the last day, floating in your sky.
  if (!traveling) {
    people.forEach((p, i) => {
      (p.pingsFromThem || []).filter((t) => Date.now() - t < 86400000 && !state.arriving.has(t)).slice(-6).forEach((t) => {
        const { x, y } = lanternSpot(t);
        out += lanternSVG(x, y, LANTERN_TINTS[i % LANTERN_TINTS.length], p.id, t);
      });
    });
  }
  g.innerHTML = out;
  updateHint();
}

function lanternSpot(t) {
  const r1 = Math.abs(Math.sin(t * 12.9898) * 43758.5453) % 1;
  const r2 = Math.abs(Math.sin(t * 78.233) * 12345.678) % 1;
  return { x: 40 + r1 * 310, y: 170 + r2 * 220 };
}

function lanternSVG(x, y, tint, pid, t, scale = 1) {
  return `<g class="lantern" data-lantern="${pid}" data-x="${x}" data-y="${y}" transform="translate(${x} ${y}) scale(${scale})">
    <g class="bob" style="animation-delay:-${(t % 4000) / 1000}s">
      <image href="${glowSprite(tint, 120)}" x="-28" y="-28" width="56" height="56"/>
      <ellipse rx="7" ry="9" fill="${tint}"/>
      <rect x="-4" y="-11" width="8" height="3" rx="1.5" fill="#355A6E" opacity=".55"/>
      <circle r="22" fill-opacity="0" pointer-events="all"/>
    </g></g>`;
}

function candleSVG(x, y, s = 1, cls = '') {
  return `<g class="candle ${cls}" transform="translate(${x} ${y}) scale(${s})">
    <image href="${glowSprite('#FFD36E', 120)}" x="-30" y="-44" width="60" height="60" opacity=".9"/>
    <rect x="-4" y="-14" width="8" height="14" rx="2.5" fill="#FFF6EA"/>
    <path class="flame" d="M0 -26c3 4 4 6 4 8a4 4 0 0 1-8 0c0-2 1-4 4-8z" fill="#FFB547"/></g>`;
}

function starSVG(x, y, s, slot) {
  return `<g class="star" data-star="${slot}" transform="translate(${x} ${y}) scale(${s})">
    <image href="${glowSprite('#FFF1B8', 140)}" x="-40" y="-40" width="80" height="80"/>
    <path d="M0 -14 C2 -4 4 -2 14 0 C4 2 2 4 0 14 C-2 4 -4 2 -14 0 C-4 -2 -2 -4 0 -14Z" fill="#FFF8DA"/>
    <circle r="24" fill-opacity="0" pointer-events="all"/></g>`;
}

// ---------- Little animations ----------

const fx = () => $('#o-fx', app);
function el(markup) {
  const g = document.createElementNS(NS, 'g');
  g.innerHTML = markup;
  fx().appendChild(g);
  return g;
}
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

function animate(duration, step) {
  return new Promise((done) => {
    const t0 = performance.now();
    const frame = (now) => {
      const u = Math.min(1, (now - t0) / duration);
      step(u);
      if (u < 1) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  });
}

function label(x, y, text) {
  const w = text.length * 7.6 + 26;
  const g = el(`<g class="label" transform="translate(${x} ${y})"><rect x="${-w / 2}" y="-15" width="${w}" height="28" rx="14" fill="#FFF8F1" opacity=".94"/><text y="4" text-anchor="middle">${esc(text)}</text></g>`);
  setTimeout(() => g.remove(), 2200);
}

function ripples(x, y, size = 1) {
  const k = size * Math.max(0.4, (y - 488) / 72);
  for (let i = 0; i < 3; i++) {
    const g = el(`<ellipse cx="${x}" cy="${y}" rx="8" ry="2" fill="none" stroke="#E9F7FB" stroke-width="${Math.max(1.2, 2.5 * Math.min(1, k))}"/>`);
    const e = g.firstChild;
    setTimeout(() => animate(1500, (u) => {
      e.setAttribute('rx', (8 + u * 110) * k);
      e.setAttribute('ry', (2 + u * 24) * k);
      e.setAttribute('opacity', 1 - u);
    }).then(() => g.remove()), i * 220);
  }
}

// A lantern flying along an arc, getting smaller as it goes far.
function flyLantern(from, to, tint, s0, s1, duration = 1500) {
  const g = el(lanternSVG(from.x, from.y, tint, '', 0, s0));
  const lantern = g.firstElementChild;
  const ctrl = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 140 };
  return animate(duration, (u) => {
    const v = ease(u);
    const x = (1 - v) ** 2 * from.x + 2 * (1 - v) * v * ctrl.x + v ** 2 * to.x;
    const y = (1 - v) ** 2 * from.y + 2 * (1 - v) * v * ctrl.y + v ** 2 * to.y;
    lantern.setAttribute('transform', `translate(${x} ${y}) scale(${s0 + (s1 - s0) * v})`);
  }).then(() => g.remove());
}

function flash(i) {
  const glow = $(`[data-glow="${i}"]`, app);
  if (!glow) return;
  const base = Number(glow.getAttribute('opacity'));
  const [x, y] = [Number(glow.getAttribute('x')), Number(glow.getAttribute('y'))];
  animate(1200, (u) => {
    const k = Math.sin(Math.PI * u);
    glow.setAttribute('opacity', Math.min(1, base + k));
    glow.setAttribute('width', 68 + 50 * k);
    glow.setAttribute('height', 68 + 50 * k);
    glow.setAttribute('x', x - 25 * k);
    glow.setAttribute('y', y - 25 * k);
  });
}

async function sendThought(i) {
  const p = world().people[i];
  if (!p || !state.data) return;
  const place = PLACES[i];
  label(place.x, place.y - 96, p.name);
  save('pinged', '1');
  api('/api/pings', { method: 'POST', body: { to: p.id } }).catch(() => {});
  ripples(DOCK.x, DOCK.y + 10);
  const [wx, wy] = place.window;
  await flyLantern({ x: DOCK.x, y: DOCK.y - 20 }, { x: wx, y: wy }, '#FFD36E', 1.1, 0.35);
  flash(i);
  ripples((DOCK.x + place.x) / 2, LAKE_CENTER.y - 30);
  p.pingsFromMe.push(Date.now());
  updateHint();
}

// Thoughts that arrived while you were away rise from their home into your sky.
async function receiveNew() {
  if (!state.data) return;
  const fresh = [];
  state.data.people.forEach((p, i) => {
    for (const t of p.pingsFromThem) if (!state.known.has(t)) fresh.push({ t, i });
  });
  fresh.forEach(({ t }) => { state.known.add(t); state.arriving.add(t); });
  if (!fresh.length) return;
  drawStatic();
  for (const { t, i } of fresh.slice(-6)) {
    if (i >= PLACES.length) { state.arriving.delete(t); continue; }
    const [wx, wy] = PLACES[i].window;
    flash(i);
    await new Promise((r) => setTimeout(r, 250));
    const spot = lanternSpot(t);
    const done = flyLantern({ x: wx, y: wy }, spot, LANTERN_TINTS[i % LANTERN_TINTS.length], 0.35, 1, 1700)
      .then(() => { state.arriving.delete(t); drawStatic(); });
    await new Promise((r) => setTimeout(r, 450));
    if (fresh.length === 1) await done;
  }
}

async function toggleCandle() {
  if (!state.data) return;
  const slot = state.slot;
  if (!slot) {
    label(DOCK.x, DOCK.y - 50, 'la nuit, on dort');
    return;
  }
  const mine = new Set(state.data.me.candles);
  const lighting = !mine.has(slot);
  if (lighting) mine.add(slot); else mine.delete(slot);
  state.data.me.candles = [...mine].sort();
  save('candled', '1');
  drawStatic();
  if (!lighting) {
    const puff = el(`<circle cx="${DOCK.x}" cy="${DOCK.y - 26}" r="4" fill="#FFF8F1" opacity=".8"/>`);
    animate(900, (u) => {
      puff.firstChild.setAttribute('cy', DOCK.y - 26 - 30 * u);
      puff.firstChild.setAttribute('r', 4 + 8 * u);
      puff.firstChild.setAttribute('opacity', 0.8 * (1 - u));
    }).then(() => puff.remove());
  } else {
    label(DOCK.x, DOCK.y - 56, `libre ${slotWords(slot)}`);
  }
  const before = new Set(state.data.moments.map((m) => m.id));
  try {
    const data = await api('/api/candles', { method: 'PUT', body: { slots: state.data.me.candles } });
    setData(data);
    const born = data.moments.find((m) => !before.has(m.id));
    if (born) {
      const who = born.with?.name;
      ripples(LAKE_CENTER.x, LAKE_CENTER.y);
      setTimeout(() => label(LAKE_CENTER.x, 330, `✨ avec ${who}`), 300);
    }
    drawStatic();
  } catch {
    /* the world stays as you left it; it will sync on the next refresh */
  }
}

// ---------- Time travel ----------

let returnTimer;
let glide;
function setOffset(o) {
  state.offset = Math.max(0, Math.min(MAX_OFFSET, o));
  applyTime();
}

function glideTo(target, duration = 1200) {
  cancelAnimationFrame(glide);
  const start = state.offset;
  const t0 = performance.now();
  const frame = (now) => {
    const u = Math.min(1, (now - t0) / duration);
    setOffset(start + (target - start) * ease(u));
    if (u < 1) glide = requestAnimationFrame(frame);
  };
  glide = requestAnimationFrame(frame);
}

function scheduleReturn() {
  clearTimeout(returnTimer);
  if (state.offset > 0) returnTimer = setTimeout(() => glideTo(0, 1600), 9000);
}

// Settle on the middle of the nearest part of the day.
function snap() {
  const t = viewTime();
  const h = hourOf(t);
  const band = BANDS.find((b) => h >= b.from - 0.75 && h < b.to + 0.75);
  if (state.offset < 0.4) return glideTo(0, 500);
  if (!band) return undefined;
  const mid = (Math.max(band.from, band.start) + band.to) / 2;
  const target = state.offset + (mid - h);
  return glideTo(target > 0.4 ? target : 0, 500);
}

function travelToSlot(slot) {
  const d = slotStart(slot);
  const band = BANDS.find((b) => b.key === slot.split(':')[1]);
  d.setHours(0, 0, 0, 0);
  const mid = new Date(d.getTime() + ((Math.max(band.from, band.start) + band.to) / 2) * 3600000);
  glideTo((mid - Date.now()) / 3600000, 1600);
  scheduleReturn();
}

function bindGestures(svg) {
  let g = null;
  let press;
  const toView = (e) => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: pt.x, y: pt.y };
  };
  svg.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(glide);
    clearTimeout(returnTimer);
    const v = toView(e);
    g = {
      x: e.clientX, y: e.clientY, start: state.offset, moved: false, held: false,
      target: e.target.closest('[data-place],[data-plot],[data-lantern],[data-star],[data-duck],[data-frog]'),
      v,
      last: [{ x: e.clientX, t: performance.now() }],
    };
    svg.setPointerCapture(e.pointerId);
    if (v.y > 560 && state.data && !g.target) {
      press = setTimeout(() => { if (g && !g.moved) { g.held = true; toggleCandle(); } }, 450);
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      g.moved = true;
      clearTimeout(press);
    }
    if (!g.moved) {
      if (Math.abs(dy) > 12) clearTimeout(press);
      return;
    }
    setOffset(g.start - (dx / svg.clientWidth) * HOURS_PER_SCREEN);
    g.last.push({ x: e.clientX, t: performance.now() });
    if (g.last.length > 5) g.last.shift();
  });
  const end = (e) => {
    clearTimeout(press);
    if (!g) return;
    const gesture = g;
    g = null;
    if (gesture.held) return;
    if (gesture.moved) {
      save('travelled', '1');
      const [a, b] = [gesture.last[0], gesture.last[gesture.last.length - 1]];
      let v = b.t > a.t ? -((b.x - a.x) / svg.clientWidth) * HOURS_PER_SCREEN / (b.t - a.t) : 0; // hours per ms
      let prev = performance.now();
      const coast = (now) => {
        const dt = now - prev;
        prev = now;
        v *= 0.94 ** (dt / 16);
        setOffset(state.offset + v * dt);
        if (Math.abs(v) > 0.0004 && state.offset > 0 && state.offset < MAX_OFFSET) glide = requestAnimationFrame(coast);
        else { snap(); scheduleReturn(); }
      };
      glide = requestAnimationFrame(coast);
      updateHint();
      return;
    }
    if (e.type === 'pointercancel') return;
    scheduleReturn();
    const t = gesture.target;
    if (!t) {
      // Touching the water makes rings.
      const { x, y } = gesture.v;
      if (y > 500 && y < 640) ripples(x, y, 0.6);
      return;
    }
    if (life.poke(t)) return;
    if (t.dataset.place !== undefined) sendThought(Number(t.dataset.place));
    else if (t.dataset.plot !== undefined) inviteCard();
    else if (t.dataset.star) travelToSlot(t.dataset.star);
    else if (t.dataset.lantern) {
      const p = world().people.find((x) => x.id === t.dataset.lantern);
      if (p) label(Number(t.dataset.x), Number(t.dataset.y) - 30, p.name);
    }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

// ---------- The only words: a hint, until you've done it once ----------

function updateHint() {
  const hint = $('.hint', app);
  if (!hint) return;
  const { people } = world();
  let text = '';
  if (!state.data) text = '';
  else if (!people.length) text = 'Touche le petit panneau pour inviter quelqu’un';
  else if (!load('pinged')) text = `Touche ${PLACES[0].the} de ${people[0].name} pour lui envoyer une pensée`;
  else if (!load('travelled')) text = 'Fais glisser le ciel pour avancer dans le temps';
  else if (!load('candled')) text = state.offset > 0.3 ? 'Appui long sur ton ponton : une bougie, tu es libre' : '';
  hint.textContent = text;
  hint.classList.toggle('on', Boolean(text));
  const top = $('.top', app);
  top.innerHTML = state.data && pushSupported && Notification.permission === 'default'
    ? '<button class="pill small" data-act="enable-push">Activer les notifications</button>' : '';
}

// ---------- Cards (the few moments that need words) ----------

function openCard(html, { closable = true } = {}) {
  const root = $('.card-root', app);
  root.innerHTML = `<div class="card-wrap ${closable ? 'closable' : ''}"><div class="card">${html}</div></div>`;
  const wrap = $('.card-wrap', root);
  if (closable) wrap.addEventListener('click', (e) => { if (e.target === wrap) closeCard(); });
  return $('.card', root);
}
function closeCard() {
  const wrap = $('.card-wrap', app);
  if (!wrap) return;
  wrap.classList.add('out');
  setTimeout(() => wrap.remove(), 250);
}

const SHARE_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/></svg>';
const ADD_ICON = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

function showWelcome() {
  buildWorld();
  const who = state.inviter;
  if (isIOS && !isStandalone) {
    openCard(`
      <h1>${who ? `${esc(who.name)} pense à toi` : 'Pense à toi'}</h1>
      <p class="lead">Installe l'app sur ton iPhone, ça prend vingt secondes.</p>
      <ol class="steps">
        <li>Touche ${SHARE_ICON} <b>Partager</b> <span class="tiny">(parfois sous ⋯)</span></li>
        <li>Choisis ${ADD_ICON} <b>Sur l'écran d'accueil</b></li>
        <li>Ouvre <b>Pense à toi</b> depuis ton écran d'accueil</li>
      </ol>
      <p class="tiny">Dans WhatsApp ou Messenger ? Ouvre d'abord ce lien dans Safari.</p>
      ${invite ? `<p class="tiny">Déjà installée ? Entre ce code : <b class="code">${esc(invite)}</b></p>` : ''}`, { closable: false });
    return;
  }
  const card = openCard(`
    <form data-signup>
      <h1>${who ? `${esc(who.name)} t'attend de l'autre côté du lac` : 'Bienvenue au bord du lac'}</h1>
      <p class="lead">Comment tu t'appelles ?</p>
      <input class="field" name="name" autocomplete="given-name" maxlength="24" placeholder="ton prénom" required>
      <button class="pill wide" type="submit">C'est moi</button>
    </form>`, { closable: false });
  $('form', card).addEventListener('submit', signup);
}

async function signup(e) {
  e.preventDefault();
  const form = e.target;
  const submit = $('[type=submit]', form);
  submit.disabled = true;
  try {
    const res = await api('/api/users', {
      method: 'POST',
      body: { name: form.name.value, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, invite },
    });
    state.token = res.token;
    save('token', res.token);
    delete res.token;
    setData(res);
    state.known = new Set(res.people.flatMap((p) => p.pingsFromThem));
    invite = null;
    cleanUrl();
    closeCard();
    drawStatic();
    if (pushSupported && Notification.permission === 'default') {
      setTimeout(() => {
        const card = openCard(`
          <h1>Voir les lanternes arriver</h1>
          <p class="lead">Active les notifications pour savoir quand quelqu'un pense à toi, même quand l'app dort.</p>
          <button class="pill wide" data-act="enable-push">Activer</button>
          <button class="link" data-act="close">plus tard</button>`, { closable: false });
        card.addEventListener('click', onAct);
      }, 700);
    } else if (pushSupported && Notification.permission === 'granted') {
      syncPush().catch(() => {});
    }
  } catch (err) {
    submit.disabled = false;
    $('.lead', form).textContent = err.message;
  }
}

function inviteCard() {
  const { me } = state.data;
  const card = openCard(`
    <h1>Quelqu'un sur l'autre rive ?</h1>
    <p class="lead">Envoie ce lien à quelqu'un que tu aimes. Sa maison apparaîtra ici.</p>
    <button class="pill wide" data-act="share">Partager le lien</button>
    <p class="tiny">ou donne ton code <b class="code">${esc(me.code)}</b></p>
    <form data-code class="inline">
      <input class="field" name="code" maxlength="6" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="un code reçu ?">
      <button class="pill soft" type="submit">OK</button>
    </form>`);
  card.addEventListener('click', onAct);
  $('form', card).addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = e.target.code.value.trim().toUpperCase();
    if (!value) return;
    try {
      await acceptCode(value);
      closeCard();
    } catch (err) {
      $('.lead', card).textContent = err.message;
    }
  });
}

async function onAct(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  switch (btn.dataset.act) {
    case 'enable-push': await enablePush(); closeCard(); break;
    case 'close': closeCard(); break;
    case 'share': shareInvite(); break;
    default:
  }
}

// ---------- Actions ----------

async function shareInvite() {
  const { me } = state.data;
  const url = `${location.origin}/?invite=${me.code}`;
  const text = `${me.name} pense à toi 💗`;
  if (navigator.share) await navigator.share({ title: 'Pense à toi', text, url }).catch(() => {});
  else await navigator.clipboard?.writeText(`${text}\n${url}`).catch(() => {});
}

async function acceptCode(code) {
  const before = state.data?.people.length || 0;
  setData(await api('/api/connect', { method: 'POST', body: { code } }));
  drawStatic();
  if (state.data.people.length > before) flash(state.data.people.length - 1);
}

function b64ToU8(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const u8ToB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function syncPush(ask = false) {
  if (!pushSupported) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') {
    if (!ask) return 'default';
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return perm;
  }
  const reg = await navigator.serviceWorker.ready;
  state.config ||= await api('/api/config');
  const key = state.config.vapidPublicKey;
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options?.applicationServerKey && u8ToB64(sub.options.applicationServerKey) !== key) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
  await api('/api/push', { method: 'POST', body: { subscription: sub.toJSON() } });
  return 'granted';
}

async function enablePush() {
  try {
    await syncPush(true);
  } catch (err) {
    console.error(err);
  }
  updateHint();
}

function setData(data) {
  state.data = data;
  if (!state.known) state.known = new Set();
}

async function refresh() {
  setData(await api('/api/me'));
  drawStatic();
  receiveNew();
}

// Called whenever the app comes to the foreground.
async function wakeUp() {
  if (!state.token) return;
  const data = await api('/api/me');
  if (!state.known) {
    // First look: everything before your last visit is already in the sky.
    state.known = new Set(data.people.flatMap((p) => p.pingsFromThem.filter((t) => t <= data.me.seenAt)));
  }
  setData(data);
  if (!$('.world', app)) buildWorld();
  else drawStatic();
  receiveNew();
  api('/api/seen', { method: 'POST' }).catch(() => {});
  navigator.clearAppBadge?.()?.catch(() => {});
  if (travelTo) {
    setTimeout(() => travelToSlot(travelTo), 800);
    travelTo = null;
  }
}

function cleanUrl() {
  if (location.search) history.replaceState(null, '', '/');
}

// ---------- Events ----------

app.addEventListener('click', (e) => {
  if (e.target.closest('.top [data-act]')) onAct(e);
});

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'push') refresh().catch(() => {});
  if (e.data?.type === 'open') {
    travelTo = new URL(e.data.url, location.origin).searchParams.get('t');
    wakeUp().catch(() => {});
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    life?.start();
    wakeUp().catch(() => {});
  } else {
    life?.stop();
  }
});
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  applyTime();
  if (state.token && state.offset === 0) refresh().catch(() => {});
}, 30000);

// ---------- Boot ----------

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (state.token) {
    buildWorld();
    try {
      await wakeUp();
    } catch {
      if (state.token) {
        openCard('<h1>Le lac est loin</h1><p class="lead">Pas de connexion pour le moment.</p><button class="pill wide" onclick="location.reload()">Réessayer</button>', { closable: false });
      }
      return;
    }
    if (invite) {
      await acceptCode(invite).catch(() => {});
      invite = null;
    }
    cleanUrl();
    api('/api/me', { method: 'PATCH', body: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }).catch(() => {});
    syncPush().catch(() => {});
    return;
  }
  if (invite) {
    try {
      state.inviter = (await api(`/api/invites/${invite}`)).from;
    } catch {
      invite = null;
    }
  }
  showWelcome();
}

boot();
