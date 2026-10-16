// Pense à toi — a tiny heart pager. No framework, no build step.

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const EMOJIS = ['🌷', '🐻', '🐱', '🦊', '🐰', '🌸', '☀️', '🍓', '🐼', '🌙'];
const KIND = {
  call: { emoji: '📞', label: "S'appeler", noun: 'Appel', wants: "aimerait t'appeler" },
  meet: { emoji: '🫶', label: 'Se voir', noun: 'On se voit', wants: 'aimerait te voir' },
};
const HEARTS = ['💗', '💕', '💖', '🩷', '💞'];

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const params = new URLSearchParams(location.search);
let invite = (params.get('invite') || '').toUpperCase() || null;
let focusMoment = params.get('moment');

const state = {
  token: load('token'),
  data: null,
  inviter: null,
  view: 'home',
  fresh: new Set(),
  justSent: {},
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

// ---------- Time helpers ----------

const DAY = 86400000;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayDiff = (d) => Math.round((startOfDay(d) - startOfDay(new Date())) / DAY);
const hm = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function dayWord(d) {
  const date = new Date(d);
  const n = dayDiff(date);
  if (n === 0) return date.getHours() >= 18 ? 'Ce soir' : "Aujourd'hui";
  if (n === 1) return 'Demain';
  if (n < 7) return cap(date.toLocaleDateString('fr-FR', { weekday: 'long' }));
  return cap(date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }));
}
const slotLabel = (d) => `${dayWord(d)} · ${hm(d)}`;
const longDate = (d) => `${cap(new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))} à ${hm(d)}`;

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < DAY / 1000) return `il y a ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / (DAY / 1000));
  return d === 1 ? 'hier' : `il y a ${d} jours`;
}

function at(dayOffset, h, m = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
}
// Days until the next given weekday (0 = Sunday), at least `min` days away.
function until(weekday, min = 0) {
  let n = (weekday - new Date().getDay() + 7) % 7;
  if (n < min) n += 7;
  return n;
}

// A handful of sensible moments, so proposing is a couple of taps.
function suggestions(kind) {
  const list = kind === 'call'
    ? [at(0, 19), at(1, 12, 30), at(1, 19), at(until(6), 11), at(until(0), 18), at(until(3, 2), 19), at(2, 19)]
    : [at(until(6, 1), 12, 30), at(until(0, 1), 12, 30), at(until(6, 1), 19, 30), at(until(5, 1), 19, 30), at(until(6, 1) + 7, 12, 30), at(until(0, 1) + 7, 12, 30)];
  const soon = Date.now() + 30 * 60000;
  const seen = new Set();
  return list
    .filter((d) => d.getTime() > soon)
    .filter((d) => !seen.has(d.getTime()) && seen.add(d.getTime()))
    .sort((a, b) => a - b)
    .slice(0, 6);
}

// ---------- Little bits of joy ----------

function burst(el, count = 7) {
  const r = el.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    const h = document.createElement('span');
    h.className = 'floaty';
    h.textContent = HEARTS[i % HEARTS.length];
    h.style.left = `${r.left + r.width / 2 - 11 + (Math.random() * 24 - 12)}px`;
    h.style.top = `${r.top + r.height / 2 - 14}px`;
    h.style.setProperty('--dx', `${Math.random() * 120 - 60}px`);
    h.style.setProperty('--rot', `${Math.random() * 50 - 25}deg`);
    h.style.animationDelay = `${i * 45}ms`;
    document.body.appendChild(h);
    setTimeout(() => h.remove(), 1500);
  }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const MASCOT = `
