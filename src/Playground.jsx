import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './playground.css';

/**
 * Tether Playground — a node-graph dashboard that runs the real registry
 * pipeline and draws each step as a connected node, in real time.
 *
 * Flow: drop an image -> fill in details -> the pipeline cascades
 * (normalize, fingerprint, sign, C2PA, store, output) -> then it recovers
 * the image back from the registry and reveals the signed details.
 */

// Layout geometry for the flowing node canvas.
const NODE_W = 248;
const STEP_X = 336;   // horizontal distance between node columns
const BASE_Y = 96;
const ALT_Y = 188;    // vertical offset for alternating nodes
const ANCHOR = 78;    // connector attaches this far below a node's top

const META = {
  input:       { tag: 'INPUT',    accent: 'indigo',  glyph: '▣', title: 'Your image',          desc: 'The photo you dropped in.' },
  details:     { tag: 'DETAILS',  accent: 'violet',  glyph: '✎', title: 'Your information',     desc: 'Add the details to attest to this photo.' },
  normalize:   { tag: 'PREPARE',  accent: 'slate',   glyph: '⌗', title: 'Normalize',            desc: 'Rotate, resize and convert to PNG (sharp).' },
  fingerprint: { tag: 'BIND',     accent: 'teal',    glyph: '❋', title: 'Fingerprint',          desc: 'SHA-256 + a 128-bit perceptual hash.' },
  sign:        { tag: 'SIGN',     accent: 'blue',    glyph: '✒', title: 'Sign manifest',        desc: 'Ed25519 signature over the canonical record.' },
  credential:  { tag: 'C2PA',     accent: 'amber',   glyph: '◆', title: 'Content Credential',   desc: 'Embed an interoperable C2PA manifest (ES256).' },
  store:       { tag: 'REGISTRY', accent: 'green',   glyph: '▤', title: 'Store',                desc: 'Saved to the append-only signed registry.' },
  output:      { tag: 'OUTPUT',   accent: 'indigo',  glyph: '↧', title: 'Tethered image',       desc: 'A signed PNG, ready to download.' },
  recover:     { tag: 'RECOVER',  accent: 'violet',  glyph: '⟲', title: 'Match & verify',       desc: 'Resolve the image back to its record by hash.' },
  reveal:      { tag: 'REVEAL',   accent: 'emerald', glyph: '✦', title: 'Registered details',   desc: 'The signed information comes back.' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function Chip({ accent, glyph }) {
  return <span className={`pg-chip accent-${accent}`} aria-hidden="true">{glyph}</span>;
}

function nodePos(index) {
  return { left: 48 + index * STEP_X, top: BASE_Y + (index % 2) * ALT_Y };
}

export default function Playground() {
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [nodes, setNodes] = useState([]);       // ordered; order === visual order
  const [form, setForm] = useState({ name: '', age: '', gender: '' });
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef(null);
  const decryptRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => { document.title = 'Tether Playground'; }, []);

  const setNode = useCallback((key, patch) => {
    setNodes((list) => list.map((n) => (n.key === key ? { ...n, ...patch } : n)));
  }, []);

  const scrollToEnd = useCallback(() => {
    const el = canvasRef.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToEnd(); }, [nodes.length, scrollToEnd]);

  function insertImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setPhoto(file);
    setPreview(url);
    setDone(false);
    setNodes([
      { key: 'input', type: 'input', status: 'done', preview: url, name: file.name },
      { key: 'details', type: 'details', status: 'await' },
    ]);
  }

  // Adds a running node, waits, then marks it done — the "real time" cascade.
  const addStep = useCallback(async (type, data = {}) => {
    setNodes((list) => [...list, { key: type, type, status: 'running', ...data }]);
    await sleep(140);
    scrollToEnd();
    await sleep(620);
    setNodes((list) => list.map((n) => (n.key === type ? { ...n, status: 'done' } : n)));
  }, [scrollToEnd]);

  async function run(e) {
    e?.preventDefault();
    if (!photo || running) return;
    if (!form.name || !form.age || !form.gender) return;
    setRunning(true);
    setNode('details', { status: 'done', summary: form });

    const fd = new FormData();
    fd.append('image', photo);
    fd.append('name', form.name);
    fd.append('age', form.age);
    fd.append('gender', form.gender);
    const registerPromise = fetch('/api/register', { method: 'POST', body: fd }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Registration failed.');
      return j;
    });

    try {
      await addStep('normalize');
      await addStep('fingerprint');
      const reg = await registerPromise;
      await addStep('sign', { manifestId: reg.manifestId });
      await addStep('credential');
      await addStep('store', { manifestId: reg.manifestId });
      await addStep('output', { downloadUrl: reg.downloadUrl, manifestId: reg.manifestId });

      await addStep('recover');
      const blob = await fetch(reg.downloadUrl).then((r) => r.blob());
      const vf = new FormData();
      vf.append('image', blob, 'tethered-photo.png');
      const card = await fetch('/api/verify', { method: 'POST', body: vf }).then((r) => r.json());
      await addStep('reveal', { card });
      setDone(true);
    } catch (err) {
      setNodes((list) => {
        const last = [...list].reverse().find((n) => n.status === 'running');
        return list.map((n) => (last && n.key === last.key ? { ...n, status: 'error', error: err.message } : n));
      });
    } finally {
      setRunning(false);
    }
  }

  // Decrypt flow: take a previously downloaded tethered PNG and recover its
  // record directly — resolve by hash, then reveal the registered details.
  async function runDecrypt(file) {
    if (!file || running) return;
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setDone(false);
    setRunning(true);
    setNodes([{ key: 'input', type: 'input', status: 'done', preview: url, name: file.name }]);
    try {
      await addStep('recover');
      const vf = new FormData();
      vf.append('image', file, file.name || 'tethered-photo.png');
      const card = await fetch('/api/verify', { method: 'POST', body: vf }).then((r) => r.json());
      await addStep('reveal', { card });
      setDone(true);
    } catch (err) {
      setNodes((list) => {
        const last = [...list].reverse().find((n) => n.status === 'running');
        return list.map((n) => (last && n.key === last.key ? { ...n, status: 'error', error: err.message } : n));
      });
    } finally {
      setRunning(false);
      if (decryptRef.current) decryptRef.current.value = '';
    }
  }

  function reset() {
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(null); setPreview(''); setNodes([]); setForm({ name: '', age: '', gender: '' });
    setRunning(false); setDone(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  const canvasWidth = Math.max(900, 48 + nodes.length * STEP_X + NODE_W);
  const connectors = useMemo(() => {
    const segs = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodePos(i), b = nodePos(i + 1);
      const x1 = a.left + NODE_W, y1 = a.top + ANCHOR;
      const x2 = b.left, y2 = b.top + ANCHOR;
      const dx = Math.max(60, (x2 - x1) / 2);
      segs.push({ key: `${i}`, d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, x2, y2 });
    }
    return segs;
  }, [nodes.length]);

  return (
    <div className="pg-root">
      <header className="pg-bar">
        <div className="pg-brand">
          <span className="pg-logo" aria-hidden="true">t<span>·</span></span>
          <div>
            <h1 className="pg-h1">Tether Playground</h1>
            <p className="pg-sub">Drop an image and watch the real provenance pipeline run, node by node.</p>
          </div>
        </div>
        <div className="pg-actions">
          <a className="pg-ghost" href="/">← Back to site</a>
          {nodes.length > 0 && <button className="pg-ghost" onClick={reset} disabled={running}>Reset</button>}
          <button className="pg-ghost pg-decrypt" onClick={() => decryptRef.current?.click()} disabled={running}>Decrypt a tethered image</button>
          <button className="pg-primary" onClick={() => fileRef.current?.click()} disabled={running}>
            {nodes.length ? 'Replace image' : 'Insert image'}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={(e) => insertImage(e.target.files?.[0])} />
          <input ref={decryptRef} type="file" accept="image/png" hidden
            onChange={(e) => runDecrypt(e.target.files?.[0])} />
        </div>
      </header>

      <div className="pg-canvas" ref={canvasRef}>
        {nodes.length === 0 ? (
          <div className="pg-empty"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); insertImage(e.dataTransfer.files?.[0]); }}
            onClick={() => fileRef.current?.click()} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') fileRef.current?.click(); }}>
            <span className="pg-empty-icon" aria-hidden="true">▣</span>
            <strong>Insert an image to begin</strong>
            <small>Drop a PNG, JPEG or WebP, or click to choose. Already have a tethered PNG? Use <b>Decrypt a tethered image</b> above to recover its record. Use a non-sensitive image and made-up details.</small>
          </div>
        ) : (
          <div className="pg-stage" style={{ width: canvasWidth }}>
            <svg className="pg-wires" width={canvasWidth} height="520" aria-hidden="true">
              {connectors.map((c) => (
                <g key={c.key} className="pg-wire">
                  <path d={c.d} />
                  <circle cx={c.x2} cy={c.y2} r="3.5" />
                </g>
              ))}
            </svg>
            {nodes.map((n, i) => (
              <Node key={n.key} node={n} pos={nodePos(i)} form={form} setForm={setForm}
                onRun={run} running={running} />
            ))}
          </div>
        )}
      </div>

      <footer className="pg-foot-note">
        <span className={`pg-status ${running ? 'live' : done ? 'ok' : ''}`}>
          <span className="pg-dot" /> {running ? 'Pipeline running…' : done ? 'Round trip complete' : 'Idle'}
        </span>
        <span>Provenance, not encryption — details are resolved from the signed registry by image hash.</span>
      </footer>
    </div>
  );
}

