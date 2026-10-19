// The lake, drawn as flat pastel shapes with airbrushed (stippled) shading and a
// tilt-shift focus: blurry sky and foreground, sharp far shore.
// Each phase of the day is rendered once into an image so crossfading stays cheap.

export const W = 390;
export const H = 844;

export const PHASES = {
  morning: {
    skyTop: '#9FC1EC', skyMid: '#FAD2CF', skyLow: '#FFE7B5', sun: '#FFF7DC', sunHalo: '#FFE3AE',
    cloud: '#FFF8F1', cloudShade: '#F1BFCB', far: '#B9C2EE', farShade: '#8D98D8',
    hill: '#A9DEC0', hillShade: '#74BD9A', lake: '#98CFE4', lakeShade: '#64A6C8', ripple: '#CFEDF6',
    meadow: '#BFE3B0', meadowShade: '#86C38A', barn: '#F3B4A9', cart: '#F7D98F', wood: '#D6A07C', woodShade: '#A9714F',
    scale: '#3E6679', scale2: '#30576B', wall: '#FFF6EE', roof: '#3E6679', light: '#FFD36E', lit: 0.45, stars: false,
  },
  day: {
    skyTop: '#86BDEE', skyMid: '#C6E3F5', skyLow: '#FFF0CF', sun: '#FFFBEA', sunHalo: '#FFF0BF',
    cloud: '#FFFFFF', cloudShade: '#C3D3F0', far: '#AFC3EC', farShade: '#7F9AD3',
    hill: '#A5DDB4', hillShade: '#6CBD8C', lake: '#84C9E4', lakeShade: '#4C9EC4', ripple: '#CBF0F8',
    meadow: '#B5E2A3', meadowShade: '#79BE7E', barn: '#F4B1A4', cart: '#F8DA8E', wood: '#D7A27C', woodShade: '#A6704E',
    scale: '#3A6B76', scale2: '#2D5B66', wall: '#FFFFFF', roof: '#3A6B76', light: '#FFD36E', lit: 0.3, stars: false,
  },
  dusk: {
    skyTop: '#A99BE6', skyMid: '#F4BFD0', skyLow: '#FFD9A8', sun: '#FFF1C6', sunHalo: '#FFE2A0',
    cloud: '#FFF3EA', cloudShade: '#E8B9CF', far: '#B9A9E8', farShade: '#8F7FD0',
    hill: '#9FD6C0', hillShade: '#6DB59C', lake: '#8EC6DD', lakeShade: '#5E9FC0', ripple: '#BFE3EF',
    meadow: '#A9D5A2', meadowShade: '#76AE86', barn: '#E8A2A6', cart: '#EFC68E', wood: '#C98F6E', woodShade: '#9A6249',
    scale: '#355A6E', scale2: '#2A4A5E', wall: '#FFF3EA', roof: '#355A6E', light: '#FFD36E', lit: 0.85, stars: false,
  },
  night: {
    skyTop: '#2E2F63', skyMid: '#5B4F8E', skyLow: '#B987B8', sun: '#FFF4D6', sunHalo: '#C9B8F0',
    cloud: '#7E74B4', cloudShade: '#4E4689', far: '#4A4A8A', farShade: '#33336B',
    hill: '#3F6E78', hillShade: '#2B4F5B', lake: '#3E5C8E', lakeShade: '#2A4170', ripple: '#6F8FC4',
    meadow: '#4E7069', meadowShade: '#36524F', barn: '#7E6A9A', cart: '#8F80A8', wood: '#6E5584', woodShade: '#4A3962',
    scale: '#1E2E45', scale2: '#162236', wall: '#9C93C8', roof: '#1E2E45', light: '#FFD36E', lit: 1, stars: true,
  },
};

// The countryside: where the people you love live, from the nearest hill to the farthest.
// (x, y) is where the place stands, s its size (smaller when farther away).
export const PLACES = [
  { type: 'maison', the: 'la maison', x: 318, y: 468, s: 1 },
  { type: 'moulin', the: 'le moulin', x: 100, y: 490, s: 1 },
  { type: 'ferme', the: 'la ferme', x: 216, y: 476, s: 0.8 },
  { type: 'roulotte', the: 'la roulotte', x: 366, y: 488, s: 0.9 },
  { type: 'cabane', the: 'la cabane dans l’arbre', x: 34, y: 494, s: 1 },
  { type: 'pigeonnier', the: 'le pigeonnier', x: 160, y: 466, s: 0.7 },
];

