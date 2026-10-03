# Tether Registry

A React playground and persistent registry for [the Tether SDK](https://github.com/specterbuilds/tether). Register a sample image with name, age and gender, download the signed image's matching PNG, and upload or paste it back to see the associated provenance card. This is a **public demo intended for made-up details**, not an identity verification service.

## See the flow

1. **Register.** Enter sample details and upload a PNG, JPEG or WebP (8 MB maximum). The server rotates and normalizes it to PNG and passes it to `Tether.sign()` with a platform-issued claim. The manifest is Ed25519-signed and saved in SQLite.
2. **Download.** Save `tethered-photo.png`. It is a normalized PNG that carries an **embedded C2PA Content Credential** (a standard, signed provenance manifest you can inspect at [verify.contentauthenticity.org](https://verify.contentauthenticity.org) or with `c2patool`). It is **not an encrypted file**, and the pixels are not watermarked. The Tether registry record also lives on the server.
3. **Verify.** Drop, choose or paste the downloaded PNG into the Verify tab. The server reads the embedded C2PA credential and `Tether.verify()` looks up the image hash, checks the registry's trusted key and returns the sample details when the bytes match exactly. The database and signing key persist across restarts.

The site has not been deployed. Run it locally using the steps below. The documentation page is at `http://127.0.0.1:5173/docs` after starting Vite. Screenshots: [playground](docs/playground.png), [registered photo](docs/registered.png), [verified details](docs/verified.png), [mobile](docs/mobile.png), [documentation](docs/documentation.png), and [mobile documentation](docs/documentation-mobile.png), captured from a real browser round trip.

## How it works

### 1. How the service works

The registry layers three independent signals on every image: a **signed manifest** (the trust layer), an **embedded C2PA Content Credential** (portable, standards-based provenance), and a **content + perceptual hash** recorded in an append-only store (the lookup/fallback layer that survives metadata stripping). Register binds them; verify resolves an image back to them.

```mermaid
flowchart TD
  subgraph client["Client (browser / API)"]
    U["Upload PNG/JPEG/WebP + details"]
    DL["Download tethered-photo.png"]
    VUP["Upload an image to verify"]
    RESP["Verified claims or withheld"]
  end

  subgraph svc["Registry service · Express"]
    N1["Normalize to PNG (sharp): rotate, resize, re-encode"]
    SIGN["Tether.sign(): SHA-256 + perceptual hash + claims = signed manifest"]
    EMB["Embed C2PA credential (c2pa-node · ES256)"]
    RCRED["Read + validate C2PA credential"]
    N2["Normalize to PNG (strips the C2PA box)"]
    VER["Tether.verify(): lookup by hash, check trusted key + revocation"]
    CARD["Provenance card: integrity, signatureValid, revoked, claims"]
    DISC["Disclosure rule: reveal details only on exact-byte match"]
  end

  subgraph keys["Signing material · server-only"]
    IK["Issuer key: Ed25519 / ML-DSA-65 / hybrid"]
    CC["C2PA cert chain (demo ES256, self-issued)"]
  end

  subgraph data["Persistence · .data/ (gitignored)"]
    DB[("SQLite ManifestStore: sha256, phash, manifest JSON, revoked")]
    FS[("Signed PNG files")]
  end

  U --> N1 --> SIGN --> EMB --> FS
  SIGN -->|put manifest| DB
  IK --> SIGN
  CC --> EMB
  EMB --> DL

  VUP --> RCRED --> N2 --> VER
  VER -->|getByContentHash / findByFingerprint / isRevoked| DB
  VER --> CARD --> DISC --> RESP
```

### 2. How an application integrates the SDK

A platform (dating site, marketplace, newsroom) keeps its **issuer key on the server**, signs at upload, and verifies at lookup — applying its own disclosure and privacy rules on top of the SDK's trust checks. The SDK never sees raw keys beyond the `Signer` you hand it, and `sign()` returns the exact bytes you must publish.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant App as Your app server
  participant SDK as Tether SDK
  participant Store as ManifestStore (your DB)
  participant C2PA as C2PA layer
  participant Key as Issuer key (server-only)

  Note over App,Key: Startup — restore the issuer key, never ship it to the client
  App->>Key: Ed25519Signer.fromPrivateKeyHex(savedKey)

  Note over User,Store: Register (at upload)
  User->>App: Upload image + claims (e.g. verified-human, consent, listing)
  App->>App: Validate + normalize to PNG (sharp)
  App->>SDK: tether.sign(png, {issuer, claims, signer, store})
  SDK->>SDK: Watermark (optional) → content hash + perceptual hash
  SDK->>SDK: Sign canonical manifest payload with Signer
  SDK->>Store: store.put(manifest)  (append-only)
  SDK-->>App: { manifest, image }
  App->>C2PA: embed(image, {manifestId, issuer, claims})
  C2PA-->>App: PNG with embedded Content Credential
  App-->>User: Serve/record the published PNG (publish `image`, not the input)

  Note over User,Store: Verify (at lookup)
  User->>App: Submit an image
  App->>C2PA: read(bytes) → credential (optional, independent check)
  App->>App: Normalize to PNG (strips C2PA box)
  App->>SDK: tether.verify(png, {store, trustedPublicKeys})
  SDK->>Store: getByContentHash → else findByFingerprint
  SDK->>Store: isRevoked + historyForIssuer
  SDK-->>App: ProvenanceCard {integrity, signatureValid, revoked, claims}
  App->>App: Apply disclosure + privacy rules (exact-only in this demo)
  App-->>User: Show verified claims or withhold
```

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

1. Give your service an issuer identifier and keep the signing private key **on the server**, never in the React app. Restore with `Ed25519Signer.fromPrivateKeyHex(savedKey)` on restart. For post-quantum signatures, set `TETHER_SIG_ALG=ML-DSA-65` (FIPS 204 / Dilithium) or `TETHER_SIG_ALG=Ed25519+ML-DSA-65` for a hybrid; the `MlDsaSigner` and `HybridSigner` mirror the Ed25519 signer's seed-based key custody. Verification is algorithm-aware, so all three can coexist during migration.
2. Implement the SDK's `ManifestStore` interface with an append-only persistent database (`server/registry.js` is a SQLite reference). Do not use the SDK's `InMemoryManifestStore` for a persistent service.
3. At upload, normalize to PNG while the SDK is PNG-only. Call `const { manifest, image } = await new Tether().sign(pngBytes, { issuer, claims, signer, store })`. Record `manifest`; **publish `image`** (these are the bytes the content hash binds — they differ from the input when a watermarker is used). To emit interoperable Content Credentials, pass `image` through the C2PA step (`server/c2pa.js`) before serving it; `TETHER_C2PA=0` disables that.
4. At lookup, call `tether.verify(pngBytes, { store, trustedPublicKeys: [issuerPublicKey] })`. Show claims only after checking `signatureValid`, `revoked`, and your own match/privacy rules. This demo discloses sample details only for `integrity === 'exact'`.
5. Back up and protect the database, the issuer key, and the C2PA signing cert/key. Add consent, authentication, retention limits, rate limiting, and abuse controls before accepting real data or exposing this on the public internet.

For the reference implementation, see [`server/registry.js`](server/registry.js) and [`src/main.jsx`](src/main.jsx). For SDK API docs and an independent sign/verify sample, see [Tether](https://github.com/specterbuilds/tether).

## Limits and privacy

- The downloaded PNG carries an **embedded C2PA manifest** signed with a **self-issued demo certificate** (auto-generated into `.data/c2pa/` on first run). C2PA tools will show the credential as valid but from an **untrusted source** — expected until that certificate is added to a trust list. Tether additionally keeps its own **external** signed manifest in the registry; neither layer encrypts or embeds the name, age or gender into image pixels.
- The SDK ships a working **LSB watermarker** (`@tether/watermark`), lossless and recoverable across PNG re-encoding but not recompression. This registry demo verifies by content hash + C2PA and does not enable the watermark yet (its exact-byte path re-encodes through sharp). A durable DCT soft-binding mark is the next step. Offline recovery without the registry is not supported.
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

MIT licensed. Visual direction began with the user-provided references: a quiet light workspace, rounded panels, a serif display face (Newsreader with Georgia fallback), and an original generated orange pixel/halftone illustration. A later pass studied the live [Sarvam home page](https://www.sarvam.ai/), [Voice Agents](https://www.sarvam.ai/products/voice-agents), and [Text to Speech](https://www.sarvam.ai/apis/text-to-speech) pages for centered editorial headings, restrained body copy, generous whitespace, and a focused live demo below the hero. Newsreader is retained rather than copying Sarvam's proprietary typography. No reference screenshot or third-party brand asset is embedded.
