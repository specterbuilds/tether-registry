# Tether Registry

A React playground and persistent registry for [the Tether SDK](https://github.com/specterbuilds/tether). Register a sample image with name, age and gender, download the signed image's matching PNG, and upload or paste it back to see the associated provenance card. This is a **public demo intended for made-up details**, not an identity verification service.

## See the flow

1. **Register.** Enter sample details and upload a PNG, JPEG or WebP (8 MB maximum). The server rotates and normalizes it to PNG and passes it to `Tether.sign()` with a platform-issued claim. The manifest is Ed25519-signed and saved in SQLite.
2. **Download.** Save `tethered-photo.png`. It is a normalized PNG, **not an encrypted or watermarked file**. The signed record lives on the registry server.
3. **Verify.** Drop, choose or paste the downloaded PNG into the Verify tab. `Tether.verify()` looks up its hash, checks the registry's trusted key and returns the sample details when the bytes match exactly. The database and signing key persist across restarts.

The site has not been deployed. Run it locally using the steps below. Screenshots: [playground](docs/playground.png), [registered photo](docs/registered.png), and [verified details](docs/verified.png), captured from a real browser round trip.

## Run locally

Requires Node 22+ and Git. Clone with the SDK submodule, then install and build it before starting the two servers:

```bash
git clone --recurse-submodules https://github.com/specterbuilds/tether-registry.git
cd tether-registry
npm ci
npm run setup:sdk
npm run server   # terminal 1: API on http://127.0.0.1:3001
npm run dev      # terminal 2: open http://127.0.0.1:5173
```

To run checks: `npm run check` (tests and Vite build). With local Chrome installed, `node tests/browser-flow.mjs` runs the full browser register-download-reupload flow and refreshes the screenshots. The SQLite database and private issuer key are created in `.data/`, ignored by Git. Delete `.data/` only if you intend to discard all issued records and rotate the demo issuer.

## Set up a service with our SDK

The SDK is currently source-only. This repo pins it as a Git submodule in `vendor/tether`; `npm run setup:sdk` builds its npm workspaces, and the server imports `@tether/sdk` from `vendor/tether/packages/tether/dist/index.js`. To adapt this integration:

1. Give your service an issuer identifier and keep an Ed25519 private key **on the server**, never in the React app. Restore with `Ed25519Signer.fromPrivateKeyHex(savedKey)` on restart.
2. Implement the SDK's `ManifestStore` interface with an append-only persistent database (`server/registry.js` is a SQLite reference). Do not use the SDK's `InMemoryManifestStore` for a persistent service.
3. At upload, normalize to PNG while the SDK is PNG-only. Call `new Tether().sign(pngBytes, { issuer, claims, signer, store })`. Keep the returned signed manifest in the store and return the exact PNG to your user.
4. At lookup, call `tether.verify(pngBytes, { store, trustedPublicKeys: [issuerPublicKey] })`. Show claims only after checking `signatureValid`, `revoked`, and your own match/privacy rules. This demo discloses sample details only for `integrity === 'exact'`.
5. Back up and protect the database and issuer key. Add consent, authentication, retention limits, rate limiting, and abuse controls before accepting real data or exposing this on the public internet.

For the reference implementation, see [`server/registry.js`](server/registry.js) and [`src/main.jsx`](src/main.jsx). For SDK API docs and an independent sign/verify sample, see [Tether](https://github.com/specterbuilds/tether).

## Limits and privacy

- Tether signs an **external manifest**; it does **not** encrypt or embed the name, age or gender into image pixels. The SDK's watermark package is a no-op today. Offline decryption and recovery without the registry are not supported.
- Similar-image matches may be useful as a lead, but a perceptual hash can collide. This demo withholds profile details unless the normalized PNG matches exactly. No assertion here proves someone's real-world identity, consent, or that a photo is authentic.
- This demo stores input details in plaintext inside signed manifests. Use **fictional details and non-sensitive images**. It has no public deployment, access control, deletion flow, retention policy or rate limits. Do not put it on the open internet as-is.
- SQLite is local to one server. For real deployments, choose a managed datastore, authenticated disclosure rules, audit trail, backups and key management.

## Layout

```text
src/             React playground and styles
server/          Express API and persistent SQLite ManifestStore
vendor/tether/   pinned upstream SDK submodule
tests/           restart and round-trip checks
.github/workflows/ci.yml   builds and checks both projects
```

MIT licensed. Original visual design takes cues from [chanhdai.com](https://chanhdai.com/) (precise hairlines and type, adapted here to a light rounded design), without copying its content or assets.
