// Pense à toi — a little world. The people you love live in the places around you.
// Touch someone's home to send them a thought. When you both keep thinking of each
// other, a sign appears (a star by night, a kite by day): touch it to send a mot doux.
// Those who share their weather bring it along: rain over their home, snow on your map.

import { W, H, PHASES, PLACES, DOCK, LAKE_CENTER, CLOUDS, backSVG, frontSVG, cloudSVG, placeSVG, plotSVG, windowOf, smokeOf, glowSprite } from './scene.js';
import { createLife } from './life.js';
import { demoApi } from './demo.js';

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const NS = 'http://www.w3.org/2000/svg';

// The demo (demo.html) runs entirely in the browser, with pretend close ones.
const DEMO = Boolean(globalThis.PAT_DEMO);
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = DEMO || navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const pushSupported = !DEMO && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const params = new URLSearchParams(location.search);
let invite = (params.get('invite') || '').toUpperCase() || null;

const LANTERN_TINTS = ['#FFD36E', '#FFB98A', '#FFC2D4', '#D8C8FF', '#B9E6C9', '#FFE3A8'];
const GOLD = '#FFC94A';
const MAPS = [
  { key: 'campagne', name: 'Campagne luxuriante', ready: true },
  { key: 'jardin', name: 'Jardin japonais' },
  { key: 'ocean', name: 'Phare et océan' },
  { key: 'montagne', name: 'Montagne enneigée' },
];

const state = {
  token: DEMO ? null : load('token'),
  data: null,
  inviter: null,
  phase: null,
  arriving: new Set(), // timestamps of thoughts currently flying in
  known: null, // timestamps of thoughts already shown
  words: null, // the mot doux picker, when open
  config: null,
};
let life = null;

// The demo keeps nothing between visits.
const memory = new Map();
function load(k) {
  if (DEMO) return memory.get(k) ?? null;
  try { return localStorage.getItem(`pat:${k}`); } catch { return null; }
}
function save(k, v) {
  if (DEMO) { if (v == null) memory.delete(k); else memory.set(k, v); return; }
  try { v == null ? localStorage.removeItem(`pat:${k}`) : localStorage.setItem(`pat:${k}`, v); } catch { /* private mode */ }
}

// ---------- API ----------

async function api(path, { method = 'GET', body } = {}) {
  if (DEMO) return demoApi(path, { method, body });
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
  const people = state.inviter ? [{ ...state.inviter, place: 0, pingsFromThem: [], pingsFromMe: [], mots: [], sign: null }] : [];
  return { me: {}, people, words: [] };
}

// ---------- Time of day ----------