// One vanishing point in the middle of the horizon: everything lying on the
// water converges toward it, and gets smaller and denser as it goes far.
export const HORIZON = 488;
export const VANISH = { x: 195, y: HORIZON };
export const depth = (y) => y - HORIZON;
// Screen x of a point on the water plane, `u` units to the side of the vanishing line.
export const onPlane = (u, y) => VANISH.x + u * depth(y);
// Scale of a thing standing on the water at row y (1 at the middle of the lake).
export const scaleAt = (y) => depth(y) / 72;

const DOCK_NEAR = 730;
const DOCK_FAR = 572;
const DOCK_AXIS = 0.14; // a little right of the vanishing point, so its left flank shows
const DOCK_HALF = 0.19;
export const DOCK = { x: onPlane(DOCK_AXIS, DOCK_FAR), y: DOCK_FAR + 2 };
export const LAKE_CENTER = { x: 195, y: 560 };

const GRAIN = `
  <filter id="grain" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.6 0 0 0 -0.3" result="na"/>
    <feComposite in="SourceAlpha" in2="na" operator="arithmetic" k1="0" k2="1" k3="1" k4="-0.55" result="sum"/>
    <feComponentTransfer in="sum" result="dots"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>
    <feComposite in="SourceGraphic" in2="dots" operator="in" result="col"/>
    <feComponentTransfer in="col"><feFuncA type="linear" slope="999"/></feComponentTransfer>
  </filter>`;
const blur = (id, sd) => `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

// A flat shape and its stippled shade, drawn twice.
const shaded = (d, fill, shade) => `<path d="${d}" fill="${fill}"/><path d="${d}" fill="${shade}" filter="url(#grain)"/>`;

const wrap = (inner, defs) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
  <defs>${GRAIN}${blur('b-sky', 2.4)}${blur('b-far', 0.7)}${blur('b-near', 1.3)}${blur('b-fore', 4.5)}${defs}</defs>${inner}</svg>`;

// Clouds drift, so each one is its own little image (with its own grain and blur).
export const CLOUDS = [
  { d: 'M40 210a26 26 0 0 1 40-22 34 34 0 0 1 62 6 22 22 0 0 1 20 36H44a20 20 0 0 1-4-20z', box: [26, 160, 150, 86] },
  { d: 'M250 300a20 20 0 0 1 32-16 28 28 0 0 1 50 8 18 18 0 0 1 14 28h-92a16 16 0 0 1-4-20z', box: [236, 268, 124, 66] },
  { d: 'M282 118a14 14 0 0 1 22-10 20 20 0 0 1 36 6 12 12 0 0 1 8 20h-64a11 11 0 0 1-2-16z', box: [268, 92, 92, 50] },
];

