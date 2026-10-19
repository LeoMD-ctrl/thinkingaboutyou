import fs from 'node:fs';
import path from 'node:path';

export const PLACES_PER_MAP = 6;

const EMPTY = () => ({ users: {}, links: [], pings: [], signs: {} });

// Tiny JSON-file database. Plenty for a handful of people; every write is
// atomic (tmp file + rename) so a crash never leaves a half-written file.
export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(dir, { recursive: true });
    const saved = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    this.data = { ...EMPTY(), users: saved.users || {}, pings: saved.pings || [], signs: saved.signs || {}, links: [] };
    // Older files stored links as bare pairs: give each side a place in arrival order.
    for (const link of saved.links || []) {
      if (Array.isArray(link)) this.link(link[0], link[1]);
      else this.data.links.push(link);
    }
    this.timer = null;
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 50);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  userByToken(token) {
    if (!token) return null;
    return Object.values(this.data.users).find((u) => u.token === token) || null;
  }

  userByCode(code) {
    if (!code) return null;
    const c = String(code).trim().toUpperCase();
    return Object.values(this.data.users).find((u) => u.code === c) || null;
  }

  linkBetween(a, b) {
    return this.data.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a)) || null;
  }

  linked(a, b) {
    return Boolean(this.linkBetween(a, b));
  }

  // The first free place on someone's map, or -1 when it is full.
  freePlace(id) {
    const taken = new Set(this.data.links.filter((l) => l.a === id || l.b === id).map((l) => (l.a === id ? l.placeA : l.placeB)));
    for (let i = 0; i < PLACES_PER_MAP; i++) if (!taken.has(i)) return i;
    return -1;
  }

  /** @returns {'linked'|'already'|'full'} */
  link(a, b) {
    if (a === b || this.linked(a, b)) return 'already';
    const placeA = this.freePlace(a); // where b lives on a's map
    const placeB = this.freePlace(b); // where a lives on b's map
    if (placeA < 0 || placeB < 0) return 'full';
    this.data.links.push({ a, b, placeA, placeB, at: Date.now() });
    return 'linked';
  }

  unlink(a, b) {
    const before = this.data.links.length;
    this.data.links = this.data.links.filter((l) => !((l.a === a && l.b === b) || (l.a === b && l.b === a)));
    return this.data.links.length < before;
  }

  /** People linked to `id`, each with the place they occupy on `id`'s map. */
  peopleOf(id) {
    return this.data.links
      .filter((l) => l.a === id || l.b === id)
      .map((l) => ({ user: this.data.users[l.a === id ? l.b : l.a], place: l.a === id ? l.placeA : l.placeB }))
      .filter((x) => x.user)
      .sort((x, y) => x.place - y.place);
  }
}
