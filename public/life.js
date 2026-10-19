// Little lives in the countryside: ducks, a frog, fish, birds, fireflies, sheep,
// butterflies, a cat asleep on the dock, a cherry tree losing its petals, a field
// of flowers, trees and reeds in the wind, glints on the water. Most can be touched.

import { PHASES, scaleAt, onPlane, glowSprite, farSurface, midSurface } from './scene.js';

const NS = 'http://www.w3.org/2000/svg';
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (n) => Array.from({ length: n }, (_, i) => i);

// [x, y, scale]: trees get smaller as they sit higher on the hills (further away).
// Trees stand on the terrain: small ones on the far ridge, bigger ones on the green hills.
const TREES = [
  ...[[60, 0.34], [172, 0.3], [238, 0.34], [300, 0.34]].map(([x, s]) => [x, farSurface(x) + 4 * s, s, true]),
  ...[[124, 0.52], [262, 0.62]].map(([x, s]) => [x, midSurface(x) + 4 * s, s, false]),
];
const SHEEP_HOMES = [[58, 694], [104, 708], [146, 686]];
const CAT = { x: onPlane(0.14, 652), y: 652 };
const FLOWER_COLORS = ['#FFD1DC', '#FFF3B0', '#D9C8FF', '#FFFFFF', '#FFC8A2'];
const hash = (i, k) => Math.abs(Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1;
const PADS = [[66, 606], [104, 597], [40, 594]];
const DUCK_Y = 548;

function frag(parent, markup) {
  const g = document.createElementNS(NS, 'g');
  g.innerHTML = markup;
  parent.appendChild(g);
  return g;
}

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

/**
 * @param {object} o
 * @param {SVGGElement} o.back   behind the homes (trees, birds)
 * @param {SVGGElement} o.water  on the lake (glints, lily pads, frog, ducks, fish)
 * @param {SVGGElement} o.front  in front of everything (reeds, fireflies)
 * @param {(x:number, y:number, size?:number) => void} o.ripple
 * @param {(x:number, y:number, text:string) => void} o.say
 */
export function createLife({ back, water, front, ripple, say }) {
  let phase = null;
  let c = PHASES.day;
  let raf = 0;
  let last = performance.now();
  let frogPad = 0;
  let frogBusy = false;
  let nextFish = performance.now() + rand(4000, 9000);
  let nextBirds = performance.now() + rand(3000, 8000);
  const birds = [];
  const sheep = SHEEP_HOMES.map(([x, y], i) => ({ home: x, x, y, dir: i % 2 ? -1 : 1, t: i * 4000 }));
  const flies = [0, 1, 2].map((i) => ({ hx: [60, 300, 140][i], hy: [650, 668, 640][i], t: i * 3000, a: 0.0007 + i * 0.0002, b: 0.0013 + i * 0.0003, x: 0, y: 0 }));

  // The duck family: a mother and three ducklings following her.
  const ducks = [
    { x: 150, y: DUCK_Y, dir: 1, size: 1.3 },
    { x: 126, y: DUCK_Y + 3, dir: 1, size: 0.7 },
    { x: 110, y: DUCK_Y + 1, dir: 1, size: 0.7 },
    { x: 94, y: DUCK_Y + 4, dir: 1, size: 0.7 },
  ];

  const tree = ([x, y, s, far], i) => {
    return `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cy="0" rx="13" ry="2.6" fill="${far ? c.farShade : c.hillShade}" opacity=".6"/><g class="sway" style="animation-delay:-${i * 0.7}s">
      <rect x="-2.5" y="-16" width="5" height="17" rx="2" fill="${c.woodShade}"/>
      <circle cx="0" cy="-27" r="14" fill="${far ? c.farShade : c.hillShade}"/>
      <circle cx="-5" cy="-31" r="7" fill="${far ? c.far : c.hill}" opacity=".7"/></g></g>`;
  };

  const reeds = (x, y, s, mirror) => `<g transform="translate(${x} ${y}) scale(${mirror ? -s : s} ${s})">${pick(5).map((i) => {
    const dx = (i - 2) * 5 + 4;
    const h = 46 + ((i * 17) % 22);
    const head = i % 2 === 0 ? `<ellipse cx="${dx * 1.15}" cy="${-h + 4}" rx="3.2" ry="8" fill="${c.woodShade}"/>` : '';
    return `<g class="sway reed" style="animation-delay:-${i * 0.9}s"><path d="M${(i - 2) * 3} 0 Q${dx * 0.4} ${-h / 2} ${dx * 1.15} ${-h}" stroke="${c.scale}" stroke-width="3.4" fill="none" stroke-linecap="round"/>${head}</g>`;
  }).join('')}</g>`;

  const glints = () => pick(12).map((i) => {
    const y = 505 + ((i * 37) % 120);
    const s = scaleAt(y);
    const x = 20 + ((i * 89) % 350);
    return `<rect class="glint" x="${x}" y="${y}" width="${(8 + (i % 4) * 4) * s}" height="${1.6 * s}" rx="${s}" fill="${c.ripple}" style="animation-delay:-${(i * 1.3) % 6}s;animation-duration:${4 + (i % 3)}s"/>`;
  }).join('');

  const pads = () => PADS.map(([x, y], i) => {
    const s = scaleAt(y) * 0.8;
    return `<g transform="translate(${x} ${y}) scale(${s})"><ellipse rx="12" ry="3.8" fill="${c.hillShade}"/><path d="M0 0 L11 -2.2 L11 2.2Z" fill="${c.lake}"/>${i === 1 ? `<circle cx="-4" cy="-2" r="2.4" fill="#FFD3E2"/>` : ''}</g>`;
  }).join('');

  const frogMarkup = () => {
    const [x, y] = PADS[frogPad];
    const s = scaleAt(y) * 0.8;
    const body = phase === 'night' ? '#4E7F64' : '#8CCB79';
    return `<g class="frog" data-frog transform="translate(${x} ${y - 1}) scale(${s})">
      <ellipse cy="-3" rx="6" ry="4.2" fill="${body}"/>
      <circle cx="-3" cy="-7" r="2.5" fill="${body}"/><circle cx="3" cy="-7" r="2.5" fill="${body}"/>
      <circle cx="-3" cy="-7.4" r="1.1" fill="#2F3550"/><circle cx="3" cy="-7.4" r="1.1" fill="#2F3550"/>
      <circle cy="-4" r="16" fill-opacity="0" pointer-events="all"/></g>`;
  };

  const duckMarkup = (d, i) => {
    const mom = d.size > 1;
    const body = mom ? '#FFF8EE' : '#FFE08A';
    const wing = mom ? '#E9DDD0' : '#F3C75A';
    return `<g class="duck" data-duck="${i}"><g class="flip"><g class="hop"><g class="bob" style="animation-delay:-${i * 0.6}s">
      <path d="M-16 2 L-27 5 M-16 -0.5 L-29 -0.5" stroke="${c.ripple}" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>
      <path d="M-11 -4 Q-15 -12 -7 -10 Q-2 -12 4 -9 Q10 -8 11 -3 Q11 0 6 1 L-7 1 Q-11 0 -11 -4Z" fill="${body}"/>
      <circle cx="7" cy="-13" r="4.6" fill="${body}"/>
      <path d="M11 -13.6 L16 -12.4 L11 -11Z" fill="#F4A340"/>
      <circle cx="8.4" cy="-14" r="1" fill="#2F3550"/>
      <ellipse cx="-2" cy="-5.5" rx="5.5" ry="2.8" fill="${wing}"/>
      <ellipse cy="1" rx="12" ry="1.8" fill="${c.ripple}" opacity=".7"/>
    </g></g></g><circle cy="-6" r="16" fill-opacity="0" pointer-events="all"/></g>`;
  };

  const fireflies = () => pick(14).map((i) => {
    const x = 20 + ((i * 71) % 350);
    const y = 440 + ((i * 47) % 280);
    return `<g transform="translate(${x} ${y})"><g class="firefly" style="--dx:${((i * 13) % 30) - 15}px;--dy:${-10 - (i % 4) * 6}px;animation-duration:${5 + (i % 5)}s;animation-delay:-${i * 0.8}s">
      <image href="${glowSprite('#FFE58A', 48)}" x="-10" y="-10" width="20" height="20"/><circle r="1.6" fill="#FFF3B0"/></g></g>`;
  }).join('');

  const night = () => phase === 'night';

  const flowers = () => pick(70).map((i) => {
    const y = 652 + hash(i, 1) * 84;
    const left = hash(i, 2) < 0.68;
    const x = left ? 6 + hash(i, 3) * 160 : 272 + hash(i, 3) * 56;
    const s = scaleAt(y) * 0.55;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.8 * s).toFixed(2)}" fill="${FLOWER_COLORS[i % FLOWER_COLORS.length]}" opacity="${night() ? 0.45 : 0.95}"/>`;
  }).join('');

  const cherry = () => {
    const [p1, p2] = night() ? ['#8E6E9E', '#7A5C8C'] : ['#F7C6D5', '#EEA7BF'];
    const petals = pick(9).map((i) => `<ellipse class="petal" cx="${-30 + i * 8}" cy="${-70 + (i % 3) * 10}" rx="2.4" ry="1.5" fill="${p1}" style="animation-delay:-${i * 1.1}s;animation-duration:${6 + (i % 4)}s"/>`).join('');
    return `<g transform="translate(350 744) scale(1.5)">
      <path d="M-4 0 Q-1 -24 -6 -46 M-3 -30 Q8 -38 12 -50" stroke="${c.woodShade}" stroke-width="6" fill="none" stroke-linecap="round"/>
      <g class="sway" style="animation-duration:6s"><circle cx="-18" cy="-56" r="18" fill="${p2}"/><circle cx="10" cy="-62" r="20" fill="${p2}"/><circle cx="-4" cy="-76" r="17" fill="${p1}"/><circle cx="20" cy="-48" r="12" fill="${p1}"/></g>
      ${petals}</g>`;
  };

  const sheepMarkup = (sh, i) => {
    const wool = night() ? '#B9B2D0' : '#FFF8EE';
    const face = '#3E3A48';
    return `<g class="sheep" data-sheep="${i}"><g class="flip"><g class="hop">
      <rect x="-8" y="-2" width="2.6" height="7" rx="1" fill="${face}"/><rect x="4" y="-2" width="2.6" height="7" rx="1" fill="${face}"/>
      <circle cx="-7" cy="-7" r="6" fill="${wool}"/><circle cx="0" cy="-9" r="7" fill="${wool}"/><circle cx="7" cy="-7" r="6" fill="${wool}"/><circle cx="0" cy="-4" r="7" fill="${wool}"/>
      <g class="graze" style="animation-delay:-${i * 2.3}s"><ellipse cx="12" cy="-6" rx="4" ry="5" fill="${face}"/><ellipse cx="9" cy="-9" rx="2.6" ry="1.4" fill="${face}"/><circle cx="13" cy="-7" r=".9" fill="#FFF8EE"/></g>
    </g></g><circle cy="-6" r="15" fill-opacity="0" pointer-events="all"/></g>`;
  };

  const flyMarkup = (f, i) => {
    const col = ['#F7B7D0', '#C9B8F5', '#FFE08A'][i];
    return `<g class="butterfly" data-butterfly="${i}"><g class="wings"><path d="M0 0 C-7 -9 -11 -2 -6 2 C-9 6 -3 8 0 2Z" fill="${col}"/><path d="M0 0 C7 -9 11 -2 6 2 C9 6 3 8 0 2Z" fill="${col}"/></g>
      <rect x="-.7" y="-3" width="1.4" height="6" rx=".7" fill="#4E4470"/><circle r="12" fill-opacity="0" pointer-events="all"/></g>`;
  };

  const catMarkup = () => {
    const fur = night() ? '#9C86A8' : '#F2C9A0';
    const dark = night() ? '#7A6690' : '#DDA477';
    const s = scaleAt(CAT.y) * 0.5;
    return `<g class="cat" data-cat transform="translate(${CAT.x.toFixed(1)} ${CAT.y}) scale(${s.toFixed(3)})">
      <g class="breathe"><path d="M10 0 Q22 -2 18 -9" stroke="${dark}" stroke-width="3.4" fill="none" stroke-linecap="round"/>
      <ellipse cx="2" cy="-5" rx="13" ry="7" fill="${fur}"/><path d="M-2 -11 Q3 -13 8 -10" stroke="${dark}" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>
      <g class="cat-head"><circle cx="-10" cy="-7" r="6" fill="${fur}"/><path d="M-15 -10 L-14 -16 L-11 -12Z M-9 -12 L-6 -16 L-5.5 -10Z" fill="${fur}"/>
      <path d="M-13 -7 q1.4 1.2 2.8 0 M-9 -7 q1.4 1.2 2.8 0" stroke="#4E4470" stroke-width=".9" fill="none" stroke-linecap="round"/></g>
      <circle cx="-2" cy="-6" r="16" fill-opacity="0" pointer-events="all"/></g>`;
  };

  let sheepEls = [];
  let flyEls = [];
  let duckEls = [];
  let fishLayer;
  let birdLayer;

  function draw() {
    back.innerHTML = TREES.map(tree).join('');
    birdLayer = frag(back, '');
    water.innerHTML = `<g>${glints()}</g><g>${pads()}</g><g class="frog-spot">${frogMarkup()}</g>`;
    fishLayer = frag(water, '');
    const duckLayer = frag(water, phase === 'night' ? '' : ducks.map(duckMarkup).join(''));
    duckEls = [...duckLayer.querySelectorAll('.duck')];
    front.innerHTML = `${reeds(18, 668, 1.35, false)}${reeds(372, 654, 1.2, true)}${cherry()}
      <g class="herd">${sheep.map(sheepMarkup).join('')}</g><g>${flowers()}</g>${catMarkup()}
      <g class="flies">${phase === 'night' || phase === 'dusk' ? '' : flies.map(flyMarkup).join('')}</g>
      ${phase === 'night' || phase === 'dusk' ? fireflies() : ''}`;
    sheepEls = [...front.querySelectorAll('.sheep')];
    flyEls = [...front.querySelectorAll('.butterfly')];
    birds.length = 0;
    placeDucks();
    moveSheep(0);
    moveFlies(0);
  }

  function placeDucks() {
    duckEls.forEach((el, i) => {
      const d = ducks[i];
      const s = scaleAt(d.y) * d.size;
      el.setAttribute('transform', `translate(${d.x.toFixed(1)} ${d.y}) scale(${s.toFixed(3)})`);
      el.firstElementChild.setAttribute('transform', `scale(${d.dir} 1)`);
    });
  }

  function moveDucks(dt) {
    const [mom, ...kids] = ducks;
    mom.x += mom.dir * 0.006 * dt;
    if (mom.x > 345) mom.dir = -1;
    if (mom.x < 45) mom.dir = 1;
    kids.forEach((kid, i) => {
      const lead = ducks[i];
      const target = lead.x - lead.dir * (i === 0 ? 26 : 16);
      const step = (target - kid.x) * Math.min(1, dt * 0.0015);
      if (Math.abs(step) > 0.002) kid.dir = step > 0 ? 1 : -1;
      kid.x += step;
    });
    placeDucks();
  }

  // Sheep graze, wander a little around their spot, and turn back.
  function moveSheep(dt) {
    sheep.forEach((sh, i) => {
      sh.t += dt;
      if (!night()) {
        sh.x += sh.dir * 0.0025 * dt;
        if (Math.abs(sh.x - sh.home) > 14) sh.dir = sh.x > sh.home ? -1 : 1;
      }
      const el = sheepEls[i];
      if (!el) return;
      const s = scaleAt(sh.y) * 0.55;
      el.setAttribute('transform', `translate(${sh.x.toFixed(1)} ${sh.y}) scale(${s.toFixed(3)})`);
      el.firstElementChild.setAttribute('transform', `scale(${sh.dir} 1)`);
    });
  }

  // Butterflies wander over the meadow along lazy loops.
  function moveFlies(dt) {
    flies.forEach((f, i) => {
      f.t += dt;
      f.x = f.hx + Math.sin(f.t * f.a) * 40 + Math.sin(f.t * f.a * 2.7) * 12;
      f.y = f.hy + Math.sin(f.t * f.b) * 14 - (f.lift || 0);
      if (f.lift) f.lift = Math.max(0, f.lift - dt * 0.03);
      const el = flyEls[i];
      if (el) el.setAttribute('transform', `translate(${f.x.toFixed(1)} ${f.y.toFixed(1)}) scale(${(scaleAt(f.y) * 0.45).toFixed(3)})`);
    });
  }

  function spawnBirds() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const y = rand(110, 270);
    const n = 3 + Math.floor(Math.random() * 3);
    const color = phase === 'day' || phase === 'morning' ? c.scale : '#3B3360';
    const g = frag(birdLayer, pick(n).map((k) => {
      const off = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
      return `<g transform="translate(${-Math.abs(off) * 14 * dir} ${off * 8})"><path class="wing" style="animation-delay:-${k * 0.13}s" d="M-7 0 Q-3.5 -5 0 0 Q3.5 -5 7 0" stroke="${color}" stroke-width="1.8" fill="none" stroke-linecap="round"/></g>`;
    }).join(''));
    birds.push({ g, x: dir > 0 ? -40 : 430, y, dir, t: 0 });
  }

  function moveBirds(dt) {
    for (let i = birds.length - 1; i >= 0; i--) {
      const b = birds[i];
      b.t += dt;
      b.x += b.dir * 0.035 * dt;
      b.g.setAttribute('transform', `translate(${b.x.toFixed(1)} ${(b.y + Math.sin(b.t / 900) * 6).toFixed(1)}) scale(.9)`);
      if (b.x < -60 || b.x > 450) { b.g.remove(); birds.splice(i, 1); }
    }
  }

  function jumpFish() {
    const y = rand(525, 612);
    const x = rand(70, 320);
    const s = scaleAt(y);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const g = frag(fishLayer, `<g><path d="M-6 0 Q0 -4.2 6 0 Q0 4.2 -6 0Z M-5 0 L-10 -3.4 L-10 3.4Z" fill="#F7A07C"/><circle cx="3" cy="-0.8" r=".8" fill="#2F3550"/></g>`);
    const fish = g.firstElementChild;
    ripple(x, y, 0.35);
    animate(950, (u) => {
      const px = x + dir * 30 * s * u;
      const py = y - 30 * s * Math.sin(Math.PI * u);
      const angle = Math.atan2(-Math.cos(Math.PI * u) * 30 * Math.PI, 30) * (180 / Math.PI);
      fish.setAttribute('transform', `translate(${px} ${py}) scale(${dir * s} ${s}) rotate(${angle})`);
    }).then(() => {
      g.remove();
      ripple(x + dir * 30 * s, y, 0.35);
    });
  }

  async function frogJump() {
    if (frogBusy) return;
    frogBusy = true;
    const from = PADS[frogPad];
    frogPad = (frogPad + 1) % PADS.length;
    const to = PADS[frogPad];
    const frog = water.querySelector('.frog');
    say(from[0], from[1] - 22, 'croâ');
    ripple(from[0], from[1], 0.3);
    await animate(650, (u) => {
      const x = from[0] + (to[0] - from[0]) * u;
      const y = from[1] + (to[1] - from[1]) * u - 26 * Math.sin(Math.PI * u);
      const s = scaleAt(from[1] + (to[1] - from[1]) * u) * 0.8;
      frog.setAttribute('transform', `translate(${x} ${y - 1}) scale(${s})`);
    });
    ripple(to[0], to[1], 0.3);
    frogBusy = false;
  }

  function quack(i) {
    const d = ducks[i];
    const el = duckEls[i];
    if (!el) return;
    el.querySelector('.hop').animate(
      [{ transform: 'none' }, { transform: 'translateY(-6px) rotate(-8deg)' }, { transform: 'none' }],
      { duration: 420, easing: 'ease-out' },
    );
    say(d.x, d.y - 26 * scaleAt(d.y), i === 0 ? 'coin !' : 'pio');
    ripple(d.x, d.y, 0.3);
    d.dir = -d.dir;
  }

  function bleat(i) {
    const sh = sheep[i];
    sheepEls[i]?.querySelector('.hop').animate(
      [{ transform: 'none' }, { transform: 'translateY(-7px)' }, { transform: 'none' }],
      { duration: 380, easing: 'ease-out' },
    );
    say(sh.x, sh.y - 40, 'bêê');
    sh.dir = -sh.dir;
  }

  function meow() {
    front.querySelector('.cat-head')?.animate(
      [{ transform: 'none' }, { transform: 'translate(-1px, -5px) rotate(-12deg)' }, { transform: 'translate(-1px, -5px) rotate(-12deg)' }, { transform: 'none' }],
      { duration: 1400, easing: 'ease-in-out' },
    );
    say(CAT.x, CAT.y - 34, night() ? 'mrrr…' : 'miaou');
  }

  function tick(now) {
    const dt = Math.min(64, now - last);
    last = now;
    if (phase && phase !== 'night') moveDucks(dt);
    moveSheep(dt);
    moveFlies(dt);
    moveBirds(dt);
    if (now > nextFish) {
      jumpFish();
      nextFish = now + rand(9000, 18000);
    }
    if (now > nextBirds && phase !== 'night') {
      spawnBirds();
      nextBirds = now + rand(16000, 30000);
    }
    raf = requestAnimationFrame(tick);
  }

  return {
    setPhase(next) {
      if (next === phase) return;
      phase = next;
      c = PHASES[next];
      draw();
    },
    // Returns true when the touch landed on a creature.
    poke(target) {
      const duck = target.closest('[data-duck]');
      if (duck) { quack(Number(duck.dataset.duck)); return true; }
      if (target.closest('[data-frog]')) { frogJump(); return true; }
      const sh = target.closest('[data-sheep]');
      if (sh) { bleat(Number(sh.dataset.sheep)); return true; }
      if (target.closest('[data-cat]')) { meow(); return true; }
      const fly = target.closest('[data-butterfly]');
      if (fly) { flies[Number(fly.dataset.butterfly)].lift = 60; return true; }
      return false;
    },
    start() {
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(tick);
    },
    stop() { cancelAnimationFrame(raf); },
  };
}