<svg class="mascot" viewBox="0 0 200 200" aria-hidden="true">
  <defs>
    <radialGradient id="mg" cx="35%" cy="28%" r="80%">
      <stop offset="0" stop-color="#FFC7D5"/><stop offset=".55" stop-color="#FF8FAB"/><stop offset="1" stop-color="#F2678C"/>
    </radialGradient>
  </defs>
  <path d="M100 176C42 134 16 102 16 70c0-27 21-46 46-46 18 0 31 10 38 24 7-14 20-24 38-24 25 0 46 19 46 46 0 32-26 64-84 106z" fill="url(#mg)"/>
  <ellipse cx="58" cy="58" rx="16" ry="9" fill="#fff" opacity=".45" transform="rotate(-30 58 58)"/>
  <path d="M66 92q11-11 22 0M112 92q11-11 22 0" stroke="#5A4350" stroke-width="6" fill="none" stroke-linecap="round"/>
  <ellipse cx="62" cy="110" rx="12" ry="7" fill="#FF5C88" opacity=".35"/>
  <ellipse cx="138" cy="110" rx="12" ry="7" fill="#FF5C88" opacity=".35"/>
  <path d="M91 108q9 10 18 0" stroke="#5A4350" stroke-width="5" fill="none" stroke-linecap="round"/>
