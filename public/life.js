// Little lives around the lake: ducks, a frog, fish, birds, fireflies,
// trees and reeds in the wind, glints on the water. Some can be touched.

import { PHASES, scaleAt, glowSprite } from './scene.js';

const NS = 'http://www.w3.org/2000/svg';
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (n) => Array.from({ length: n }, (_, i) => i);

// [x, y, scale]: trees get smaller as they sit higher on the hills (further away).
const TREES = [[28, 505, 0.9], [146, 501, 0.62], [166, 463, 0.36], [184, 465, 0.34], [232, 441, 0.38], [282, 479, 0.68], [372, 474, 0.78], [356, 446, 0.4]];
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

  // The duck family: a mother and three ducklings following her.
  const ducks = [
    { x: 150, y: DUCK_Y, dir: 1, size: 1.3 },
    { x: 126, y: DUCK_Y + 3, dir: 1, size: 0.7 },
    { x: 110, y: DUCK_Y + 1, dir: 1, size: 0.7 },
    { x: 94, y: DUCK_Y + 4, dir: 1, size: 0.7 },
  ];

  const tree = ([x, y, s], i) => {
    const far = y < 465;
    return `<g transform="translate(${x} ${y}) scale(${s})"><g class="sway" style="animation-delay:-${i * 0.7}s">
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
    front.innerHTML = `${reeds(18, 668, 1.35, false)}${reeds(372, 654, 1.2, true)}${phase === 'night' || phase === 'dusk' ? fireflies() : ''}`;
    birds.length = 0;
    placeDucks();
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

  function tick(now) {
    const dt = Math.min(64, now - last);
    last = now;
    if (phase && phase !== 'night') moveDucks(dt);
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
