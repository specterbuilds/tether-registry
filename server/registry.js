import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { Tether, Ed25519Signer, hammingDistance } from '../vendor/tether/packages/tether/dist/index.js';

const issuer = { id: 'tether-registry.example', name: 'Tether Registry demo' };
const claimType = 'tether.demo/profile';
function isHex(h) { return /^[0-9a-f]{64}$/.test(h); }
function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }

export class Registry {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.dataDir = dataDir;
    this.db = new DatabaseSync(join(dataDir, 'registry.sqlite'));
    this.db.exec('CREATE TABLE IF NOT EXISTS manifests (id TEXT PRIMARY KEY, sha TEXT NOT NULL, phash TEXT NOT NULL, issuer TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS manifests_sha ON manifests(sha);');
    const keyFile = join(dataDir, 'issuer.key');
    if (!existsSync(keyFile)) {
      const tmp = `${keyFile}.${randomUUID()}.tmp`;
      writeFileSync(tmp, Ed25519Signer.generate().export(), { mode: 0o600, flag: 'wx' });
      renameSync(tmp, keyFile);
    }
    this.signer = Ed25519Signer.fromPrivateKeyHex(readFileSync(keyFile, 'utf8').trim());
    this.sdk = new Tether();
    this.store = {
      put: async m => { this.db.prepare('INSERT INTO manifests (id,sha,phash,issuer,created_at,json) VALUES (?,?,?,?,?,?)').run(m.manifestId, m.content.sha256, m.content.phash, m.issuer.id, m.createdAt, JSON.stringify(m)); },
      getByContentHash: async sha => { const r = this.db.prepare('SELECT json FROM manifests WHERE sha = ? ORDER BY created_at DESC LIMIT 1').get(sha); return r ? JSON.parse(r.json) : null; },
      findByFingerprint: async (phash, maxDistance) => this.db.prepare('SELECT json, phash FROM manifests').all().filter(r => hammingDistance(r.phash, phash) <= maxDistance).map(r => JSON.parse(r.json)),
      historyForIssuer: async id => this.db.prepare('SELECT json FROM manifests WHERE issuer = ? ORDER BY created_at DESC').all(id).map(r => JSON.parse(r.json)),
      isRevoked: async id => !!this.db.prepare('SELECT revoked FROM manifests WHERE id = ?').get(id)?.revoked,
      revoke: async id => { this.db.prepare('UPDATE manifests SET revoked = 1 WHERE id = ?').run(id); }
    };
  }
  async png(buffer) {
    const meta = await sharp(buffer, { limitInputPixels: 12_000_000 }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('Please use PNG, JPEG, or WebP.');
    return sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  }
  async register({ image, name, age, gender }) {
    name = clean(name, 80); gender = clean(gender, 40); age = Number(age);
    if (!name || !gender || !Number.isInteger(age) || age < 18 || age > 120) throw new Error('Enter a name, an age from 18 to 120, and a gender. Use demo information only.');
    const png = await this.png(image);
    const manifest = await this.sdk.sign(png, { issuer, signer: this.signer, store: this.store, claims: [{ type: claimType, value: { name, age, gender } }] });
    return { manifestId: manifest.manifestId, image: png, createdAt: manifest.createdAt };
  }
  async verify(image) {
    const png = await this.png(image);
    const card = await this.sdk.verify(png, { store: this.store, trustedPublicKeys: [this.signer.publicKeyHex] });
    if (!card || !card.signatureValid || card.revoked) return { status: 'unknown' };
    // The demo deliberately discloses profiles only for exact byte matches.
    // A perceptual match is not proof of identity and may collide with other images.
    if (card.integrity !== 'exact') return { status: 'similar', integrity: card.integrity, message: 'A similar photo matched. Profile details are withheld unless the bytes match exactly.' };
    return { status: 'verified', manifestId: card.manifestId, issuer: card.issuer.name, createdAt: card.createdAt, integrity: card.integrity, signatureValid: true, details: card.claims.find(c => c.type === claimType)?.value ?? null };
  }
  imageFor(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const row = this.db.prepare('SELECT sha FROM manifests WHERE id = ?').get(id);
    if (!row || !isHex(row.sha)) return null;
    const filename = join(this.dataDir, 'images', `${id}.png`);
    return existsSync(filename) ? readFileSync(filename) : null;
  }
  saveImage(id, bytes) {
    const dir = join(this.dataDir, 'images'); mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, `${id}.png`), bytes, { mode: 0o600, flag: 'wx' });
  }
  close() { this.db.close(); }
}