</svg>`;

const HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21C5.5 16.3 2 12.9 2 8.7 2 5.6 4.4 3.3 7.3 3.3c1.9 0 3.6 1 4.7 2.6 1.1-1.6 2.8-2.6 4.7-2.6 2.9 0 5.3 2.3 5.3 5.4 0 4.2-3.5 7.6-10 12.3z"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/></svg>';
const ADD_ICON = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

// ---------- Views ----------

function render() {
  if (state.token && state.data) app.innerHTML = state.view === 'notif' ? notifView() : homeView();
  else if (state.token) app.innerHTML = `<div class="center">${MASCOT}<p class="lead">Un instant…</p></div>`;
  else if (isIOS && !isStandalone) app.innerHTML = installView();
  else app.innerHTML = onboardView();
}

function installView() {
  const who = state.inviter;
  return `
  <div class="center">
    ${MASCOT}
    <h1>${who ? `${esc(who.emoji)} ${esc(who.name)} t'invite 💗` : 'Pense à toi'}</h1>
    <p class="lead">Installe l'app sur ton iPhone pour recevoir les petits cœurs. Ça prend 20&nbsp;secondes :</p>
    <div class="steps">
      <div class="step"><b>1</b><div>Touche ${SHARE_ICON} <strong>Partager</strong><br><span class="tiny">(parfois caché sous ⋯ en bas)</span></div></div>
      <div class="step"><b>2</b><div>Choisis ${ADD_ICON} <strong>Sur l'écran d'accueil</strong></div></div>
      <div class="step"><b>3</b><div>Ouvre <strong>Pense à toi</strong> depuis ton écran d'accueil 💗</div></div>
    </div>
    <p class="tiny">Tu es dans WhatsApp ou Messenger ?<br>Ouvre d'abord ce lien dans Safari.</p>
    ${invite ? `<p class="tiny" style="margin-top:22px">Tu as déjà l'app ? Touche <strong>+</strong> et entre ce code :</p><div class="code">${esc(invite)}</div>` : ''}
  </div>`;
}

function onboardView() {
  const who = state.inviter;
  const pick = load('emoji') || EMOJIS[0];
  return `
  <form class="center" data-form="signup">
    ${MASCOT}
    <h1>${who ? `${esc(who.emoji)} ${esc(who.name)} t'invite 💗` : 'Coucou !'}</h1>
    <p class="lead">Comment tu t'appelles ? C'est ce que verront tes proches.</p>
    <input class="field" name="name" autocomplete="given-name" maxlength="24" placeholder="Ton prénom ou surnom" required>
    <div class="emojis" role="radiogroup" aria-label="Ton emoji">
      ${EMOJIS.map((e) => `<button type="button" class="emoji ${e === pick ? 'on' : ''}" data-emoji="${e}" role="radio" aria-checked="${e === pick}">${e}</button>`).join('')}
    </div>
    <button class="pill pink" type="submit">C'est parti 💗</button>
  </form>`;
}

function notifView() {
  return `
  <div class="center">
    ${MASCOT}
    <h1>Une dernière chose</h1>
    <p class="lead">Active les notifications pour recevoir les petits cœurs, même quand l'app est fermée.</p>
    <div class="stack">
      <button class="pill pink" data-act="enable-push">Activer les notifications 🔔</button>
      <button class="pill ghost" data-act="skip-push">Plus tard</button>
    </div>
  </div>`;
}

function pushBanner() {
  if (!pushSupported) return '';
  if (Notification.permission === 'denied') {
    return `<div class="banner"><span class="emo">🔕</span><div>Notifications bloquées.<br><span class="tiny">Réglages › Notifications › Pense à toi</span></div></div>`;
  }
  if (Notification.permission === 'default') {
    return `<div class="banner"><span class="emo">🔔</span><div>Active les notifs pour recevoir les cœurs</div><button class="pill pink" data-act="enable-push">Activer</button></div>`;
  }
  return '';
}

function homeView() {
  const { me, people } = state.data;
  return `
  <header class="top">
    <div><div class="hello">Coucou ${esc(me.name)} ${esc(me.emoji)}</div><h1 class="title">Pense à toi</h1></div>
    <button class="round-btn" data-act="invite" aria-label="Inviter quelqu'un">+</button>
  </header>
  ${pushBanner()}
  ${people.length ? people.map(personCard).join('') : emptyView()}`;
}

function emptyView() {
  return `
  <div class="center" style="padding-top:2vh">
    ${MASCOT}
    <h2>Invite ta personne préférée 💌</h2>
    <p class="lead">Ta maman, ton amoureux·se, ta meilleure amie… Dès que le lien est ouvert, vous voilà connectés.</p>
    <div class="stack">
      <button class="pill pink" data-act="share">Envoyer une invitation</button>
      <button class="pill ghost" data-act="invite">J'ai reçu un code</button>
    </div>
  </div>`;
}

function statusOf(p) {
  if (Date.now() - (state.justSent[p.id] || 0) < 4000) return { text: 'Petit cœur envoyé ✓', love: true };
  const last = p.pingsFromThem.length ? Math.max(...p.pingsFromThem) : null;
  if (last && Date.now() - last < DAY) {
    const today = p.pingsFromThem.filter((t) => dayDiff(t) === 0).length;
    return { text: `a pensé à toi ${ago(last)} 💗${today > 1 ? ` ×${today}` : ''}`, love: true };
  }
  if (p.lastFromMe) return { text: `Ton dernier cœur : ${ago(p.lastFromMe)}` };
  return { text: 'Envoie-lui un petit cœur' };
}

function personCard(p) {
  const st = statusOf(p);
  const moments = state.data.moments.filter((m) => m.with?.id === p.id);
  return `
  <section class="card" id="p-${p.id}">
    <div class="person">
      <div class="avatar ${state.fresh.has(p.id) ? 'fresh' : ''}" data-avatar="${p.id}">${esc(p.emoji)}</div>
      <div class="who">
        <h2 class="name">${esc(p.name)}</h2>
        <div class="status ${st.love ? 'love' : ''}" data-status="${p.id}">${esc(st.text)}</div>
      </div>
      <button class="heart-btn" data-act="ping" data-id="${p.id}" aria-label="Dire à ${esc(p.name)} que tu penses à elle ou lui">${HEART_SVG}</button>
    </div>
    <div class="moment-zone">
      ${moments.length
        ? moments.map((m) => momentBubble(m, p)).join('')
        : `<button class="pill" data-act="propose" data-id="${p.id}">📞 🫶&nbsp; On se trouve un moment ?</button>`}
    </div>
  </section>`;
}

function momentBubble(m, p) {
  const k = KIND[m.kind];
  if (m.status === 'confirmed') {
    return `
    <button class="bubble done" data-act="moment" data-id="${m.id}" style="width:100%;text-align:left" id="m-${m.id}">
      <div class="row"><div>
        <div class="bubble-title">${k.emoji} ${k.noun} · ${esc(slotLabel(m.at))}</div>
        <div class="bubble-sub">C'est calé ✓</div>
      </div><span class="x">›</span></div>
    </button>`;
  }
  if (m.mine) {
    const n = m.slots.length;
    return `
    <div class="bubble wait" id="m-${m.id}">
      <div class="row"><div>
        <div class="bubble-title">${k.emoji} Proposition envoyée</div>
        <div class="bubble-sub">${n} moment${n > 1 ? 's' : ''} · en attente de ${esc(p.name)}</div>
      </div><button class="x" data-act="cancel" data-id="${m.id}">Annuler</button></div>
    </div>`;
  }
  const future = m.slots.filter((s) => new Date(s) > Date.now());
  return `
  <div class="bubble" id="m-${m.id}">
    <div class="bubble-title">${k.emoji} ${esc(p.name)} ${k.wants} !<br><span class="bubble-sub">Touche le moment qui te va :</span></div>
    <div class="slots">
      ${future.map((s) => `<button class="slot" data-act="accept" data-id="${m.id}" data-slot="${s}">${esc(slotLabel(s))}<span>♡</span></button>`).join('')}
    </div>
    <button class="pill ghost" data-act="counter" data-id="${m.id}" data-person="${p.id}">Aucun ne me va</button>
  </div>`;
}

// ---------- Sheets ----------

function openSheet(draw) {
  const root = $('#sheet-root');
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div><div class="body"></div></div>';
  const body = $('.body', overlay);
  const close = () => {
    overlay.classList.add('out');
    setTimeout(() => overlay.remove(), 200);
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  root.appendChild(overlay);
  draw(body, close);
  return close;
}

function proposeSheet(person, replaces) {
  let kind = 'call';
  let picked = [];
  let extra = [];

  openSheet((body, close) => {
    const draw = () => {
      const options = [...suggestions(kind), ...extra.map((s) => new Date(s))]
        .sort((a, b) => a - b)
        .map((d) => d.toISOString());
      const minLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      body.innerHTML = `
        <h2>Un moment avec ${esc(person.name)} ${esc(person.emoji)}</h2>
        <p class="lead">${replaces ? 'Propose d\'autres moments qui t\'arrangent.' : 'Choisis jusqu\'à 3 moments qui t\'arrangent.'}</p>
        <div class="kinds">
          ${Object.entries(KIND).map(([key, k]) => `<button class="kind ${kind === key ? 'on' : ''}" data-kind="${key}"><div>${k.emoji}</div>${k.label}</button>`).join('')}
        </div>
        <div class="label">Quand ?</div>
        <div class="chips">
          ${options.map((iso) => `<button class="chip ${picked.includes(iso) ? 'on' : ''}" data-iso="${iso}"><strong>${esc(dayWord(iso))}</strong><small>${hm(iso)}</small></button>`).join('')}
          <label class="chip other custom"><strong>Autre…</strong><small>date &amp; heure</small><input type="datetime-local" min="${minLocal}" aria-label="Choisir une autre date"></label>
        </div>
        <button class="pill pink" data-send ${picked.length ? '' : 'disabled'}>Envoyer à ${esc(person.name)} 💌</button>`;
    };

    const toggle = (iso) => {
      if (picked.includes(iso)) picked = picked.filter((x) => x !== iso);
      else if (picked.length >= 3) return toast('3 moments, c\'est parfait 😊');
      else picked.push(iso);
      draw();
    };

    body.addEventListener('click', async (e) => {
      const kindBtn = e.target.closest('[data-kind]');
      if (kindBtn) {
        kind = kindBtn.dataset.kind;
        picked = [];
        extra = [];
        return draw();
      }
      const chip = e.target.closest('[data-iso]');
      if (chip) return toggle(chip.dataset.iso);
      const send = e.target.closest('[data-send]');
      if (send && picked.length) {
        send.disabled = true;
        try {
          await api('/api/moments', { method: 'POST', body: { with: person.id, kind, slots: picked, replaces } });
          close();
          toast(`Envoyé ! On attend ${person.name} 💌`);
          refresh();
        } catch (err) {
          send.disabled = false;
          toast(err.message);
        }
      }
      return undefined;
    });

    body.addEventListener('change', (e) => {
      if (e.target.type !== 'datetime-local' || !e.target.value) return;
      const d = new Date(e.target.value);
      if (Number.isNaN(d.getTime()) || d < Date.now()) return toast('Choisis un moment à venir 🙂');
      const iso = d.toISOString();
      if (!extra.includes(iso)) extra.push(iso);
      if (!picked.includes(iso)) {
        if (picked.length >= 3) picked.shift();
        picked.push(iso);
      }
      return draw();
    });

    draw();
  });
}

function momentSheet(m) {
  const k = KIND[m.kind];
  openSheet((body, close) => {
    body.innerHTML = `
      <div class="summary">
        <div class="big">${k.emoji}</div>
        <div class="when">${esc(longDate(m.at))}</div>
        <div class="tiny">${k.noun} avec ${esc(m.with?.name)} ${esc(m.with?.emoji)} · ${esc(dayWord(m.at).toLowerCase())}</div>
      </div>
      <div class="stack">
        <a class="pill white" href="/api/moments/${m.id}.ics" style="text-decoration:none">📅 Ajouter à mon calendrier</a>
        <button class="pill ghost" data-cancel>Je ne peux plus</button>
      </div>`;
    $('[data-cancel]', body).addEventListener('click', async () => {
      if (!confirm('Annuler ce moment ? On préviendra l\'autre personne.')) return;
      try {
        await api(`/api/moments/${m.id}/cancel`, { method: 'POST' });
        close();
        toast('Moment annulé. Un autre bientôt ? 💗');
        refresh();
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
      <h2>Invite quelqu'un 💌</h2>
      <p class="lead">Envoie ce lien à quelqu'un que tu aimes. Dès qu'il est ouvert, vous voilà connectés.</p>
      <button class="pill pink" data-share>Partager le lien</button>
      <p class="tiny" style="text-align:center;margin:18px 0 0">ou donne ton code</p>
      <div class="code" style="text-align:center;margin-bottom:26px">${esc(me.code)}</div>
      <form data-code-form>
        <div class="label">Quelqu'un t'a donné un code ?</div>
        <input class="field" name="code" maxlength="6" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="ABC123" style="letter-spacing:.14em;margin-bottom:10px">
        <button class="pill" type="submit">Ajouter</button>
      </form>`;
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
  const text = `${me.emoji} ${me.name} t'invite sur Pense à toi 💗`;
  if (navigator.share) {
    await navigator.share({ title: 'Pense à toi', text, url }).catch(() => {});
  } else {
    await navigator.clipboard?.writeText(`${text}\n${url}`).catch(() => {});
    toast('Lien copié 📋');
  }
}

