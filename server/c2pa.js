import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Real, interoperable C2PA (Content Credentials) embedding for the registry.
// The downloaded PNG carries a standard, signed C2PA manifest that verifies in
// c2patool and verify.contentauthenticity.org. Because the demo signs with a
// self-issued certificate (generated below), those tools report the content as
// valid but from an "untrusted" source - expected until the cert is added to a
// trust list. This is additive to Tether's own signed registry manifest.

const SOURCE_TYPE_OPENED = 'c2pa.opened';

/** Generate a demo CA + leaf signing chain (ES256) under <dir>, once. */
function ensureCert(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const chain = join(dir, 'chain.pem');
  const key = join(dir, 'leaf.pk8.pem');
  if (existsSync(chain) && existsSync(key)) return { chain, key };

  const caKey = join(dir, 'ca.key');
  const caCert = join(dir, 'ca.pem');
  const leafKey = join(dir, 'leaf.key');
  const leafCsr = join(dir, 'leaf.csr');
  const leafCert = join(dir, 'leaf.pem');
  const cnf = join(dir, 'leaf.cnf');
  writeFileSync(cnf, [
    '[req]', 'distinguished_name = dn', 'prompt = no',
    '[dn]', 'CN = Tether Registry Demo Signer', 'O = Tether Registry',
    '[ext]', 'basicConstraints = critical, CA:FALSE',
    'keyUsage = critical, digitalSignature',
    'extendedKeyUsage = critical, emailProtection',
  ].join('\n'), { mode: 0o600 });
  const ossl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'ignore'] });

  ossl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', caKey);
  ossl('req', '-x509', '-new', '-key', caKey, '-days', '3650', '-out', caCert,
    '-subj', '/CN=Tether Registry Demo Root CA/O=Tether Registry',
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  ossl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', leafKey);
  ossl('req', '-new', '-key', leafKey, '-out', leafCsr, '-config', cnf);
  ossl('x509', '-req', '-in', leafCsr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial',
    '-days', '3650', '-extfile', cnf, '-extensions', 'ext', '-out', leafCert);
  // c2pa wants a PKCS#8 key and a leaf+issuer chain.
  ossl('pkcs8', '-topk8', '-nocrypt', '-in', leafKey, '-out', key);
  writeFileSync(chain, readFileSync(leafCert, 'utf8') + readFileSync(caCert, 'utf8'), { mode: 0o600 });
  for (const f of [leafCsr, cnf]) rmSync(f, { force: true });
  return { chain, key };
}

/**
 * C2PA integration. Lazily loads the native @contentauth/c2pa-node addon and the
 * signing cert. If either is unavailable, embedding/reading degrade to a no-op so
 * the registry still runs (set TETHER_C2PA=0 to disable intentionally).
 */
export class C2pa {
  constructor(dir) { this.dir = dir; this.enabled = process.env.TETHER_C2PA !== '0'; this.mod = null; this.signer = null; }

  async #load() {
    if (!this.enabled) return false;
    if (this.mod && this.signer) return true;
    try {
      this.mod = await import('@contentauth/c2pa-node');
      const { chain, key } = ensureCert(join(this.dir, 'c2pa'));
      this.signer = this.mod.LocalSigner.newSigner(readFileSync(chain), readFileSync(key), 'es256');
      return true;
    } catch (e) {
      console.warn(`C2PA disabled: ${e.message}`);
      this.enabled = false;
      return false;
    }
  }

  /** Embed a signed C2PA manifest carrying the Tether claims; returns new PNG bytes. */
  async embed(pngBytes, { manifestId, issuer, claims, uploadBytes, uploadMime }) {
    if (!(await this.#load())) return pngBytes;
    const { Builder } = this.mod;
    const uploadId = `tether-upload:${manifestId}`;
    const builder = Builder.withJson({
      claim_generator_info: [{ name: 'tether-registry', version: '0.1.0' }],
      title: 'tethered-photo.png',
      format: 'image/png',
      assertions: [
        { label: 'c2pa.actions.v2', data: { actions: [
          { action: SOURCE_TYPE_OPENED, parameters: { ingredientIds: [uploadId] }, softwareAgent: { name: 'tether-registry', version: '0.1.0' } },
          { action: 'c2pa.converted', softwareAgent: { name: 'tether-registry', version: '0.1.0' } },
        ] } },
        { label: 'com.tether.manifest', data: { manifestId, issuer, claims } },
      ],
    });
    await builder.addIngredient(
      JSON.stringify({ title: 'upload', format: uploadMime || 'image/png', instance_id: uploadId, relationship: 'parentOf' }),
      { buffer: Buffer.from(uploadBytes), mimeType: uploadMime || 'image/png' },
    );
    const dest = { buffer: null };
    builder.sign(this.signer, { buffer: Buffer.from(pngBytes), mimeType: 'image/png' }, dest);
    return dest.buffer ? Buffer.from(dest.buffer) : pngBytes;
  }

  /** Read and validate an embedded C2PA manifest; null if none / unavailable. */
  async read(pngBytes) {
    if (!(await this.#load())) return null;
    try {
      const reader = await this.mod.Reader.fromAsset({ buffer: Buffer.from(pngBytes), mimeType: 'image/png' });
      const raw = reader.json();
      const store = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!store?.active_manifest) return null;
      const am = store.manifests[store.active_manifest];
      const codes = (store.validation_status || []).map(v => v.code);
      return {
        validationState: store.validation_state,
        untrusted: codes.includes('signingCredential.untrusted'),
        title: am.title,
        signatureAlg: am.signature_info?.alg,
        assertions: am.assertions.map(a => a.label),
        tetherClaims: am.assertions.find(a => a.label === 'com.tether.manifest')?.data ?? null,
      };
    } catch {
      return null;
    }
  }
}