const hourOf = (d) => d.getHours() + d.getMinutes() / 60;
const isNight = () => state.phase === 'dusk' || state.phase === 'night';

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
        <g id="o-reflect"></g><g id="o-back"></g><g id="o-static"></g><g id="o-water"></g><g id="o-front"></g><g id="o-weather"></g><g id="o-fx"></g><g id="o-words"></g>
      </svg>
      <div class="hint"></div>
      <div class="top"></div>
    </div>
    <div class="card-root"></div>`;
  state.phase = null;
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
  if (!$('.overlay', app)) return;
  const h = hourOf(new Date());
  const { from, to, k } = blendAt(h);
  for (const kind of ['back', 'front']) {
    app.querySelectorAll(`[data-${kind}]`).forEach((img) => {
      const p = img.dataset[kind];
      img.style.opacity = p === from ? 1 : p === to ? k : 0;
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

  // Its reflection on the water when low on the horizon.
  const body = sunVis > 0 ? sun : moon;
  const low = Math.max(0, 1 - (480 - body.y) / 160);
  $('#o-reflect', app).innerHTML = (sunVis > 0 || moonVis > 0) && low > 0.05
    ? `<g stroke="${sunVis > 0 ? c.sun : '#FFF4D6'}" stroke-width="4" fill="none" opacity="${0.75 * low}">
         <ellipse cx="${body.x}" cy="512" rx="58" ry="5"/><ellipse cx="${body.x}" cy="526" rx="34" ry="3"/><ellipse cx="${body.x}" cy="538" rx="16" ry="2"/></g>`
    : '';

  if (dominant !== state.phase) {
    state.phase = dominant;
    app.querySelectorAll('#clouds image').forEach((img, i) => img.setAttribute('href', layerUrl('cloud', dominant, i)));
    life.setPhase(dominant);
    drawnWeather = undefined;
    drawStatic();
    drawWeather();
  }
}

const PLACE_OF = (p) => PLACES[p.place] || PLACES[0];

// Homes, lights, signs and lanterns.
function drawStatic() {
  const g = $('#o-static', app);
  if (!g) return;
  const c = PHASES[state.phase || 'day'];
  const { people } = world();
  let out = '';

  // Homes of the people you love. Their window glows warmer the more they thought of you.
  for (const p of people) {
    const place = PLACE_OF(p);
    const s = place.s;
    const warmth = Math.min(1, (p.pingsFromThem || []).reduce((sum, t) => sum + 0.5 ** ((Date.now() - t) / (8 * 3600000)), 0) / 2);
    const glow = Math.min(1, c.lit * 0.5 + warmth * 0.8);
    const [wx, wy] = windowOf(place, c);
    out += `<g class="home" data-home="${p.id}">`;
    out += `<image class="window-glow" data-glow="${p.id}" href="${glowSprite(c.light, 120)}" x="${wx - 34 * s}" y="${wy - 34 * s}" width="${68 * s}" height="${68 * s}" opacity="${glow}"/>`;
    const chimney = smokeOf(place, c);
    if (chimney && warmth > 0.1) {
      const [cx, cy] = chimney;
      out += `<g class="smoke" opacity="${0.5 + warmth / 2}">${[0, 1, 2].map((k) => `<circle cx="${cx}" cy="${cy}" r="${3.4 * s}" fill="${c.cloud}" style="animation-delay:${k * 1.3}s"/>`).join('')}</g>`;
    }
    out += `<ellipse cx="${place.x}" cy="${place.y - s}" rx="${24 * s}" ry="${3.8 * s}" fill="${c.hillShade}" opacity=".65"/>`;
    out += placeSVG(place, c);
    out += `<rect data-place="${p.id}" x="${place.x - 30 * s}" y="${place.y - 82 * s}" width="${60 * s}" height="${92 * s}" fill-opacity="0" pointer-events="all"/></g>`;
    if (p.weather) out += weatherBadge(p, place, c);
  }

  // Signs: a star by night, a kite tied to their roof by day.
  for (const p of people) {
    if (p.sign) out += signSVG(p, c);
  }

  // An empty spot, waiting for someone.
  const taken = new Set(people.map((p) => p.place));
  const free = PLACES.findIndex((_, i) => !taken.has(i));
  if (free >= 0 && state.data) {
    const place = PLACES[free];
    out += `<ellipse cx="${place.x}" cy="${place.y - place.s}" rx="${12 * place.s}" ry="${2.6 * place.s}" fill="${c.hillShade}" opacity=".6"/>`;
    out += plotSVG(place, c);
    out += `<rect data-plot x="${place.x - 26 * place.s}" y="${place.y - 48 * place.s}" width="${52 * place.s}" height="${56 * place.s}" fill-opacity="0" pointer-events="all"/>`;
  }

  // Mots doux received: big golden lanterns above the sender's home.
  people.forEach((p) => {
    const place = PLACE_OF(p);
    (p.mots || []).filter((m) => !state.arriving.has(m.at)).forEach((m, k) => {
      out += lanternSVG(place.x + (k % 2 ? 16 : -16) * place.s, place.y - (112 + k * 16) * place.s, GOLD, p.id, m.at, 1.4, `data-mot="${esc(m.word)}"`);
    });
  });

  // Plain thoughts received in the last day float in your sky.
  people.forEach((p, i) => {
    const words = new Set((p.mots || []).map((m) => m.at));
    (p.pingsFromThem || []).filter((t) => Date.now() - t < 86400000 && !words.has(t) && !state.arriving.has(t)).slice(-6).forEach((t) => {
      const { x, y } = lanternSpot(t);
      out += lanternSVG(x, y, LANTERN_TINTS[i % LANTERN_TINTS.length], p.id, t);
    });
  });
  g.innerHTML = out;
  updateHint();
}

// The sign between you and someone: a star by night, a kite by day.
function kiteAt(place) {
  const side = place.x > W / 2 ? -1 : 1;
  return { x: Math.min(W - 34, Math.max(34, place.x + side * 34 * place.s)), y: place.y - 132 * place.s };
}

function signPoint(p) {
  const place = PLACE_OF(p);
  return isNight() ? { x: place.x, y: place.y - 96 * place.s } : kiteAt(place);
}

function signSVG(p, c) {
  const place = PLACE_OF(p);
  const dim = p.sign.sent ? 0.75 : 1;
  if (isNight()) {
    const { x, y } = signPoint(p);
    return `<g class="star" data-sign="${p.id}" transform="translate(${x} ${y})" opacity="${dim}">
      <image href="${glowSprite('#FFF1B8', 140)}" x="-38" y="-38" width="76" height="76"/>
      <path d="M0 -13 C2 -4 4 -2 13 0 C4 2 2 4 0 13 C-2 4 -4 2 -13 0 C-4 -2 -2 -4 0 -13Z" fill="#FFF8DA"/>
      <circle r="26" fill-opacity="0" pointer-events="all"/></g>`;
  }
  // The string runs from their roof up to the kite, sagging softly in the wind.
  const k = kiteAt(place);
  const roof = { x: place.x, y: place.y - 40 * place.s };
  const sag = { x: (roof.x + k.x) / 2 + (k.x > roof.x ? 10 : -10), y: (roof.y + k.y) / 2 + 18 };
  return `<g class="kite-sign" data-sign="${p.id}" opacity="${dim}">
    <path d="M${roof.x} ${roof.y} Q${sag.x} ${sag.y} ${k.x} ${k.y + 12}" stroke="${c.wall}" stroke-width="1.1" fill="none" opacity=".85" pointer-events="none"/>
    <g transform="translate(${k.x} ${k.y})"><g class="kite">
      <path d="M0 -15 L11 0 L0 15 L-11 0Z" fill="#F7B3C2"/><path d="M0 -15 L11 0 L0 15Z" fill="#FFD3A8"/>
      <path d="M0 -15 V15 M-11 0 H11" stroke="#E58FA6" stroke-width="1" opacity=".8"/>
      <path class="tail" d="M0 15 q-6 8 0 14 q6 6 0 12 q-5 6 1 11" stroke="${c.wall}" stroke-width="1" fill="none"/>
      <path d="M-3 26 l3 3 l3 -3 l-3 -3z M-3 38 l3 3 l3 -3 l-3 -3z" fill="#B8D6FF"/>
      <circle r="24" cy="6" fill-opacity="0" pointer-events="all"/>
    </g></g></g>`;
}

// ---------- Weather ----------

const WEATHER_WORDS = { clear: 'grand beau', cloudy: 'quelques nuages', overcast: 'temps gris', fog: 'brouillard', rain: 'pluie', snow: 'neige', storm: 'orage' };
const SMALL_CLOUD = 'M-13 3a6 6 0 0 1 2-11 8 8 0 0 1 15-3 6.5 6.5 0 0 1 8 9 5 5 0 0 1-2 5z';

// A little weather of their own, above the home of someone who shares it.
function weatherBadge(p, place, c) {
  const { kind } = p.weather;
  if (kind === 'clear' && isNight()) return '';
  const s = place.s;
  const dark = kind === 'storm' ? '#7D7FA6' : kind === 'overcast' || kind === 'rain' ? '#C9CEE3' : c.cloud;
  let inner = '';
  if (kind === 'clear') inner = `<image href="${glowSprite('#FFE6A0', 60)}" x="-14" y="-14" width="28" height="28"/><circle r="5.5" fill="#FFF3C4"/>`;
  else if (kind === 'fog') inner = [0, 1, 2].map((k) => `<path class="wisp" style="animation-delay:-${k * 1.4}s" d="M${-14 + k * 3} ${k * 5 - 4} h${22 - k * 4}" stroke="${c.cloud}" stroke-width="3" stroke-linecap="round" opacity=".85"/>`).join('');
  else {
    inner = `<path d="${SMALL_CLOUD}" fill="${dark}"/>`;
    if (kind === 'rain' || kind === 'storm') inner += [-7, 0, 7].map((x, k) => `<path class="drop" style="animation-delay:-${k * 0.3}s" d="M${x} 6 l-1.5 5" stroke="#8FB8E8" stroke-width="1.6" stroke-linecap="round"/>`).join('');
    if (kind === 'snow') inner += [-7, 0, 7].map((x, k) => `<circle class="flake" style="animation-delay:-${k * 0.7}s" cx="${x}" cy="8" r="1.6" fill="#FFFFFF"/>`).join('');
    if (kind === 'storm') inner += '<path class="bolt" d="M1 4 l-4 7 h4 l-3 7" stroke="#FFE27A" stroke-width="1.8" fill="none" stroke-linejoin="round"/>';
  }
  return `<g class="weather-badge" data-weather="${p.id}" transform="translate(${place.x} ${place.y - 70 * s}) scale(${0.9 * s + 0.2})">
    ${inner}<circle r="16" fill-opacity="0" pointer-events="all"/></g>`;
}

// Your own weather, over your whole map.
let rainTimer;
let drawnWeather = null;
function drawWeather() {
  const g = $('#o-weather', app);
  if (!g) return;
  const kind = state.data?.me.weather?.kind || null;
  if (kind === drawnWeather && g.childElementCount) return;
  drawnWeather = kind;
  clearInterval(rainTimer);
  const r = (i, k) => Math.abs(Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1;
  const veil = (o) => `<rect width="${W}" height="${H}" fill="#4A5878" opacity="${o}"/>`;
  let out = '';
  if (kind === 'rain' || kind === 'storm') {
    out += veil(kind === 'storm' ? 0.24 : 0.14);
    out += Array.from({ length: 70 }, (_, i) => `<path class="rain" style="animation-delay:-${(r(i, 1) * 1.2).toFixed(2)}s;animation-duration:${(0.8 + r(i, 2) * 0.5).toFixed(2)}s" d="M${(r(i, 3) * (W + 60)).toFixed(0)} ${(-20 - r(i, 4) * 200).toFixed(0)} l-3 13" stroke="#E6EEFA" stroke-width="1.2" stroke-linecap="round" opacity=".55"/>`).join('');
    if (kind === 'storm') out += `<rect class="flash" width="${W}" height="${H}" fill="#FFFFFF"/>`;
    // Drops landing on the pond.
    rainTimer = setInterval(() => {
      if (document.visibilityState === 'visible') ripples(20 + Math.random() * 350, 505 + Math.random() * 125, 0.25);
    }, 420);
  } else if (kind === 'snow') {
    out += veil(0.06);
    out += Array.from({ length: 60 }, (_, i) => `<circle class="snow" style="--sway:${(r(i, 5) * 30 - 15).toFixed(0)}px;animation-delay:-${(r(i, 1) * 12).toFixed(1)}s;animation-duration:${(9 + r(i, 2) * 6).toFixed(1)}s" cx="${(r(i, 3) * W).toFixed(0)}" cy="-10" r="${(1.2 + r(i, 4) * 2).toFixed(1)}" fill="#FFFFFF" opacity=".9"/>`).join('');
  } else if (kind === 'cloudy' || kind === 'overcast') {
    out += veil(kind === 'overcast' ? 0.14 : 0.05);
    const n = kind === 'overcast' ? 3 : 2;
    out += Array.from({ length: n }, (_, i) => {
      const { box: [, , w, h] } = CLOUDS[i % CLOUDS.length];
      return `<image class="drift" style="animation-delay:-${i * 11}s" href="${layerUrl('cloud', state.phase || 'day', i % CLOUDS.length)}" x="${-30 + i * 140}" y="${40 + (i % 2) * 90}" width="${w * 1.7}" height="${h * 1.7}" opacity="${kind === 'overcast' ? 0.95 : 0.8}"/>`;
    }).join('');
  } else if (kind === 'fog') {
    out += `<defs><linearGradient id="haze" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#F4F2F8" stop-opacity="0"/><stop offset=".5" stop-color="#F4F2F8" stop-opacity=".75"/><stop offset="1" stop-color="#F4F2F8" stop-opacity="0"/></linearGradient></defs>`;
    out += [[410, 110], [520, 80], [600, 70]].map(([y, h], i) => `<rect class="haze" style="animation-delay:-${i * 9}s" x="-60" y="${y}" width="${W + 120}" height="${h}" fill="url(#haze)"/>`).join('');
  }
  g.innerHTML = out;
}