async function acceptCode(code, quiet = false) {
  const before = state.data?.people.length || 0;
  state.data = await api('/api/connect', { method: 'POST', body: { code } });
  render();
  if (!quiet || state.data.people.length > before) {
    const added = state.data.people.length > before;
    toast(added ? 'Vous êtes connectés 💞' : 'Vous étiez déjà connectés 💞');
  }
}

async function ping(id, btn) {
  btn.classList.remove('sent');
  void btn.offsetWidth;
  btn.classList.add('sent');
  burst(btn);
  state.justSent[id] = Date.now();
  const status = $(`[data-status="${id}"]`);
  if (status) {
    status.textContent = 'Petit cœur envoyé ✓';
    status.classList.add('love');
  }
  setTimeout(() => { if (!$('.overlay:not(.out)')) render(); }, 4100);
  try {
    await api('/api/pings', { method: 'POST', body: { to: id } });
  } catch (err) {
    toast(err.message);
  }
}

function b64ToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const u8ToB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function syncPush(ask = false) {
  if (!pushSupported) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') {
    if (!ask) return 'default';
    const p = await Notification.requestPermission();
    if (p !== 'granted') return p;
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
    if (result === 'granted') toast('Notifications activées 🔔');
    else if (result === 'denied') toast('Tu pourras les activer dans Réglages 🙂');
  } catch (err) {
    toast("Impossible d'activer les notifications 🥲");
    console.error(err);
  }
  state.view = 'home';
  render();
}

