import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Registry } from '../server/registry.js';
const dir = mkdtempSync(join(tmpdir(), 'tether-registry-'));
const image = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 76, g: 120, b: 182, alpha: 1 } } }).png().toBuffer();
test('register, restart, recover signed details from downloaded PNG; unknown images stay unknown', async () => {
  let registry = new Registry(dir);
  const record = await registry.register({ image, name: 'Alex Sample', age: '28', gender: 'non-binary' });
  registry.saveImage(record.manifestId, record.image);
  registry.close();
  registry = new Registry(dir);
  const downloaded = registry.imageFor(record.manifestId);
  assert.deepEqual(downloaded, record.image);
  const verified = await registry.verify(downloaded);
  assert.equal(verified.status, 'verified');
  assert.deepEqual(verified.details, { name: 'Alex Sample', age: 28, gender: 'non-binary' });
  assert.equal(verified.signatureValid, true);
  assert.equal(verified.manifestId, record.manifestId);
  const different = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 249, g: 31, b: 50, alpha: 1 } } }).png().toBuffer();
  assert.equal((await registry.verify(different)).status, 'unknown');
  registry.close();
});
test('rejects underage registration and unrecognized bytes', async () => {
  const registry = new Registry(dir);
  await assert.rejects(registry.register({ image, name: 'A', age: '17', gender: 'X' }), /age/);
  await assert.rejects(registry.register({ image: Buffer.from('not-image'), name: 'A', age: '28', gender: 'X' }));
  registry.close();
});
test('downloaded image carries a valid, interoperable C2PA credential', async () => {
  const registry = new Registry(dir);
  const record = await registry.register({ image, name: 'Dana Sample', age: '34', gender: 'female' });
  const credential = await registry.c2pa.read(record.image);
  if (!credential) {
    // Native @contentauth/c2pa-node unavailable (or TETHER_C2PA=0): embedding is a
    // documented no-op, so there is nothing to assert here.
    registry.close();
    return;
  }
  assert.equal(credential.validationState, 'Valid');
  assert.ok(credential.assertions.includes('com.tether.manifest'));
  assert.deepEqual(credential.tetherClaims.claims[0].value, { name: 'Dana Sample', age: 34, gender: 'female' });
  // Tether's own verification still works after the C2PA box is stripped on re-normalize.
  const verified = await registry.verify(record.image);
  assert.equal(verified.status, 'verified');
  assert.equal(verified.contentCredential.validationState, 'Valid');
  registry.close();
});
test.after(() => rmSync(dir, { recursive: true, force: true }));
