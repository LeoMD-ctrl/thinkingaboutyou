import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({ users: {}, links: [], pings: [], moments: {} });

// Tiny JSON-file database. Plenty for a handful of people; every write is
// atomic (tmp file + rename) so a crash never leaves a half-written file.
export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = fs.existsSync(this.file)
      ? { ...EMPTY(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }
      : EMPTY();
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

  linked(a, b) {
    return this.data.links.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  }

  link(a, b) {
    if (a === b || this.linked(a, b)) return false;
    this.data.links.push([a, b]);
    return true;
  }

  peopleOf(id) {
    return this.data.links
      .filter(([x, y]) => x === id || y === id)
      .map(([x, y]) => this.data.users[x === id ? y : x])
      .filter(Boolean);
  }
}