async function refresh() {
  state.data = await api('/api/me');
  if (!$('.overlay:not(.out)')) render();
  return state.data;
}

// Called whenever the app comes to the foreground.
async function wakeUp() {
  if (!state.token) return;
  const data = await refresh();
  const seenAt = data.me.seenAt;
  state.fresh = new Set(data.people.filter((p) => p.pingsFromThem.some((t) => t > seenAt)).map((p) => p.id));
  if (state.fresh.size) {
    render();
    requestAnimationFrame(() => state.fresh.forEach((id) => {
      const el = $(`[data-avatar="${id}"]`);
      if (el) burst(el, 5);
    }));
    setTimeout(() => state.fresh.clear(), 5000);
  }
  if (focusMoment) {
    const el = document.getElementById(`m-${focusMoment}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    focusMoment = null;
  }
  api('/api/seen', { method: 'POST' }).catch(() => {});
  navigator.clearAppBadge?.()?.catch(() => {});
}

function cleanUrl() {
  if (location.search) history.replaceState(null, '', '/');
}

// ---------- Events ----------

app.addEventListener('click', async (e) => {
  const emoji = e.target.closest('[data-emoji]');
  if (emoji) {
    app.querySelectorAll('[data-emoji]').forEach((b) => {
      b.classList.toggle('on', b === emoji);
      b.setAttribute('aria-checked', b === emoji);
    });
    save('emoji', emoji.dataset.emoji);
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  const person = (pid) => state.data.people.find((p) => p.id === pid);
  const moment = (mid) => state.data.moments.find((m) => m.id === mid);
  try {
    switch (act) {
      case 'ping': return ping(id, btn);
      case 'propose': return proposeSheet(person(id));
      case 'counter': return proposeSheet(person(btn.dataset.person), id);
      case 'moment': return momentSheet(moment(id));
      case 'invite': return inviteSheet();
      case 'share': return shareInvite();
      case 'enable-push': return enablePush();
      case 'skip-push': state.view = 'home'; return render();
      case 'cancel':
        await api(`/api/moments/${id}/cancel`, { method: 'POST' });
        toast('Proposition annulée');
        return refresh();
      case 'accept': {
        btn.disabled = true;
        burst(btn, 9);
        await api(`/api/moments/${id}/accept`, { method: 'POST', body: { slot: btn.dataset.slot } });
        toast("C'est calé ! 💗");
        return setTimeout(refresh, 600);
      }
      default: return undefined;
    }
  } catch (err) {
    btn.disabled = false;
    toast(err.message);
    return undefined;
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
        emoji: $('.emoji.on', e.target)?.dataset.emoji,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        invite,
      },
    });
    state.token = res.token;
    save('token', res.token);
    delete res.token;
    state.data = res;
    invite = null;
    cleanUrl();
    state.view = pushSupported && Notification.permission !== 'granted' ? 'notif' : 'home';
    render();
    if (Notification.permission === 'granted') syncPush().catch(() => {});
  } catch (err) {
    submit.disabled = false;
    toast(err.message);
  }
});

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'push') refresh().catch(() => {});
  if (e.data?.type === 'open') {
    focusMoment = new URL(e.data.url, location.origin).searchParams.get('moment');
    wakeUp().catch(() => {});
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wakeUp().catch(() => {});
});
setInterval(() => {
  if (document.visibilityState === 'visible' && state.token) refresh().catch(() => {});
}, 30000);

// ---------- Boot ----------

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  render();
  if (state.token) {
    try {
      await wakeUp();
    } catch {
      if (state.token) {
        app.innerHTML = `<div class="center">${MASCOT}<h2>Pas de connexion 🥲</h2><p class="lead">On réessaie dans un instant.</p><button class="pill" onclick="location.reload()">Réessayer</button></div>`;
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