function lanternSpot(t) {
  const r1 = Math.abs(Math.sin(t * 12.9898) * 43758.5453) % 1;
  const r2 = Math.abs(Math.sin(t * 78.233) * 12345.678) % 1;
  return { x: 40 + r1 * 310, y: 170 + r2 * 210 };
}

function lanternSVG(x, y, tint, pid, t, scale = 1, extra = '') {
  return `<g class="lantern" data-lantern="${pid}" data-x="${x}" data-y="${y}" ${extra} transform="translate(${x} ${y}) scale(${scale})">
    <g class="bob" style="animation-delay:-${(t % 4000) / 1000}s">
      <image href="${glowSprite(tint, 120)}" x="-28" y="-28" width="56" height="56"/>
      <ellipse rx="7" ry="9" fill="${tint}"/>
      <rect x="-4" y="-11" width="8" height="3" rx="1.5" fill="#355A6E" opacity=".55"/>
      <circle r="22" fill-opacity="0" pointer-events="all"/>
    </g></g>`;
}

// ---------- Little animations ----------

const fx = () => $('#o-fx', app);
function el(markup, parent = fx()) {
  const g = document.createElementNS(NS, 'g');
  g.innerHTML = markup;
  parent.appendChild(g);
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

function label(x0, y, text, ms = 2200) {
  const w = text.length * 7.6 + 26;
  const x = Math.min(W - w / 2 - 8, Math.max(w / 2 + 8, x0)); // always fully on screen
  const g = el(`<g class="label" style="animation-duration:${ms}ms" transform="translate(${x} ${y})"><rect x="${-w / 2}" y="-15" width="${w}" height="28" rx="14" fill="#FFF8F1" opacity=".94"/><text y="4" text-anchor="middle">${esc(text)}</text></g>`);
  setTimeout(() => g.remove(), ms);
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

function flash(pid) {
  const glow = $(`[data-glow="${pid}"]`, app);
  if (!glow) return;
  const base = Number(glow.getAttribute('opacity'));
  const [x, y, w] = ['x', 'y', 'width'].map((a) => Number(glow.getAttribute(a)));
  animate(1200, (u) => {
    const k = Math.sin(Math.PI * u);
    glow.setAttribute('opacity', Math.min(1, base + k));
    glow.setAttribute('width', w * (1 + 0.7 * k));
    glow.setAttribute('height', w * (1 + 0.7 * k));
    glow.setAttribute('x', x - w * 0.35 * k);
    glow.setAttribute('y', y - w * 0.35 * k);
  });
}

async function sendThought(pid) {
  const p = world().people.find((x) => x.id === pid);
  if (!p || !state.data) return;
  const place = PLACE_OF(p);
  label(place.x, place.y - 96 * place.s, p.name);
  save('pinged', '1');
  const sending = api('/api/pings', { method: 'POST', body: { to: p.id } }).catch(() => null);
  ripples(DOCK.x, DOCK.y + 10);
  const [wx, wy] = windowOf(place);
  await flyLantern({ x: DOCK.x, y: DOCK.y - 20 }, { x: wx, y: wy }, '#FFD36E', 1.1, 0.35 * place.s + 0.1);
  flash(p.id);
  ripples((DOCK.x + place.x) / 2, LAKE_CENTER.y - 30);
  const data = await sending;
  if (data) {
    const hadSign = Boolean(p.sign);
    setData(data);
    const now = data.people.find((x) => x.id === pid);
    if (!hadSign && now?.sign) {
      // A sign is born: let it appear gently.
      drawStatic();
      const sign = $(`[data-sign="${pid}"]`, app);
      sign?.animate([{ opacity: 0 }, { opacity: sign.getAttribute('opacity') }], { duration: 1800, easing: 'ease-out' });
    }
  }
  updateHint();
}

// Thoughts that arrived while you were away rise from their home.
async function receiveNew() {
  if (!state.data) return;
  const fresh = [];
  state.data.people.forEach((p, i) => {
    const words = new Map((p.mots || []).map((m) => [m.at, m.word]));
    for (const t of p.pingsFromThem) if (!state.known.has(t)) fresh.push({ t, p, i, word: words.get(t) });
  });
  fresh.forEach(({ t }) => { state.known.add(t); state.arriving.add(t); });
  if (!fresh.length) return;
  drawStatic();
  for (const { t, p, i, word } of fresh.slice(-6)) {
    const place = PLACE_OF(p);
    const [wx, wy] = windowOf(place);
    flash(p.id);
    await new Promise((r) => setTimeout(r, 250));
    const to = word ? { x: place.x - 16 * place.s, y: place.y - 112 * place.s } : lanternSpot(t);
    const done = flyLantern({ x: wx, y: wy }, to, word ? GOLD : LANTERN_TINTS[i % LANTERN_TINTS.length], 0.35, word ? 1.4 : 1, 1700)
      .then(() => { state.arriving.delete(t); drawStatic(); });
    await new Promise((r) => setTimeout(r, 450));
    if (fresh.length === 1) await done;
  }
}

// ---------- Mots doux ----------

// Six fireflies around the sign, each carrying a word. Touch one and it flies home.
function openWords(pid) {
  const p = world().people.find((x) => x.id === pid);
  if (!p?.sign) return;
  if (p.sign.sent) {
    const { x, y } = signPoint(p);
    label(x, y - 34, 'ton mot doux est parti');
    return;
  }
  closeWords();
  save('signed', '1');
  updateHint();
  const center = signPoint(p);
  const cx = Math.min(W - 150, Math.max(150, center.x));
  const cy = Math.min(560, Math.max(150, center.y + (isNight() ? 0 : 40)));
  const words = state.data.words || [];
  const markup = words.map((w, k) => {
    const a = (k / words.length) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * 78;
    const y = cy + Math.sin(a) * 72;
    const bw = w.length * 7 + 22;
    return `<g class="word" data-word="${esc(w)}" data-to="${pid}" data-x="${x}" data-y="${y}" transform="translate(${x} ${y})">
      <g class="word-bob" style="animation-delay:-${k * 0.5}s">
        <image href="${glowSprite('#FFE58A', 60)}" x="-14" y="-24" width="28" height="28"/><circle cy="-10" r="2.6" fill="#FFF3B0"/>
        <rect x="${-bw / 2}" y="-2" width="${bw}" height="24" rx="12" fill="#FFF8F1" opacity=".92"/>
        <text y="14" text-anchor="middle">${esc(w)}</text>
        <rect x="${-bw / 2}" y="-26" width="${bw}" height="50" fill-opacity="0" pointer-events="all"/>
      </g></g>`;
  }).join('');
  state.words = el(markup, $('#o-words', app));
  state.words.classList.add('words-in');
}

function closeWords() {
  if (!state.words) return;
  const g = state.words;
  state.words = null;
  g.classList.add('words-out');
  setTimeout(() => g.remove(), 400);
}

async function sendMot(node) {
  const pid = node.dataset.to;
  const word = node.dataset.word;
  const p = world().people.find((x) => x.id === pid);
  if (!p) return;
  const from = { x: Number(node.dataset.x), y: Number(node.dataset.y) };
  node.remove();
  closeWords();
  const place = PLACE_OF(p);
  const [wx, wy] = windowOf(place);
  const sending = api('/api/mots', { method: 'POST', body: { to: pid, word } }).catch((err) => { label(from.x, from.y, err.message); return null; });
  await flyLantern(from, { x: wx, y: wy }, GOLD, 1, 0.4 * place.s + 0.1, 1300);
  flash(pid);
  const data = await sending;
  if (data) {
    setData(data);
    drawStatic();
  }
}

// ---------- Gestures ----------

function bindGestures(svg) {
  let g = null;
  let press;
  const toView = (e) => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: pt.x, y: pt.y };
  };
  const onDock = (v) => Math.abs(v.x - DOCK.x) < 50 && v.y > DOCK.y - 20 && v.y < 745;
  svg.addEventListener('pointerdown', (e) => {
    const v = toView(e);
    g = {
      x: e.clientX, y: e.clientY, v, held: false,
      target: e.target.closest('[data-word],[data-weather],[data-place],[data-plot],[data-mot],[data-lantern],[data-sign],[data-duck],[data-frog],[data-sheep],[data-cat],[data-butterfly]'),
    };
    svg.setPointerCapture(e.pointerId);
    if (!state.data) return;
    const t = g.target;
    // Holding someone's home: let them go. Holding your own dock: choose your map.
    if (t?.dataset.place !== undefined || (!t && onDock(v))) {
      press = setTimeout(() => {
        if (!g) return;
        g.held = true;
        if (t) letGoCard(t.dataset.place);
        else homeCard();
      }, 550);
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (g && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 12) clearTimeout(press);
  });
  const end = (e) => {
    clearTimeout(press);
    if (!g) return;
    const gesture = g;
    g = null;
    if (gesture.held || e.type === 'pointercancel') return;
    if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 12) return;
    const t = gesture.target;
    if (t?.dataset.word) { sendMot(t); return; }
    if (state.words) { closeWords(); return; }
    if (!t) {
      // Touching the water makes rings.
      const { x, y } = gesture.v;
      if (y > 500 && y < 640) ripples(x, y, 0.6);
      return;
    }
    if (life.poke(t)) return;
    if (t.dataset.place !== undefined) sendThought(t.dataset.place);
    else if (t.dataset.plot !== undefined) inviteCard();
    else if (t.dataset.sign) openWords(t.dataset.sign);
    else if (t.dataset.weather) {
      const p = world().people.find((x) => x.id === t.dataset.weather);
      if (p?.weather) {
        const place = PLACE_OF(p);
        label(place.x, place.y - 96 * place.s, `Chez ${p.name} · ${WEATHER_WORDS[p.weather.kind]} · ${p.weather.temp}°`, 3200);
      }
    }
    else if (t.dataset.mot) {
      const p = world().people.find((x) => x.id === t.dataset.lantern);
      label(Number(t.dataset.x), Number(t.dataset.y) - 40, `${p?.name ?? ''} · ${t.dataset.mot}`, 3600);
    } else if (t.dataset.lantern) {
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
  if (state.data) {
    const signed = people.find((p) => p.sign && !p.sign.sent);
    if (!people.length) text = 'Touche le petit panneau pour inviter quelqu’un';
    else if (!load('pinged')) text = `Touche ${PLACE_OF(people[0]).the} de ${people[0].name} pour lui envoyer une pensée`;
    else if (signed && !load('signed')) text = `Un signe est apparu avec ${signed.name} : touche-le`;
    else if (!load('home-card')) text = 'Appui long sur ton ponton : ta carte et ta météo';
  }
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
  const card = $('.card', root);
  card.addEventListener('click', onAct);
  return card;
}
function closeCard() {
  const wrap = $('.card-wrap', app);
  if (!wrap) return;
  wrap.classList.add('out');
  setTimeout(() => wrap.remove(), 250);
}

const SHARE_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/></svg>';
const ADD_ICON = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

function mapTiles(current) {
  return `<div class="maps">${MAPS.map((m) => `
    <button type="button" class="map map-${m.key} ${m.key === current ? 'on' : ''}" data-act="${m.ready ? 'map' : ''}" data-map="${m.key}" ${m.ready ? '' : 'disabled'}>
      <span class="map-name">${m.name}</span>${m.ready ? '' : '<span class="soon">bientôt</span>'}
    </button>`).join('')}</div>`;
}

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
      <h1>${who ? `${esc(who.name)} t'attend` : 'Bienvenue'}</h1>
      <p class="lead">Comment tu t'appelles, et où veux-tu vivre ?</p>
      <input class="field" name="name" autocomplete="given-name" maxlength="24" placeholder="ton prénom" required>
      ${mapTiles('campagne')}
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
      body: { name: form.name.value, map: $('.map.on', form)?.dataset.map, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, invite },
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
      setTimeout(() => openCard(`
        <h1>Voir les lanternes arriver</h1>
        <p class="lead">Active les notifications pour savoir quand quelqu'un pense à toi, même quand l'app dort.</p>
        <button class="pill wide" data-act="enable-push">Activer</button>
        <button class="link" data-act="close">plus tard</button>`, { closable: false }), 700);
    } else if (pushSupported && Notification.permission === 'granted') {
      syncPush().catch(() => {});
    }
  } catch (err) {
    submit.disabled = false;
    $('.lead', form).textContent = err.message;
  }
}

