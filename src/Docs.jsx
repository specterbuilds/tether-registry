import React from 'react';

const snippets = {
  start: `git clone --recurse-submodules https://github.com/specterbuilds/tether-registry.git
cd tether-registry
npm ci
npm run setup:sdk
npm run server  # API: http://127.0.0.1:3001
npm run dev     # UI:  http://127.0.0.1:5173`,
  register: `curl -X POST http://127.0.0.1:3001/api/register \\
  -F 'name=Alex Sample' -F 'age=28' -F 'gender=non-binary' \\
  -F 'image=@sample.png'`,
  verify: `curl -X POST http://127.0.0.1:3001/api/verify \\
  -F 'image=@tethered-photo.png'`,
  sdk: `// SDK example after linking or publishing @tether/sdk.
// This demo imports vendor/tether/packages/tether/dist/index.js directly.
import { Tether, Ed25519Signer } from '@tether/sdk';

const signer = Ed25519Signer.fromPrivateKeyHex(savedPrivateKey);
const tether = new Tether();
const manifest = await tether.sign(pngBytes, {
  issuer: { id: 'example.platform', name: 'Example platform' },
  claims: [{ type: 'example/profile', value: { accountId: '123' } }],
  signer,
  store: persistentManifestStore,
});

const card = await tether.verify(uploadedPngBytes, {
  store: persistentManifestStore,
  trustedPublicKeys: [signer.publicKeyHex],
});
if (card?.signatureValid && !card.revoked && card.integrity === 'exact') {
  // Apply your own authorization policy before showing claims.
}`
};
function Code({ children }) { return <pre className="docs-code"><code>{children}</code></pre>; }
export default function Docs() {
  return <div className="docs-shell"><header className="docs-header"><div className="crumb">Workspace <span>/</span> Documentation</div><a href="/">← Back to playground</a></header>
    <main className="docs-main"><div className="docs-hero"><span className="kicker">TETHER REGISTRY / DOCS</span><h1>Build with a <em>signed record.</em></h1><p>A practical guide to running the demo and integrating the source-pinned Tether SDK. This is a local reference app, not a hosted identity service.</p><div className="docs-meta"><span>SDK 0.2.0</span><span>NODE 22+</span><span>LOCAL DEMO</span></div></div>
    <div className="docs-layout"><nav className="docs-toc" aria-label="Documentation sections"><span>ON THIS PAGE</span><a href="#quickstart">Getting started</a><a href="#flow">The two flows</a><a href="#api">HTTP API</a><a href="#sdk">Use the SDK</a><a href="#manifest">Manifest model</a><a href="#security">Trust and limits</a></nav>
    <div className="docs-body"><section id="quickstart"><span className="kicker">01 / RUN IT</span><h2>Getting started.</h2><p>Clone with its Git submodule. The SDK is not published to npm, so the app builds the pinned copy in <code>vendor/tether</code> before starting. Run the API and frontend in separate terminals.</p><Code>{snippets.start}</Code><p>Records, downloaded PNGs and the issuer key persist in <code>.data/</code>. This directory is ignored by Git. Keep it private and back it up if records matter.</p></section>
    <section id="flow"><span className="kicker">02 / THE JOURNEY</span><h2>One photo. Two paths.</h2><div className="docs-cards"><article><span>REGISTER</span><h3>Issue a record</h3><p>A PNG, JPEG or WebP under 8 MB is auto-rotated, resized to at most 1600 × 1600 and normalized to PNG. The SDK signs a manifest containing the image's exact SHA-256, perceptual fingerprint and sample profile claim. SQLite stores the signed manifest. The response gives a download URL for the normalized PNG.</p></article><article><span>VERIFY</span><h3>Look it up</h3><p>Send the downloaded image back. The server normalizes it, asks the SDK for a card, checks the trusted issuer signature and revocation state, and reveals sample details only for an exact match. Similar matches return a status but no details.</p></article></div></section>
    <section id="api"><span className="kicker">03 / HTTP INTERFACE</span><h2>API reference.</h2><p>All routes are local by default at <code>http://127.0.0.1:3001</code>. The browser's Vite dev server proxies <code>/api</code>. The API has no authentication; do not publish it as-is.</p><div className="endpoint"><strong>POST /api/register</strong><span>multipart/form-data</span></div><p>Fields: <code>image</code> (PNG/JPEG/WebP, ≤8 MB), <code>name</code> (nonempty, max 80 chars), <code>age</code> (integer 18–120), <code>gender</code> (nonempty, max 40 chars). Use fictional details only.</p><Code>{snippets.register}</Code><Code>{`HTTP 201
{ "manifestId": "...", "createdAt": "...", "downloadUrl": "/api/images/<id>" }`}</Code><div className="endpoint"><strong>GET /api/images/:id</strong><span>image/png attachment</span></div><p>Download the normalized PNG returned by registration. Unknown IDs return 404. The file embeds a signed C2PA Content Credential (verifiable in standard C2PA tools) but no encrypted profile data.</p><div className="endpoint"><strong>POST /api/verify</strong><span>multipart/form-data</span></div><p>Field: <code>image</code> (PNG/JPEG/WebP, ≤8 MB). Exact signed matches return details; a similar fingerprint match withholds details; an unknown, untrusted or revoked record returns <code>{'{ "status": "unknown" }'}</code>.</p><Code>{snippets.verify}</Code><Code>{`HTTP 200
{ "status": "verified", "manifestId": "...", "issuer": "Tether Registry demo",
  "createdAt": "...", "integrity": "exact", "signatureValid": true,
  "details": { "name": "Alex Sample", "age": 28, "gender": "non-binary" } }`}</Code><p>Malformed fields or images return 400 with <code>error</code>; oversized uploads return 413. IDs and timestamps vary on each run.</p></section>
    <section id="sdk"><span className="kicker">04 / INTEGRATE</span><h2>The SDK boundary.</h2><p>Keep signing on the server. Implement the SDK's append-only <code>ManifestStore</code> interface with durable storage. The sample uses SQLite; the SDK's in-memory store is only a reference implementation. Persist the Ed25519 key securely and configure verifier trust with the corresponding public key.</p><Code>{snippets.sdk}</Code><p>The snippet uses the future package import path to show the SDK boundary. In this source-only demo, <code>server/registry.js</code> imports <code>vendor/tether/packages/tether/dist/index.js</code> directly after <code>npm run setup:sdk</code>. See the <a href="https://github.com/specterbuilds/tether">SDK repository ↗</a> for its package map and typedoc generation. Claims are platform attestations, not proof of real-world identity.</p></section>
    <section id="manifest"><span className="kicker">05 / THE RECORD</span><h2>What is signed?</h2><div className="manifest-list"><div><strong>Issuer + claims</strong><span>Platform identifier and its stated claim. Here: <code>tether.demo/profile</code> with sample name, age and gender.</span></div><div><strong>Content bindings</strong><span>SHA-256 of the normalized PNG bytes, a 128-bit perceptual fingerprint, and byte length.</span></div><div><strong>Signature + time</strong><span>A signature over a canonical manifest payload, issuer public key, manifest ID and creation time. The signer is pluggable: Ed25519, post-quantum ML-DSA-65 (FIPS 204), or a hybrid of both.</span></div><div><strong>C2PA credential</strong><span>The downloaded PNG also carries a standard, embedded C2PA manifest (self-issued demo cert) with the issuer and claims, verifiable in C2PA tools.</span></div><div><strong>Watermark</strong><span>The SDK ships a working lossless LSB watermarker; this registry verifies by content hash and C2PA, so it is not enabled here yet.</span></div></div><p>Verification resolves a card through the registry store. The card may report <code>exact</code> or <code>similar</code> integrity, signature validity and revocation. The demo's disclosure rule is stricter than the SDK's similarity signal.</p></section>
    <section id="security"><span className="kicker">06 / READ BEFORE DEPLOYING</span><h2>Trust is a policy, too.</h2><div className="docs-cards"><article><span>NOT ENCRYPTION</span><h3>Image ≠ vault</h3><p>The downloaded PNG does not contain the profile. Recovery depends on this server's database and signing key. Offline decryption and recovery are not available.</p></article><article><span>NOT PROOF OF IDENTITY</span><h3>Claims need context</h3><p>A valid signature proves only that the issuer signed a statement about an image. It does not prove consent, photo authenticity or a person's identity.</p></article><article><span>PRIVACY FIRST</span><h3>Use fake details</h3><p>This demo stores profile claims in plaintext and has no auth, deletion flow, retention policy or rate limits. Add those controls before accepting real data or public traffic.</p></article><article><span>SOFT MATCHES</span><h3>Do not disclose</h3><p>Perceptual matches can collide. This demo withholds details for similar photos and returns details only on exact image match and valid trusted signature.</p></article></div></section>
    <div className="docs-end"><a href="/">Open the playground ↗</a><a href="https://github.com/specterbuilds/tether-registry">Browse source ↗</a></div></div></div></main></div>;
}