export function cloudSVG(c, i) {
  const { d, box } = CLOUDS[i];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(' ')}" width="${box[2]}" height="${box[3]}">
    <defs>${GRAIN}${blur('b-sky', 2.4)}
      <linearGradient id="cloudSh" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="${c.cloudShade}" stop-opacity="0"/><stop offset="1" stop-color="${c.cloudShade}"/></linearGradient></defs>
    <g filter="url(#b-sky)">${shaded(d, c.cloud, 'url(#cloudSh)')}</g></svg>`;
}

// Sky: behind the sun.
export function backSVG(c) {
  const stars = c.stars ? Array.from({ length: 46 }, (_, i) => {
    const x = (i * 97 + 13) % W;
    const y = 24 + ((i * 53) % 360);
    return `<circle cx="${x}" cy="${y}" r="${i % 5 === 0 ? 1.9 : 1.1}" fill="#FFF4D6" opacity="${0.45 + (i % 3) * 0.2}"/>`;
  }).join('') : '';
  return wrap(`
    <rect width="${W}" height="${H}" fill="${c.skyMid}"/>
    <rect width="${W}" height="${H}" fill="url(#sky1)" filter="url(#grain)"/>
    <rect width="${W}" height="${H}" fill="url(#sky2)" filter="url(#grain)"/>
    <g filter="url(#b-sky)">${stars}</g>`,
  `<linearGradient id="sky1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.skyTop}"/><stop offset=".55" stop-color="${c.skyTop}" stop-opacity="0"/></linearGradient>
   <radialGradient id="sky2" cx="55%" cy="56%" r="58%"><stop offset="0" stop-color="${c.skyLow}"/><stop offset="1" stop-color="${c.skyLow}" stop-opacity="0"/></radialGradient>`);
}

function scallops(y, r, fill, off) {
  let d = `M0 ${H} L0 ${y}`;
  for (let x = -r + off; x < W + r; x += r * 2) d += ` A${r} ${r} 0 0 1 ${x + 2 * r} ${y}`;
  return `<path d="${d} L${W} ${H} Z" fill="${fill}"/>`;
}

const LAKE = 'M0 500 C80 488 300 488 390 500 L390 640 L0 640Z';
const SHORE = 'M0 640 C70 618 150 612 220 628 C290 644 340 630 390 618 L390 770 L0 770Z';

// Your dock, drawn in perspective: its edges run toward the vanishing point,
// planks are evenly spaced in depth (so they bunch up far away), posts shrink.
function dock(c) {
  const L = (y) => onPlane(DOCK_AXIS - DOCK_HALF, y);
  const R = (y) => onPlane(DOCK_AXIS + DOCK_HALF, y);
  const thick = (y) => 0.06 * depth(y);
  const [n, f] = [DOCK_NEAR, DOCK_FAR];
  const rowAt = (k) => HORIZON + 1 / (1 / depth(n) + (1 / depth(f) - 1 / depth(n)) * k);
  const posts = [];
  const planks = [];
  for (let i = 0; i <= 8; i++) {
    const y = rowAt(i / 8);
    if (i > 0 && i < 8) planks.push(`<path d="M${L(y)} ${y}H${R(y)}" stroke="${c.woodShade}" stroke-width="${0.014 * depth(y)}" opacity=".55"/>`);
    if (i % 2 === 0) {
      const h = 0.13 * depth(y);
      const w = 0.035 * depth(y);
      for (const x of [L(y) + w / 2, R(y) - w / 2]) posts.push(`<rect x="${x - w / 2}" y="${y}" width="${w}" height="${thick(y) + h}" rx="${w / 3}" fill="${c.woodShade}"/>`);
    }
  }
  const shadow = `M${L(f)} ${f + thick(f)} L${R(f)} ${f + thick(f)} L${R(n) + 14} ${n + thick(n) + 10} L${L(n) + 14} ${n + thick(n) + 10}Z`;
  return {
    under: `<path d="${shadow}" fill="${c.lakeShade}" opacity=".35"/>${posts.join('')}`,
    top: `
      <path d="M${L(n)} ${n} L${L(f)} ${f} L${L(f)} ${f + thick(f)} L${L(n)} ${n + thick(n)}Z" fill="${c.woodShade}"/>
      <path d="M${L(n)} ${n} H${R(n)} V${n + thick(n)} H${L(n)}Z" fill="${c.woodShade}"/>
      <path d="M${L(n)} ${n} L${R(n)} ${n} L${R(f)} ${f} L${L(f)} ${f}Z" fill="${c.wood}"/>
      <path d="M${L(n)} ${n} L${R(n)} ${n} L${R(f)} ${f} L${L(f)} ${f}Z" fill="url(#deckSh)" filter="url(#grain)"/>
      ${planks.join('')}`,
  };
}

// Hills, lake, your shore and dock, the blurry foreground: in front of the sun.
export function frontSVG(c) {
  const pier = dock(c);
  const rings = [18, 40, 66, 96, 130, 168]
    .map((r) => `<ellipse cx="${LAKE_CENTER.x}" cy="${LAKE_CENTER.y}" rx="${r * 1.8}" ry="${r * 0.42}" opacity="${1 - r / 220}"/>`).join('');
  return wrap(`
    <g filter="url(#b-far)">${shaded('M0 470 C40 430 90 420 140 445 C190 470 220 430 270 420 C320 410 360 440 390 455 L390 520 L0 520Z', c.far, 'url(#farSh)')}</g>
    ${shaded('M0 515 C50 470 120 470 170 505 L170 540 L0 540Z', c.hill, 'url(#hillSh)')}
    ${shaded('M220 505 C270 455 340 450 390 480 L390 540 L220 540Z', c.hill, 'url(#hillSh)')}
    ${shaded(LAKE, c.lake, 'url(#lakeSh)')}
    <g clip-path="url(#lakeClip)" fill="none" stroke="${c.ripple}" stroke-width="3">${rings}</g>
    ${pier.under}
    <g filter="url(#b-near)">${shaded(SHORE, c.meadow, 'url(#meadowSh)')}</g>
    <g filter="url(#b-dock)">${pier.top}</g>
    <g filter="url(#b-fore)">${scallops(742, 30, c.scale, 0)}${scallops(782, 30, c.scale2, 30)}</g>`,
  `<linearGradient id="farSh" x1="0" y1="0" x2="1" y2="1"><stop offset=".3" stop-color="${c.farShade}" stop-opacity="0"/><stop offset="1" stop-color="${c.farShade}"/></linearGradient>
   <linearGradient id="hillSh" x1="0" y1="0" x2=".6" y2="1"><stop offset=".25" stop-color="${c.hillShade}" stop-opacity="0"/><stop offset="1" stop-color="${c.hillShade}"/></linearGradient>
   <linearGradient id="lakeSh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.lakeShade}" stop-opacity=".9"/><stop offset=".5" stop-color="${c.lakeShade}" stop-opacity="0"/></linearGradient>
   <linearGradient id="meadowSh" x1="0" y1="0" x2="0" y2="1"><stop offset=".2" stop-color="${c.meadowShade}" stop-opacity="0"/><stop offset="1" stop-color="${c.meadowShade}"/></linearGradient>
   <linearGradient id="deckSh" x1="0" y1="1" x2="0" y2="0"><stop offset=".35" stop-color="${c.woodShade}" stop-opacity="0"/><stop offset="1" stop-color="${c.woodShade}" stop-opacity=".9"/></linearGradient>
   ${blur('b-dock', 0.5)}
   <clipPath id="lakeClip"><path d="${LAKE}"/></clipPath>`);
}

// ---------- Places (drawn live, crisp, in the focus band) ----------

// Each home is drawn around its base (0, 0) at size 1. `win` is where its light shines,
// `smoke` where its chimney is, both in the same local units.
const HOMES = {
  maison: (c) => ({
    win: [0, -11], smoke: [10, -38],
    svg: `<rect x="-15" y="-22" width="30" height="22" rx="4" fill="${c.wall}"/>
      <rect x="7" y="-37" width="6" height="12" rx="1.5" fill="${c.roof}"/>
      <path d="M-20 -19 L0 -38 L20 -19Z" fill="${c.roof}" stroke="${c.roof}" stroke-width="5" stroke-linejoin="round"/>
      <rect x="-5" y="-15" width="10" height="9" rx="2" fill="${c.light}"/>`,
  }),
  moulin: (c) => ({
    win: [0, -15],
    svg: `<path d="M-11 0 L-8 -26 L8 -26 L11 0Z" fill="${c.wall}"/>
      <path d="M-10 -26 Q0 -38 10 -26Z" fill="${c.roof}"/>
      <rect x="-3.5" y="-19" width="7" height="8" rx="2" fill="${c.light}"/>
      <g class="sails"><path d="M0 -30 L-4 -56 L4 -56Z M0 -30 L26 -34 L26 -26Z M0 -30 L4 -4 L-4 -4Z M0 -30 L-26 -26 L-26 -34Z" fill="${c.cloudShade}" opacity=".95"/></g>
      <circle cx="0" cy="-30" r="2.6" fill="${c.roof}"/>`,
  }),
  ferme: (c) => ({
    win: [0, -27],
    svg: `<rect x="17" y="-30" width="11" height="30" rx="5.5" fill="${c.wall}"/><path d="M17 -29 Q22.5 -38 28 -29Z" fill="${c.roof}"/>
      <path d="M-22 0 V-22 L-12 -32 H12 L22 -22 V0Z" fill="${c.barn}"/>
      <path d="M-25 -21 L-12 -35 H12 L25 -21" fill="none" stroke="${c.roof}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
      <rect x="-7" y="-14" width="14" height="14" rx="1.5" fill="${c.wall}"/><path d="M-7 -14 L7 0 M7 -14 L-7 0" stroke="${c.barn}" stroke-width="1.6"/>
      <circle cx="0" cy="-24" r="3.4" fill="${c.light}"/>`,
  }),
  roulotte: (c) => ({
    win: [-2, -16], smoke: [10, -32],
    svg: `<rect x="8.5" y="-31" width="3" height="8" rx="1" fill="${c.roof}"/>
      <path d="M-17 -6 V-20 Q-17 -29 0 -29 Q17 -29 17 -20 V-6Z" fill="${c.cart}"/>
      <path d="M-19 -21 Q0 -34 19 -21" fill="none" stroke="${c.roof}" stroke-width="3.6" stroke-linecap="round"/>
      <rect x="-7" y="-20" width="10" height="8" rx="4" fill="${c.light}"/>
      <path d="M17 -9 L26 -4" stroke="${c.woodShade}" stroke-width="2" stroke-linecap="round"/>
      <circle cx="-9" cy="-4" r="4.6" fill="none" stroke="${c.woodShade}" stroke-width="2.2"/><circle cx="9" cy="-4" r="4.6" fill="none" stroke="${c.woodShade}" stroke-width="2.2"/>`,
  }),
  cabane: (c) => ({
    win: [1, -38],
    svg: `<path d="M-4 0 Q-2 -30 -3 -60 L4 -60 Q3 -30 5 0Z" fill="${c.woodShade}"/>
      <circle cx="-14" cy="-62" r="15" fill="${c.hillShade}"/><circle cx="12" cy="-66" r="16" fill="${c.hillShade}"/><circle cx="0" cy="-76" r="14" fill="${c.hill}"/>
      <path d="M-11 -30 V-44 L1 -53 L13 -44 V-30Z" fill="${c.wood}"/>
      <path d="M-14 -43 L1 -56 L16 -43" fill="none" stroke="${c.roof}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="-3" y="-42" width="8" height="7" rx="2" fill="${c.light}"/>
      <path d="M-13 -30 H15" stroke="${c.woodShade}" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M-8 -30 V-6 M-4 -30 V-6 M-8 -24 H-4 M-8 -18 H-4 M-8 -12 H-4" stroke="${c.woodShade}" stroke-width="1.3"/>`,
  }),
  pigeonnier: (c) => ({
    win: [0, -20],
    svg: `<rect x="-10" y="-30" width="20" height="30" rx="3" fill="${c.wall}"/>
      <path d="M-14 -28 L0 -46 L14 -28Z" fill="${c.roof}" stroke="${c.roof}" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="0" cy="-49" r="2.4" fill="${c.roof}"/>
      <rect x="-3.6" y="-24" width="7.2" height="8" rx="3.6" fill="${c.light}"/>
      <path d="M-6 -11 H6" stroke="${c.wood}" stroke-width="2" stroke-linecap="round"/>
      <path d="M-2 -50 q2 -4 5 -2 q2 1 3 0 l-1 3 q-4 2 -7 -1z" fill="${c.cloud}"/>`,
  }),
};