// Your own corner: where you live, and whether you share your weather.
function homeCard() {
  save('home-card', '1');
  updateHint();
  const { me } = state.data;
  openCard(`
    <h1>Chez toi</h1>
    <p class="lead">Où veux-tu vivre ? Tes proches te suivront, chacun à sa place.</p>
    ${mapTiles(me.map)}
    <div class="toggle-row">
      <div><b>Partager ma météo</b><small>${DEMO ? 'Dans la démo, la météo est imaginaire : chaque activation en essaie une nouvelle.' : 'Tes proches verront le temps qu’il fait chez toi, à 10 km près. Ta position exacte n’est jamais partagée.'}</small></div>
      <button type="button" class="switch ${me.sharesWeather ? 'on' : ''}" role="switch" aria-checked="${me.sharesWeather}" data-act="weather" aria-label="Partager ma météo"><i></i></button>
    </div>
    <p class="tiny weather-note"></p>`);
}

function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Ce téléphone ne donne pas sa position'));
    return navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: Math.round(pos.coords.latitude * 10) / 10, lon: Math.round(pos.coords.longitude * 10) / 10 }),
      () => reject(new Error('Sans ta position, pas de météo partagée')),
      { enableHighAccuracy: false, maximumAge: 3 * 3600000, timeout: 12000 },
    );
  });
}

