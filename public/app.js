// Pense à toi — two little beings that drift closer when we think of each other.
// No framework, no build step.

import { COLORS, colorOf, avatarSVG, installGrain } from './avatar.js';
import { mountSky, slotWords, slotDate, isPast } from './sky.js';

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const params = new URLSearchParams(location.search);
let invite = (params.get('invite') || '').toUpperCase() || null;
let openSkyFor = params.get('sky');

const state = {
  token: load('token'),
  data: null,
  dataKey: '',
  inviter: null,
  view: 'home',
  page: 0,
  toReceive: new Map(), // person id → number of hearts to show arriving
  config: null,
};

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
    render();
  }
  if (!res.ok) throw new Error(json.error || 'Oups, petit souci 🥲');
  return json;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- Closeness ----------

// Recent thoughts count more; each side's warmth is capped so one person alone
// can only bring them halfway. They touch when both have been thinking.
function warmth(times) {
  const now = Date.now();
  return Math.min(4, times.reduce((s, t) => s + 0.5 ** ((now - t) / (36 * 3600000)), 0));
}
function closeness(p) {
  const a = warmth(p.pingsFromMe);
  const b = warmth(p.pingsFromThem);
  let c = (2 * Math.min(a, b) + Math.max(a, b)) / 12;
  if (momentWith(p.id)) c = Math.max(c, 0.85);
  return Math.min(1, c);
}
const momentWith = (pid) => state.data?.moments.find((m) => m.with?.id === pid);
const sharedSlots = (p) => p.sky.mine.filter((s) => p.sky.theirs.includes(s) && !isPast(s)).sort();

// ---------- Small drawings ----------

const GROUND = `
<svg viewBox="0 0 360 80" preserveAspectRatio="none" aria-hidden="true">
  <defs><radialGradient id="ground-shade" cx="50%" cy="20%" r="75%"><stop offset=".6" stop-color="#CDB4A1" stop-opacity="0"/><stop offset="1" stop-color="#CDB4A1" stop-opacity="1"/></radialGradient></defs>
  <ellipse cx="180" cy="40" rx="178" ry="36" fill="#EAD9CA"/>
  <ellipse cx="180" cy="40" rx="178" ry="36" fill="url(#ground-shade)" filter="url(#grain)"/>
</svg>`;

function heartSVG(color) {
  const c = colorOf(color);
  return `<svg viewBox="0 0 24 22"><defs><radialGradient id="hs-${color}" cx="35%" cy="30%" r="80%"><stop offset=".4" stop-color="${c.shade}" stop-opacity="0"/><stop offset="1" stop-color="${c.shade}"/></radialGradient></defs>
    <path d="M12 21C5.5 16.3 2 12.9 2 8.7 2 5.6 4.4 3.3 7.3 3.3c1.9 0 3.6 1 4.7 2.6 1.1-1.6 2.8-2.6 4.7-2.6 2.9 0 5.3 2.3 5.3 5.4 0 4.2-3.5 7.6-10 12.3z" fill="${c.body}"/>
    <path d="M12 21C5.5 16.3 2 12.9 2 8.7 2 5.6 4.4 3.3 7.3 3.3c1.9 0 3.6 1 4.7 2.6 1.1-1.6 2.8-2.6 4.7-2.6 2.9 0 5.3 2.3 5.3 5.4 0 4.2-3.5 7.6-10 12.3z" fill="url(#hs-${color})" filter="url(#grain)"/></svg>`;
}

const SHARE_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/></svg>';
const ADD_ICON = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

function being(cls, color, name, opts = {}) {
  return `<div class="being ${cls}" ${opts.attrs || ''}><div class="hop">${avatarSVG(color, opts)}</div>${name ? `<div class="name">${esc(name)}</div>` : ''}</div>`;
}

// ---------- Views ----------

function render() {
  if (state.token && state.data) {
    if (state.view === 'notif') app.innerHTML = notifView();
    else renderHome();
  } else if (state.token) {
    app.innerHTML = '<div class="solo"></div>';
  } else if (isIOS && !isStandalone) {
    app.innerHTML = installView();
  } else {
    app.innerHTML = onboardView();
  }
  placeDuo();
}

// Two beings side by side on the welcome screens.
function placeDuo() {
  const duo = $('.duo', app);
  if (!duo) return;
  const [a, b] = duo.querySelectorAll('.being');
  const size = 118;
  const mid = duo.clientWidth / 2;
  a.style.transform = `translateX(${b ? mid - size - 14 : mid - size / 2}px)`;
  if (b) b.style.transform = `translateX(${mid + 14}px)`;
}

