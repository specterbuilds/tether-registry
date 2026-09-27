import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const data = mkdtempSync(join(tmpdir(), 'tether-ui-'));
const api = spawn('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: data, PORT: '3001' }, stdio: 'pipe' });
const web = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5179'], { stdio: 'pipe' });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
const logs = [];
page.on('console', m => { if (m.type() === 'error') { logs.push(m.text()); console.log('CONSOLE', m.text()); } }); page.on('pageerror', e => console.log('PAGEERROR', e.message));
try {
  for (let i = 0; i < 30; i++) { try { await page.goto('http://127.0.0.1:5179/', { waitUntil: 'networkidle' }); break; } catch { await new Promise(r => setTimeout(r, 300)); } }
  mkdirSync('docs', { recursive: true });
  await page.screenshot({ path: 'docs/playground.png', fullPage: true });
  await page.locator('input[placeholder="e.g. Alex Sample"]').fill('Alex Sample');
  await page.locator('input[placeholder="e.g. 28"]').fill('28');
  await page.locator('input[placeholder="e.g. non-binary"]').fill('non-binary');
  const photo = execFileSync('node', ['-e', `import('sharp').then(async ({default:s}) => process.stdout.write(await s({create:{width:128,height:128,channels:4,background:{r:79,g:137,b:198,alpha:1}}}).png().toBuffer()))`]);
  await page.locator('input[type="file"]').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: photo });
  await page.getByRole('button', { name: /Sign & register photo/ }).click();
  await page.getByText('Photo registered.').waitFor();
  await page.screenshot({ path: 'docs/registered.png', fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByText('Download tethered photo').click();
  const download = await downloadPromise;
  const bytes = execFileSync('cat', [await download.path()]);
  // downloaded file captured
  await page.getByRole('tab', { name: /Verify a photo/ }).click();
  // verify tab selected
  await page.locator('input[type="file"]').setInputFiles({ name: 'tethered-photo.png', mimeType: 'image/png', buffer: bytes });
  await page.getByRole('button', { name: /Verify this photo/ }).click();
  await page.getByText('Record found.').waitFor();
  if (!(await page.locator('.result').innerText()).includes('Alex Sample')) throw new Error('Name missing from verified card');
  await page.screenshot({ path: 'docs/verified.png', fullPage: true });
  console.log('Browser flow passed: register -> download -> reupload -> signed details returned. Screenshots docs/playground.png, docs/registered.png, docs/verified.png. Console errors:', logs);
} finally { api.kill('SIGKILL'); web.kill('SIGKILL'); await browser.close(); rmSync(data, { recursive: true, force: true }); }