async function toggleWeather(btn) {
  const note = $('.weather-note', app);
  const on = !btn.classList.contains('on');
  btn.disabled = true;
  try {
    if (on) {
      const where = DEMO ? { lat: 0, lon: 0 } : await position();
      setData(await api('/api/weather', { method: 'PUT', body: where }));
      save('geo-at', String(Date.now()));
    } else {
      setData(await api('/api/weather', { method: 'DELETE' }));
    }
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-checked', on);
    if (note) note.textContent = on ? 'C’est partagé. Tu peux arrêter quand tu veux.' : 'Ta météo n’est plus partagée.';
  } catch (err) {
    if (note) note.textContent = err.message;
  }
  btn.disabled = false;
}

// When sharing, quietly follow the person as they travel (only if the phone already allows it).
async function followWeather() {
  if (DEMO || !state.data?.me.sharesWeather) return;
  if (Date.now() - Number(load('geo-at') || 0) < 6 * 3600000) return;
  const perm = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null);
  if (perm?.state !== 'granted') return;
  try {
    setData(await api('/api/weather', { method: 'PUT', body: await position() }));
    save('geo-at', String(Date.now()));
  } catch { /* keep the last known weather */ }
}

function letGoCard(pid) {
  const p = world().people.find((x) => x.id === pid);
  if (!p) return;
  openCard(`
    <h1>Laisser partir ${esc(p.name)} ?</h1>
    <p class="lead">Son lieu s'effacera doucement, comme une brume qui se lève. Personne ne sera prévenu.</p>
    <button class="pill wide" data-act="let-go" data-id="${p.id}">Laisser partir</button>
    <button class="link" data-act="close">garder près de moi</button>`);
}

