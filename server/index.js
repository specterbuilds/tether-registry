import express from 'express';
import multer from 'multer';
import { resolve } from 'node:path';
import { Registry } from './registry.js';
const app = express();
const registry = new Registry(resolve(process.env.DATA_DIR || './.data'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
app.disable('x-powered-by');
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.post('/api/register', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose an image.' });
    const result = await registry.register({ image: req.file.buffer, ...req.body });
    registry.saveImage(result.manifestId, result.image);
    res.status(201).json({ manifestId: result.manifestId, createdAt: result.createdAt, downloadUrl: `/api/images/${result.manifestId}` });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/verify', upload.single('image'), async (req, res) => {
  try { if (!req.file) return res.status(400).json({ error: 'Choose an image.' }); res.json(await registry.verify(req.file.buffer)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/images/:id', (req, res) => {
  const image = registry.imageFor(req.params.id);
  if (!image) return res.sendStatus(404);
  res.type('png').set('Content-Disposition', 'attachment; filename="tethered-photo.png"').send(image);
});
app.use((err, _req, res, _next) => res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 8 MB.' : 'Invalid upload.' }));
const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', () => console.log(`Tether registry API at http://127.0.0.1:${port}`));
