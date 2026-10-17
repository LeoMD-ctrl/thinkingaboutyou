// "Notre ciel": a week where each of us airbrushes the moments we are free.
// Where both colors meet, a moment together is possible.

import { colorOf } from './avatar.js';

export const BANDS = [
  { key: 'matin', label: 'matin', word: 'matin', start: [9, 0], end: [12, 0] },
  { key: 'midi', label: 'midi', word: 'midi', start: [12, 0], end: [14, 0] },
  { key: 'aprem', label: 'aprèm', word: 'après-midi', start: [14, 30], end: [18, 0] },
  { key: 'soir', label: 'soir', word: 'soir', start: [19, 0], end: [22, 0] },
];
const ROW_H = 54;
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function week() {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + i);
    out.push({ key: dateKey(d), date: d, offset: i });
  }
  return out;
}

export function slotDate(slot, edge = 'start') {
  const [date, bandKey] = slot.split(':');
  const band = BANDS.find((b) => b.key === bandKey);
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = band[edge];
  return new Date(y, m - 1, d, h, min);
}

export const isPast = (slot) => slotDate(slot, 'end') < new Date();

export function slotWords(slot, { relative = true } = {}) {
  const [date, bandKey] = slot.split(':');
  const band = BANDS.find((b) => b.key === bandKey);
  const today = dateKey(new Date());
  const t = new Date();
  t.setDate(t.getDate() + 1);
  if (relative && date === today) return `${band.key === 'aprem' ? 'cet' : 'ce'} ${band.word}`;
  if (relative && date === dateKey(t)) return `demain ${band.word}`;
  const day = slotDate(slot).toLocaleDateString('fr-FR', { weekday: 'long' });
  return `${day} ${band.word}`;
}

function mix(a, b) {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [hex(a), hex(b)];
  return `#${x.map((v, i) => pad(Math.round((v * y[i]) / 255 * 0.92).toString(16))).join('')}`;
}

/**
 * Paintable sky. Calls onChange(cells) after each stroke.
 */
export function mountSky(el, { mine, theirs, meColor, themColor, onChange }) {
  const days = week();
  let cells = new Set(mine.filter((s) => !isPast(s)));
  const other = new Set(theirs);
  const me = colorOf(meColor);
  const them = colorOf(themColor);
  const both = mix(me.body, them.body);

  el.innerHTML = `
    <div class="sky-head"><span></span>${BANDS.map((b) => `<span>${b.label}</span>`).join('')}</div>
    <div class="sky-body">
      <div class="sky-days">${days.map((d) => `<div>${d.offset === 0 ? 'auj.' : d.date.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}<small>${d.date.getDate()}</small></div>`).join('')}</div>
      <div class="sky-paint"><svg></svg></div>
    </div>`;
  const paint = el.querySelector('.sky-paint');
  const svg = paint.querySelector('svg');

  function draw() {
    const W = paint.clientWidth || 280;
    const cw = W / BANDS.length;
    const H = ROW_H * days.length;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    const blob = (slot, fill, scale = 1) => {
      const [date, band] = slot.split(':');
      const row = days.findIndex((d) => d.key === date);
      const col = BANDS.findIndex((b) => b.key === band);
      if (row < 0 || col < 0) return '';
      return `<ellipse cx="${(col + 0.5) * cw}" cy="${(row + 0.5) * ROW_H}" rx="${cw * 0.68 * scale}" ry="${ROW_H * 0.72 * scale}" fill="${fill}"/>`;
    };
    const shared = [...cells].filter((s) => other.has(s));
    const grid = [];
    for (let r = 0; r < days.length; r++) {
      for (let c = 0; c < BANDS.length; c++) {
        const slot = `${days[r].key}:${BANDS[c].key}`;
        grid.push(`<circle cx="${(c + 0.5) * cw}" cy="${(r + 0.5) * ROW_H}" r="2.4" fill="${isPast(slot) ? '#EADBCF' : '#D9C5B5'}"/>`);
      }
    }
    svg.innerHTML = `
      <defs>
        <radialGradient id="spray-me"><stop offset=".15" stop-color="${me.shade}" stop-opacity=".95"/><stop offset="1" stop-color="${me.shade}" stop-opacity="0"/></radialGradient>
        <radialGradient id="spray-them"><stop offset=".15" stop-color="${them.shade}" stop-opacity=".95"/><stop offset="1" stop-color="${them.shade}" stop-opacity="0"/></radialGradient>
        <radialGradient id="spray-both"><stop offset=".2" stop-color="${both}" stop-opacity="1"/><stop offset="1" stop-color="${both}" stop-opacity="0"/></radialGradient>
      </defs>
      ${grid.join('')}
      <g filter="url(#grain)" opacity=".85">${[...other].map((s) => blob(s, 'url(#spray-them)')).join('')}</g>
      <g filter="url(#grain)">${[...cells].map((s) => blob(s, 'url(#spray-me)')).join('')}</g>
      <g filter="url(#grain)">${shared.map((s) => blob(s, 'url(#spray-both)', 0.9)).join('')}</g>
      ${shared.map((s) => {
        const [date, band] = s.split(':');
        const x = (BANDS.findIndex((b) => b.key === band) + 0.5) * cw;
        const y = (days.findIndex((d) => d.key === date) + 0.5) * ROW_H;
        return `<path d="M${x} ${y + 6}c-7-5-10-8-10-12a5 5 0 0 1 10-2 5 5 0 0 1 10 2c0 4-3 7-10 12z" fill="#FFF8F0"/>`;
      }).join('')}`;
  }

  function slotAt(e) {
    const r = paint.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * BANDS.length);
    const row = Math.floor((e.clientY - r.top) / ROW_H);
    if (col < 0 || col >= BANDS.length || row < 0 || row >= days.length) return null;
    const slot = `${days[row].key}:${BANDS[col].key}`;
    return isPast(slot) ? null : slot;
  }

  let mode = null;
  let changed = false;
  const apply = (slot) => {
    if (!slot) return;
    const has = cells.has(slot);
    if (mode === 'paint' && !has) { cells.add(slot); changed = true; draw(); }
    if (mode === 'erase' && has) { cells.delete(slot); changed = true; draw(); }
  };
  paint.addEventListener('pointerdown', (e) => {
    const slot = slotAt(e);
    if (!slot) return;
    mode = cells.has(slot) ? 'erase' : 'paint';
    changed = false;
    paint.setPointerCapture(e.pointerId);
    apply(slot);
  });
  paint.addEventListener('pointermove', (e) => { if (mode) apply(slotAt(e)); });
  const end = () => {
    if (!mode) return;
    mode = null;
    if (changed) onChange([...cells].sort());
  };
  paint.addEventListener('pointerup', end);
  paint.addEventListener('pointercancel', end);

  requestAnimationFrame(draw);
  return {
    shared: () => [...cells].filter((s) => other.has(s) && !isPast(s)).sort(),
    update(next) {
      other.clear();
      next.theirs.forEach((s) => other.add(s));
      draw();
    },
  };
}