const home = (place, c) => HOMES[place.type](c);
// Where a place's light and smoke are, on the screen.
export function windowOf(place, c = PHASES.day) {
  const [dx, dy] = home(place, c).win;
  return [place.x + dx * place.s, place.y + dy * place.s];
}
export function smokeOf(place, c = PHASES.day) {
  const h = home(place, c);
  return h.smoke ? [place.x + h.smoke[0] * place.s, place.y + h.smoke[1] * place.s] : null;
}

export function placeSVG(place, c) {
  return `<g transform="translate(${place.x} ${place.y}) scale(${place.s})">${home(place, c).svg}</g>`;
}

// An empty spot waiting for someone: a little sign planted in the grass.
export function plotSVG(place, c) {
  return `<g transform="translate(${place.x} ${place.y}) scale(${place.s})">
    <rect x="-1.8" y="-22" width="3.6" height="22" rx="1.5" fill="${c.woodShade}"/>
    <rect x="-13" y="-30" width="26" height="15" rx="4" fill="${c.wood}"/>
    <path d="M0 -26.5v8M-4 -22.5h8" stroke="${c.wall}" stroke-width="2.4" stroke-linecap="round"/></g>`;
}

// Soft airbrushed glow, generated once per color as a bitmap.
const spriteCache = new Map();
export function glowSprite(hex, size = 160) {
  const key = `${hex}-${size}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const half = size / 2;
  for (let yy = 0; yy < size; yy++) {
    for (let xx = 0; xx < size; xx++) {
      const d = Math.hypot(xx - half, yy - half) / half;
      const a = Math.max(0, 1 - d) ** 1.7;
      if (Math.random() < a) {
        const k = (yy * size + xx) * 4;
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  spriteCache.set(key, url);
  return url;
}