async function letGo(pid) {
  closeCard();
  const home = $(`[data-home="${pid}"]`, app);
  if (home) {
    home.style.transition = 'opacity 1.8s ease, filter 1.8s ease';
    home.style.filter = 'blur(3px)';
    home.style.opacity = 0;
  }
  try {
    const data = await api('/api/unlink', { method: 'POST', body: { id: pid } });
    await new Promise((r) => setTimeout(r, 1800));
    setData(data);
    drawStatic();
  } catch {
    if (home) { home.style.opacity = 1; home.style.filter = ''; }
  }
}

function inviteCard() {
  const { me } = state.data;
  const card = openCard(`
    <h1>Quelqu'un près de chez toi ?</h1>
    <p class="lead">Envoie ce lien à quelqu'un que tu aimes. Son lieu apparaîtra ici.</p>
    <button class="pill wide" data-act="share">Partager le lien</button>
    <p class="tiny">ou donne ton code <b class="code">${esc(me.code)}</b></p>
    <form data-code class="inline">
      <input class="field" name="code" maxlength="6" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="un code reçu ?">
      <button class="pill soft" type="submit">OK</button>
    </form>`);
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
  if (!btn || !btn.dataset.act) return;
  switch (btn.dataset.act) {
    case 'enable-push': await enablePush(); closeCard(); break;
    case 'close': closeCard(); break;
    case 'share': shareInvite(); break;
    case 'let-go': letGo(btn.dataset.id); break;
    case 'weather': toggleWeather(btn); break;
    case 'map': {
      btn.parentElement.querySelectorAll('.map').forEach((m) => m.classList.toggle('on', m === btn));
      if (state.data && !btn.closest('form')) {
        setData(await api('/api/me', { method: 'PATCH', body: { map: btn.dataset.map } }));
        closeCard();
      }
      break;
    }
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
  const before = new Set(state.data?.people.map((p) => p.id) || []);
  setData(await api('/api/connect', { method: 'POST', body: { code } }));
  drawStatic();
  const added = state.data.people.find((p) => !before.has(p.id));
  if (added) flash(added.id);
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
  drawWeather();
}

async function refresh() {
  setData(await api('/api/me'));
  if (!state.words) drawStatic();
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
  followWeather();
  api('/api/seen', { method: 'POST' }).catch(() => {});
  navigator.clearAppBadge?.()?.catch(() => {});
}

function cleanUrl() {
  if (location.search) history.replaceState(null, '', '/');
}

// ---------- Events ----------

app.addEventListener('click', (e) => {
  if (e.target.closest('.top [data-act]')) onAct(e);
});

// In the demo, pretend close ones answer back.
addEventListener('pat-demo', () => refresh().catch(() => {}));

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'push') refresh().catch(() => {});
  if (e.data?.type === 'open') wakeUp().catch(() => {});
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
  if (state.token) refresh().catch(() => {});
}, 30000);

// ---------- Boot ----------

async function boot() {
  if (!DEMO && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (state.token) {
    buildWorld();
    try {
      await wakeUp();
    } catch {
      if (state.token) {
        openCard('<h1>Le monde est loin</h1><p class="lead">Pas de connexion pour le moment.</p><button class="pill wide" onclick="location.reload()">Réessayer</button>', { closable: false });
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
