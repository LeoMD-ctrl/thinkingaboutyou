// The little beings: flat pastel bodies, airbrushed (stippled) shading.

export const COLORS = {
  rose: { body: '#F7C6CF', shade: '#E3909F' },
  ciel: { body: '#C7E2EE', shade: '#8DBCD3' },
  menthe: { body: '#C9E8D3', shade: '#90C5A3' },
  miel: { body: '#F7E2A8', shade: '#DCB664' },
  lilas: { body: '#DCD2F3', shade: '#A997D9' },
  peche: { body: '#F8D2BC', shade: '#E39C7A' },
};
export const colorOf = (key) => COLORS[key] || COLORS.rose;

// One shared filter turns any soft gradient into airbrush grain: the more opaque
// the gradient, the denser the dots.
export function installGrain() {
  if (document.getElementById('grain')) return;
  document.body.insertAdjacentHTML('afterbegin', `
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs>
      <filter id="grain" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.6 0 0 0 -0.3" result="na"/>
        <feComposite in="SourceAlpha" in2="na" operator="arithmetic" k1="0" k2="1" k3="1" k4="-0.55" result="sum"/>
        <feComponentTransfer in="sum" result="dots"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>
        <feComposite in="SourceGraphic" in2="dots" operator="in" result="col"/>
        <feComponentTransfer in="col"><feFuncA type="linear" slope="999"/></feComponentTransfer>
      </filter>
      <radialGradient id="floor-shadow"><stop offset="0" stop-color="#6B5560" stop-opacity=".75"/><stop offset="1" stop-color="#6B5560" stop-opacity="0"/></radialGradient>
    </defs>
  </svg>`);
}

const BODY = 'M70 50c32 0 52 32 52 62 0 27-21 42-52 42S18 139 18 112c0-30 20-62 52-62z';

function limbs(fill) {
  return `
    <ellipse cx="52" cy="152" rx="12" ry="8" fill="${fill}"/><ellipse cx="88" cy="152" rx="12" ry="8" fill="${fill}"/>
    <ellipse cx="21" cy="106" rx="10" ry="20" fill="${fill}" transform="rotate(16 21 106)"/>
    <ellipse cx="119" cy="106" rx="10" ry="20" fill="${fill}" transform="rotate(-16 119 106)"/>
    <path d="${BODY}" fill="${fill}"/>`;
}

/**
 * @param {string} color  key of COLORS
 * @param {object} [o]
 * @param {'calm'|'happy'} [o.mood]
 * @param {boolean} [o.ghost]  dashed outline placeholder (an empty spot)
 */
export function avatarSVG(color, { mood = 'calm', ghost = false } = {}) {
  if (ghost) {
    return `
    <svg class="being-svg" viewBox="0 0 140 170" aria-hidden="true">
      <g fill="none" stroke="#D9C3B3" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round">
        <path d="${BODY}"/><ellipse cx="70" cy="50" rx="34" ry="26"/>
      </g>
      <path d="M70 92v28M56 106h28" stroke="#C9AE9C" stroke-width="5" stroke-linecap="round"/>
    </svg>`;
  }
  const c = colorOf(color);
  const g = `sh-${color}`;
  const eyes = mood === 'happy'
    ? '<path d="M53 52q5-6 10 0M77 52q5-6 10 0" stroke="#3B3340" stroke-width="3.6" fill="none" stroke-linecap="round"/>'
    : '<circle cx="58" cy="50" r="4"/><circle cx="82" cy="50" r="4"/><rect x="58" y="49" width="24" height="2" rx="1"/>';
  return `
  <svg class="being-svg" viewBox="0 0 140 170" aria-hidden="true">
    <defs>
      <radialGradient id="${g}" gradientUnits="userSpaceOnUse" cx="50" cy="52" r="122">
        <stop offset=".45" stop-color="${c.shade}" stop-opacity="0"/><stop offset=".9" stop-color="${c.shade}" stop-opacity="1"/>
      </radialGradient>
      <radialGradient id="${g}-head" gradientUnits="userSpaceOnUse" cx="60" cy="40" r="44">
        <stop offset=".55" stop-color="${c.shade}" stop-opacity="0"/><stop offset="1" stop-color="${c.shade}" stop-opacity=".8"/>
      </radialGradient>
      <radialGradient id="${g}-neck"><stop offset="0" stop-color="${c.shade}" stop-opacity=".7"/><stop offset="1" stop-color="${c.shade}" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="floor" cx="70" cy="161" rx="52" ry="9" fill="url(#floor-shadow)" filter="url(#grain)" opacity=".4"/>
    <g class="bod">
      <g>${limbs(c.body)}</g>
      <g filter="url(#grain)">${limbs(`url(#${g})`)}<ellipse cx="72" cy="74" rx="30" ry="9" fill="url(#${g}-neck)"/></g>
      <g class="head">
        <ellipse cx="70" cy="50" rx="34" ry="26" fill="${c.body}"/>
        <ellipse cx="70" cy="50" rx="34" ry="26" fill="url(#${g}-head)" filter="url(#grain)"/>
        <g class="eyes" fill="#3B3340">${eyes}</g>
      </g>
    </g>
  </svg>`;
}