function Node({ node, pos, form, setForm, onRun, running }) {
  const meta = META[node.type];
  const footer = node.status === 'running' ? 'Running…'
    : node.status === 'error' ? 'Failed'
    : node.status === 'await' ? 'Waiting for you'
    : 'Connected';
  return (
    <div className={`pg-node accent-${meta.accent} status-${node.status}`} style={{ left: pos.left, top: pos.top }}>
      <div className="pg-node-head">
        <Chip accent={meta.accent} glyph={meta.glyph} />
        <div className="pg-node-heading">
          <div className="pg-tag">{meta.tag}</div>
          <div className="pg-title">{meta.title}</div>
        </div>
      </div>
      <p className="pg-desc">{node.error || meta.desc}</p>
      <NodeBody node={node} form={form} setForm={setForm} onRun={onRun} running={running} />
      <div className="pg-foot">
        <span className="pg-foot-dot" />{footer}
      </div>
    </div>
  );
}

function NodeBody({ node, form, setForm, onRun, running }) {
  if (node.type === 'input') {
    return (
      <div className="pg-media">
        <img src={node.preview} alt="Inserted preview" />
        <span className="pg-media-cap">{node.name || 'image'}</span>
      </div>
    );
  }
  if (node.type === 'details') {
    if (node.status === 'await') {
      return (
        <form className="pg-form" onSubmit={onRun}>
          <label>NAME<input required maxLength={80} placeholder="e.g. Alex Sample"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <div className="pg-form-row">
            <label>AGE<input required type="number" min={18} max={120} placeholder="28"
              value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} /></label>
            <label>GENDER<input required maxLength={40} placeholder="non-binary"
              value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} /></label>
          </div>
          <button className="pg-node-btn" type="submit" disabled={running}>Run pipeline →</button>
        </form>
      );
    }
    return (
      <dl className="pg-kv">
        <div><dt>Name</dt><dd>{node.summary?.name}</dd></div>
        <div><dt>Age</dt><dd>{node.summary?.age}</dd></div>
        <div><dt>Gender</dt><dd>{node.summary?.gender}</dd></div>
      </dl>
    );
  }
  if ((node.type === 'sign' || node.type === 'store') && node.manifestId) {
    return <code className="pg-code">{node.manifestId}</code>;
  }
  if (node.type === 'output' && node.downloadUrl) {
    return <a className="pg-node-btn" href={node.downloadUrl} download="tethered-photo.png">Download PNG ↓</a>;
  }
  if (node.type === 'reveal' && node.card) {
    const c = node.card;
    const d = c.details;
    if (c.status !== 'verified') {
      return (
        <div className="pg-reveal">
          <div className="pg-badge warn">{c.message || 'No matching record in the registry.'}</div>
          {c.contentCredential && (
            <div className="pg-badges">
              <span className={`pg-badge ${c.contentCredential.validationState === 'Valid' ? 'ok' : 'warn'}`}>
                C2PA {c.contentCredential.validationState}
              </span>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="pg-reveal">
        <dl className="pg-kv">
          <div><dt>Name</dt><dd>{d?.name}</dd></div>
          <div><dt>Age</dt><dd>{d?.age}</dd></div>
          <div><dt>Gender</dt><dd>{d?.gender}</dd></div>
          <div><dt>Issued by</dt><dd>{c.issuer}</dd></div>
        </dl>
        <div className="pg-badges">
          <span className="pg-badge ok">Exact match</span>
          <span className="pg-badge ok">Signature valid</span>
          {c.contentCredential && (
            <span className={`pg-badge ${c.contentCredential.validationState === 'Valid' ? 'ok' : 'warn'}`}>
              C2PA {c.contentCredential.validationState}
            </span>
          )}
        </div>
      </div>
    );
  }
  return null;
}