function installView() {
  const who = state.inviter;
  return `
  <div class="solo">
    <div class="duo">${being('me', 'rose', '', { ghost: true })}${who ? being('them', who.color, '') : being('them', 'ciel', '')}</div>
    <h1>${who ? `${esc(who.name)} pense à toi` : 'Pense à toi'}</h1>
    <p class="lead">Installe l'app sur ton iPhone. Ça prend vingt secondes.</p>
    <div class="steps">
      <div class="step"><b>1</b><div>Touche ${SHARE_ICON} <strong>Partager</strong><br><span class="tiny">parfois caché sous ⋯ en bas</span></div></div>
      <div class="step"><b>2</b><div>Choisis ${ADD_ICON} <strong>Sur l'écran d'accueil</strong></div></div>
      <div class="step"><b>3</b><div>Ouvre <strong>Pense à toi</strong> depuis ton écran d'accueil</div></div>
    </div>
    <p class="tiny">Dans WhatsApp ou Messenger ? Ouvre d'abord ce lien dans Safari.</p>
    ${invite ? `<p class="tiny" style="margin:18px 0 2px">Tu as déjà l'app ? Entre ce code :</p><div class="code">${esc(invite)}</div>` : ''}
  </div>`;
}

function onboardView() {
  const who = state.inviter;
  const pick = COLORS[load('color')] ? load('color') : 'rose';
  return `
  <form class="solo" data-form="signup">
    <div class="duo">${being('me', pick, '')}${who ? being('them', who.color, '') : ''}</div>
    <h1>${who ? `${esc(who.name)} t'attend` : 'Coucou toi'}</h1>
    <p class="lead">Choisis ta couleur et ton prénom.</p>
    <div class="swatches" role="radiogroup" aria-label="Ta couleur">
      ${Object.entries(COLORS).map(([k, c]) => `<button type="button" class="swatch ${k === pick ? 'on' : ''}" style="background:${c.body}" data-color="${k}" role="radio" aria-checked="${k === pick}" aria-label="${k}"></button>`).join('')}
    </div>
    <input class="field" name="name" autocomplete="given-name" maxlength="24" placeholder="ton prénom" required>
    <div class="stack" style="margin-top:22px"><button class="pill wide" type="submit">C'est moi</button></div>
  </form>`;
}

function notifView() {
  const { me, people } = state.data;
  const p = people[0];
  return `
  <div class="solo">
    <div class="duo">${being('me', me.color, '')}${p ? being('them', p.color, '') : being('them', 'ciel', '', { ghost: true })}</div>
    <h1>Sentir ses pensées</h1>
    <p class="lead">Active les notifications pour savoir quand quelqu'un pense à toi.</p>
    <div class="stack">
      <button class="pill wide" data-act="enable-push">Activer</button>
      <button class="link" data-act="skip-push">plus tard</button>
    </div>
  </div>`;
}

function renderHome() {
  const { me, people } = state.data;
  const notifChip = pushSupported && Notification.permission === 'default'
    ? '<button class="pill soft small notif-chip" data-act="enable-push">Activer les notifications</button>' : '';
  app.innerHTML = `
    <div class="top-bar">${notifChip}</div>
    <div class="pages">
      ${people.map((p) => personPage(me, p)).join('')}
      ${addPage(me)}
    </div>
    <div class="dock"><div class="dots"></div><div class="dock-action"></div></div>`;
  const pages = $('.pages', app);
  state.page = Math.min(state.page, people.length);
  requestAnimationFrame(() => {
    pages.scrollLeft = state.page * pages.clientWidth;
    app.querySelectorAll('.page').forEach(place);
    renderDock();
    receiveIfNeeded();
  });
  let t;
  pages.addEventListener('scroll', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const i = Math.round(pages.scrollLeft / pages.clientWidth);
      if (i !== state.page) {
        state.page = i;
        renderDock();
        receiveIfNeeded();
      }
    }, 80);
  });
}

function personPage(me, p) {
  const m = momentWith(p.id);
  const hint = load('pinged') ? '' : `Touche ${esc(p.name)} pour lui envoyer une pensée`;
  return `
  <section class="page" data-person="${p.id}">
    <div class="stage" data-act="ping" data-id="${p.id}">
      <div class="ground">${GROUND}</div>
      ${m ? `<button class="moment-tag" data-act="moment" data-id="${m.id}">${m.kind === 'call' ? "On s'appelle" : 'On se voit'} <b>${esc(slotWords(m.slot))}</b></button>` : ''}
      ${being('me', me.color, 'toi')}
      ${being('them', p.color, p.name)}
    </div>
    <div class="hint">${hint}</div>
  </section>`;
}

function addPage(me) {
  return `
  <section class="page" data-add>
    <div class="stage" data-act="invite">
      <div class="ground">${GROUND}</div>
      ${being('me', me.color, 'toi')}
      ${being('them', 'ciel', '', { ghost: true })}
    </div>
    <div class="hint">${state.data.people.length ? 'Quelqu’un d’autre ?' : 'Invite quelqu’un que tu aimes'}</div>
  </section>`;
}

// Position the two beings according to how much they have been thinking of each other.
function place(page) {
  const stage = $('.stage', page);
  const [meEl, themEl] = stage.querySelectorAll('.being');
  const W = stage.clientWidth;
  const size = Math.min(128, W * 0.33);
  const pid = page.dataset.person;
  const p = pid && state.data.people.find((x) => x.id === pid);
  const c = p ? closeness(p) : 0.15;
  const maxGap = Math.max(24, W - 2 * size - 36);
  const gap = maxGap + (-size * 0.14 - maxGap) * c;
  const lean = c > 0.75 ? 7 : c > 0.45 ? 3 : 0;
  for (const el of [meEl, themEl]) el.style.setProperty('--size', `${size}px`);
  meEl.style.transform = `translateX(${W / 2 - gap / 2 - size}px) rotate(${lean}deg)`;
  themEl.style.transform = `translateX(${W / 2 + gap / 2}px) rotate(${-lean}deg)`;
  meEl.style.transformOrigin = themEl.style.transformOrigin = '50% 100%';
  // Names stay level while the beings lean in.
  for (const [el, r] of [[meEl, -lean], [themEl, lean]]) {
    const name = $('.name', el);
    if (name) name.style.transform = `rotate(${r}deg)`;
  }
  if (p) {
    const mood = c > 0.75 ? 'happy' : 'calm';
    if (meEl.dataset.mood !== mood) {
      meEl.dataset.mood = themEl.dataset.mood = mood;
      $('.hop', meEl).innerHTML = avatarSVG(state.data.me.color, { mood });
      $('.hop', themEl).innerHTML = avatarSVG(p.color, { mood });
    }
  }
}

function renderDock() {
  const { people } = state.data;
  const dots = $('.dots', app);
  const action = $('.dock-action', app);
  if (!dots) return;
  const total = people.length + 1;
  dots.innerHTML = total > 1 ? Array.from({ length: total }, (_, i) => `<i class="${i === state.page ? 'on' : ''}"></i>`).join('') : '';
  const p = people[state.page];
  if (!p) {
    action.innerHTML = '<button class="pill" data-act="invite">Inviter</button>';
    return;
  }
  const shared = sharedSlots(p).filter((s) => !state.data.moments.some((m) => m.slot === s && m.with?.id === p.id));
  let label = 'Notre ciel';
  let cls = '';
  if (shared.length && !momentWith(p.id)) { label = 'Vos ciels se croisent'; cls = 'lilac pulse'; }
  else if (p.sky.theirs.some((s) => !isPast(s)) && !p.sky.mine.some((s) => !isPast(s))) { label = 'À toi de peindre'; cls = 'lilac'; }
  action.innerHTML = `<button class="pill ${cls}" data-act="sky" data-id="${p.id}">${label}</button>`;
}

// ---------- Animations ----------

function headPoint(beingEl) {
  const r = $('.being-svg', beingEl).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.28 };
}

function bounce(el, kind) {
  const frames = kind === 'jump'
    ? [{ transform: 'scale(1.06,.9)' }, { transform: 'translateY(-26px) scale(.95,1.06)', offset: 0.35 }, { transform: 'translateY(0) scale(1.07,.92)', offset: 0.7 }, { transform: 'none' }]
    : [{ transform: 'none' }, { transform: 'rotate(-5deg) scale(1.04,.96)', offset: 0.25 }, { transform: 'rotate(4deg)', offset: 0.55 }, { transform: 'rotate(-2deg)', offset: 0.8 }, { transform: 'none' }];
  return el.animate(frames, { duration: kind === 'jump' ? 600 : 700, easing: 'ease-out' }).finished.catch(() => {});
}

function rings(stage, beingEl) {
  const s = stage.getBoundingClientRect();
  const b = $('.being-svg', beingEl).getBoundingClientRect();
  for (let i = 0; i < 3; i++) {
    const r = document.createElement('div');
    r.className = 'ring';
    r.style.left = `${b.left - s.left + b.width / 2}px`;
    r.style.top = `${b.bottom - s.top - 6}px`;
    r.style.animationDelay = `${i * 180}ms`;
    stage.prepend(r);
    setTimeout(() => r.remove(), 2000);
  }
}

function flyHeart(from, to, color) {
  const a = headPoint(from);
  const b = headPoint(to);
  const h = document.createElement('div');
  h.className = 'flying-heart';
  h.innerHTML = heartSVG(color);
  document.body.appendChild(h);
  const at = (p, extra = '') => ({ transform: `translate(${p.x - 17}px, ${p.y - 17}px) ${extra}` });
  const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 70 };
  return h.animate([at(a, 'scale(.3)'), at(mid, 'scale(1.15) rotate(-8deg)'), at(b, 'scale(.6)')], {
    duration: 900, easing: 'cubic-bezier(.4,.1,.4,1)', fill: 'forwards',
  }).finished.catch(() => {}).then(() => h.remove());
}

async function ping(pid) {
  const page = $(`.page[data-person="${pid}"]`, app);
  const p = state.data.people.find((x) => x.id === pid);
  if (!page || !p) return;
  const stage = $('.stage', page);
  const [meEl, themEl] = stage.querySelectorAll('.being');
  save('pinged', '1');
  $('.hint', page).textContent = '';
  api('/api/pings', { method: 'POST', body: { to: pid } }).catch((err) => toast(err.message));
  bounce($('.hop', meEl), 'jump');
  await flyHeart(meEl, themEl, state.data.me.color);
  bounce($('.hop', themEl), 'wiggle');
  rings(stage, themEl);
  p.pingsFromMe.push(Date.now());
  place(page);
}

// Hearts that arrived while the app was closed fly in when you look at that person.
async function receiveIfNeeded() {
  const p = state.data.people[state.page];
  if (!p || !state.toReceive.has(p.id)) return;
  const n = Math.min(3, state.toReceive.get(p.id));
  state.toReceive.delete(p.id);
  const page = $(`.page[data-person="${p.id}"]`, app);
  const stage = $('.stage', page);
  const [meEl, themEl] = stage.querySelectorAll('.being');
  await new Promise((r) => setTimeout(r, 500));
  for (let i = 0; i < n; i++) {
    bounce($('.hop', themEl), 'jump');
    await flyHeart(themEl, meEl, p.color);
    bounce($('.hop', meEl), 'wiggle');
    rings(stage, meEl);
  }
}

// ---------- Sheets ----------

function openSheet(draw) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div><div class="body"></div></div>';
  const body = $('.body', overlay);
  const close = () => {
    overlay.classList.add('out');
    setTimeout(() => overlay.remove(), 200);
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  $('#sheet-root').appendChild(overlay);
  draw(body, close);
  return close;
}
const sheetOpen = () => Boolean($('.overlay:not(.out)'));

function skySheet(p) {
  const { me } = state.data;
  openSheet((body, close) => {
    body.innerHTML = `
      <h2 class="sheet-title caps">Notre ciel</h2>
      <p class="lead">Peins tes moments libres. Là où vos couleurs se mêlent, on se retrouve.</p>
      <div class="legend"><span><i style="background:${colorOf(me.color).shade}"></i>toi</span><span><i style="background:${colorOf(p.color).shade}"></i>${esc(p.name)}</span></div>
      <div class="sky"></div>
      <div class="sky-foot"></div>`;
    const foot = $('.sky-foot', body);

    const showShared = () => {
      const planned = state.data.moments.filter((m) => m.with?.id === p.id).map((m) => m.slot);
      const shared = sky.shared().filter((s) => !planned.includes(s));
      if (!shared.length) {
        foot.innerHTML = `<p class="tiny">${p.sky.theirs.some((s) => !isPast(s)) ? 'Pas encore de couleur commune.' : `${esc(p.name)} n'a pas encore peint.`}</p>`;
        return;
      }
      foot.innerHTML = `<div class="caps tiny">Vos ciels se croisent</div>
        <div class="chips">${shared.slice(0, 4).map((s) => `<button class="pill soft small" data-slot="${s}">${esc(slotWords(s))}</button>`).join('')}</div>`;
    };

    const choose = (slot) => {
      foot.innerHTML = `
        <div class="big-words">${esc(slotWords(slot))}</div>
        <div class="row">
          <button class="pill" data-kind="call">On s'appelle</button>
          <button class="pill" data-kind="meet">On se voit</button>
        </div>
        <button class="link" data-back>retour</button>`;
      foot.dataset.chosen = slot;
    };

    let saving = Promise.resolve();
    const sky = mountSky($('.sky', body), {
      mine: p.sky.mine,
      theirs: p.sky.theirs,
      meColor: me.color,
      themColor: p.color,
      onChange: (cells) => {
        p.sky.mine = cells;
        showShared();
        saving = api(`/api/sky/${p.id}`, { method: 'PUT', body: { cells } })
          .then((data) => { setData(data); })
          .catch((err) => toast(err.message));
      },
    });
    showShared();

    foot.addEventListener('click', async (e) => {
      const slotBtn = e.target.closest('[data-slot]');
      if (slotBtn) return choose(slotBtn.dataset.slot);
      if (e.target.closest('[data-back]')) return showShared();
      const kindBtn = e.target.closest('[data-kind]');
      if (!kindBtn) return undefined;
      kindBtn.disabled = true;
      try {
        await saving;
        const slot = foot.dataset.chosen;
        await api('/api/moments', { method: 'POST', body: { with: p.id, slot, kind: kindBtn.dataset.kind, at: slotDate(slot).toISOString() } });
        close();
        toast("C'est calé 💗");
        await refresh(true);
      } catch (err) {
        kindBtn.disabled = false;
        toast(err.message);
      }
      return undefined;
    });
  });
}

function momentSheet(m) {
  openSheet((body, close) => {
    body.innerHTML = `
      <div class="center" style="padding:8px 0 4px">
        <div class="caps tiny">${m.kind === 'call' ? "On s'appelle" : 'On se voit'} · ${esc(m.with?.name)}</div>
        <div class="big-words" style="margin:8px 0 24px">${esc(slotWords(m.slot))}</div>
        <div class="stack">
          <a class="pill soft wide" href="/api/moments/${m.id}.ics?for=${state.data.me.id}" style="text-decoration:none">Dans mon calendrier</a>
          <button class="link" data-cancel>je ne peux plus</button>
        </div>
      </div>`;
    $('[data-cancel]', body).addEventListener('click', async () => {
      if (!confirm(`Prévenir ${m.with?.name} que tu ne peux plus ?`)) return;
      try {
        await api(`/api/moments/${m.id}/cancel`, { method: 'POST' });
        close();
        await refresh(true);
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

function inviteSheet() {
  const { me } = state.data;
  openSheet((body, close) => {
    body.innerHTML = `
      <div class="center">
        <h2 class="sheet-title caps">Inviter</h2>
        <p class="lead">Envoie ce lien à quelqu'un que tu aimes.</p>
        <button class="pill wide" data-share style="max-width:320px">Partager le lien</button>
        <p class="tiny" style="margin:22px 0 2px">ou donne ton code</p>
        <div class="code">${esc(me.code)}</div>
        <form data-code-form class="stack" style="margin-top:26px">
          <p class="tiny" style="margin:0">On t'a donné un code ?</p>
          <input class="field" name="code" maxlength="6" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="ABC123" style="letter-spacing:.16em">
          <button class="pill soft" type="submit">Ajouter</button>
        </form>
      </div>`;
    $('[data-share]', body).addEventListener('click', shareInvite);
    $('[data-code-form]', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = e.target.code.value.trim().toUpperCase();
      if (!value) return;
      try {
        await acceptCode(value);
        close();
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

// ---------- Actions ----------

async function shareInvite() {
  const { me } = state.data;
  const url = `${location.origin}/?invite=${me.code}`;
  const text = `${me.name} pense à toi 💗`;
  if (navigator.share) {
    await navigator.share({ title: 'Pense à toi', text, url }).catch(() => {});
  } else {
    await navigator.clipboard?.writeText(`${text}\n${url}`).catch(() => {});
    toast('Lien copié');
  }
}

async function acceptCode(code, quiet = false) {
  const before = state.data?.people.length || 0;
  setData(await api('/api/connect', { method: 'POST', body: { code } }));
  const added = state.data.people.length > before;
  if (added) state.page = state.data.people.length - 1;
  render();
  if (!quiet || added) toast(added ? 'Vous voilà reliés 💞' : 'Vous étiez déjà reliés 💞');
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
    const result = await syncPush(true);
    if (result === 'denied') toast('Tu pourras les activer dans Réglages');
  } catch (err) {
    toast("Impossible d'activer les notifications");
    console.error(err);
  }
  state.view = 'home';
  render();
}

function setData(data) {
  state.data = data;
  const key = JSON.stringify(data);
  const changed = key !== state.dataKey;
  state.dataKey = key;
  return changed;
}

async function refresh(force = false) {
  const changed = setData(await api('/api/me'));
  if ((changed || force) && !sheetOpen()) render();
  return state.data;
}

// Called whenever the app comes to the foreground.
async function wakeUp() {
  if (!state.token) return;
  const data = await api('/api/me');
  const seenAt = data.me.seenAt;
  for (const p of data.people) {
    const n = p.pingsFromThem.filter((t) => t > seenAt).length;
    if (n) state.toReceive.set(p.id, n);
  }
  // Open on the person who thought of you.
  const first = data.people.findIndex((p) => state.toReceive.has(p.id));
  if (first >= 0) state.page = first;
  if (setData(data) || !$('.pages', app)) render();
  else receiveIfNeeded();
  api('/api/seen', { method: 'POST' }).catch(() => {});
  navigator.clearAppBadge?.()?.catch(() => {});
  if (openSkyFor) {
    const p = data.people.find((x) => x.id === openSkyFor);
    openSkyFor = null;
    if (p) skySheet(p);
  }
}

function cleanUrl() {
  if (location.search) history.replaceState(null, '', '/');
}

// ---------- Events ----------

app.addEventListener('click', async (e) => {
  const swatch = e.target.closest('[data-color]');
  if (swatch) {
    const color = swatch.dataset.color;
    app.querySelectorAll('[data-color]').forEach((b) => {
      b.classList.toggle('on', b === swatch);
      b.setAttribute('aria-checked', b === swatch);
    });
    save('color', color);
    const hop = $('.duo .being.me .hop', app);
    hop.innerHTML = avatarSVG(color);
    bounce(hop, 'jump');
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  const person = (pid) => state.data.people.find((p) => p.id === pid);
  switch (act) {
    case 'ping': return ping(id);
    case 'sky': return skySheet(person(id));
    case 'moment': e.stopPropagation(); return momentSheet(state.data.moments.find((m) => m.id === id));
    case 'invite': return inviteSheet();
    case 'enable-push': return enablePush();
    case 'skip-push': state.view = 'home'; return render();
    default: return undefined;
  }
});

app.addEventListener('submit', async (e) => {
  if (e.target.dataset.form !== 'signup') return;
  e.preventDefault();
  const submit = $('[type=submit]', e.target);
  submit.disabled = true;
  try {
    const res = await api('/api/users', {
      method: 'POST',
      body: {
        name: e.target.name.value,
        color: $('.swatch.on', e.target)?.dataset.color,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        invite,
      },
    });
    state.token = res.token;
    save('token', res.token);
    delete res.token;
    setData(res);
    invite = null;
    cleanUrl();
    state.view = pushSupported && Notification.permission !== 'granted' ? 'notif' : 'home';
    render();
    if (pushSupported && Notification.permission === 'granted') syncPush().catch(() => {});
  } catch (err) {
    submit.disabled = false;
    toast(err.message);
  }
});

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'push') refresh().catch(() => {});
  if (e.data?.type === 'open') {
    openSkyFor = new URL(e.data.url, location.origin).searchParams.get('sky');
    wakeUp().catch(() => {});
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wakeUp().catch(() => {});
});
setInterval(() => {
  if (document.visibilityState === 'visible' && state.token && state.view === 'home') refresh().catch(() => {});
}, 30000);
addEventListener('resize', () => {
  app.querySelectorAll('.page').forEach(place);
  placeDuo();
});

// ---------- Boot ----------

async function boot() {
  installGrain();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  render();
  if (state.token) {
    try {
      await wakeUp();
    } catch {
      if (state.token) {
        app.innerHTML = '<div class="solo"><h1>Pas de connexion</h1><p class="lead">On réessaie dans un instant.</p><button class="pill" onclick="location.reload()">Réessayer</button></div>';
      }
      return;
    }
    if (invite) {
      await acceptCode(invite, true).catch(() => {});
      invite = null;
    }
    cleanUrl();
    api('/api/me', { method: 'PATCH', body: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }).catch(() => {});
    syncPush().catch(() => {});
  } else if (invite) {
    try {
      state.inviter = (await api(`/api/invites/${invite}`)).from;
    } catch {
      invite = null;
    }
    render();
  }
}

boot();
