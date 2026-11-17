import { useEffect, useMemo, useRef, useState } from 'react';
import DepthProductCanvas from '../reorder/DepthProductCanvas.jsx';
import './productStudio.css';

const PALETTES = {
  studio: { label: 'Clean studio', background: '#f2efe7', primary: '#284b3b', accent: '#d7a55b', surface: '#e8e1d4' },
  editorial: { label: 'Editorial', background: '#e9e2d8', primary: '#30394a', accent: '#bd7661', surface: '#d8cbbd' },
  bold: { label: 'Bold color', background: '#f0e5d6', primary: '#31433d', accent: '#cb7245', surface: '#dcc6ac' },
};

function slug(value) {
  const original = String(value || 'product');
  const latin = original.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (latin) return latin;
  const hash = Array.from(original).reduce((sum, char) => ((sum * 31) + char.codePointAt(0)) >>> 0, 7);
  return `item-${hash.toString(36)}`;
}

function htmlText(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function useObjectUrl(file) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) { setUrl(''); return undefined; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function createHeroBlob(cutout, settings) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cutoutUrl = URL.createObjectURL(cutout);
    image.onload = () => {
      URL.revokeObjectURL(cutoutUrl);
      const drawHero = (brandLogo) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 1500;
      const ctx = canvas.getContext('2d');
      const { palette, brandName, productName, scale } = settings;
      const wash = ctx.createLinearGradient(0, 0, 1200, 1500);
      wash.addColorStop(0, palette.background);
      wash.addColorStop(1, palette.surface);
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const glow = ctx.createRadialGradient(600, 710, 30, 600, 710, 650);
      glow.addColorStop(0, `${palette.accent}30`);
      glow.addColorStop(1, `${palette.accent}00`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 100, 1200, 1180);

      ctx.fillStyle = palette.primary;
      ctx.textAlign = 'center';
      if (brandLogo) {
        const logoScale = Math.min(300 / brandLogo.naturalWidth, 58 / brandLogo.naturalHeight);
        ctx.drawImage(brandLogo, 600 - brandLogo.naturalWidth * logoScale / 2, 48, brandLogo.naturalWidth * logoScale, brandLogo.naturalHeight * logoScale);
      } else {
        ctx.font = '600 34px system-ui, sans-serif';
        ctx.fillText(brandName || 'BRAND', 600, 110);
      }
      ctx.fillStyle = `${palette.primary}aa`;
      ctx.font = '400 22px system-ui, sans-serif';
      ctx.fillText(productName || '', 600, 153);

      const floorY = 1230;
      const floor = ctx.createLinearGradient(0, floorY, 0, 1500);
      floor.addColorStop(0, `${palette.surface}00`);
      floor.addColorStop(.15, `${palette.surface}cc`);
      floor.addColorStop(1, palette.surface);
      ctx.fillStyle = floor;
      ctx.fillRect(0, floorY, 1200, 270);

      const maxHeight = 990 * scale;
      const ratio = Math.min(720 / image.naturalWidth, maxHeight / image.naturalHeight);
      const width = image.naturalWidth * ratio;
      const height = image.naturalHeight * ratio;
      ctx.save();
      ctx.filter = 'blur(34px)';
      ctx.fillStyle = '#1c211c55';
      ctx.beginPath();
      ctx.ellipse(600, floorY + 9, Math.max(90, width * .34), 34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const contact = ctx.createRadialGradient(600, floorY, 3, 600, floorY, Math.max(100, width * .38));
      contact.addColorStop(0, '#27241f55');
      contact.addColorStop(.55, '#27241f1c');
      contact.addColorStop(1, '#27241f00');
      ctx.fillStyle = contact;
      ctx.fillRect(600 - width * .55, floorY - 30, width * 1.1, 70);
      ctx.drawImage(image, 600 - width / 2, floorY - height, width, height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not render the hero image.')), 'image/png');
      };
      if (settings.logoUrl) {
        const brandLogo = new Image();
        brandLogo.onload = () => drawHero(brandLogo);
        brandLogo.onerror = () => drawHero(null);
        brandLogo.src = settings.logoUrl;
      } else drawHero(null);
    };
    image.onerror = () => { URL.revokeObjectURL(cutoutUrl); reject(new Error('Could not read the prepared cutout.')); };
    image.src = cutoutUrl;
  });
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = new Uint8Array(file.bytes);
    const crc = crc32(data);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true); header.set(name, 30);
    local.push(header, data);

    const directory = new Uint8Array(46 + name.length);
    const dir = new DataView(directory.buffer);
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x800, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, data.length, true); dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true); dir.setUint32(42, offset, true); directory.set(name, 46);
    central.push(directory);
    offset += header.length + data.length;
  }
  const directorySize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, files.length, true); endView.setUint16(10, files.length, true);
  endView.setUint32(12, directorySize, true); endView.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ProductStudio() {
  const [brandName, setBrandName] = useState('');
  const [productName, setProductName] = useState('');
  const [brandColor, setBrandColor] = useState('#28513e');
  const [accentColor, setAccentColor] = useState('#d49a56');
  const [backgroundColor, setBackgroundColor] = useState(PALETTES.studio.background);
  const [sourceFile, setSourceFile] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [paletteKey, setPaletteKey] = useState('studio');
  const [cutout, setCutout] = useState(null);
  const [depthMap, setDepthMap] = useState(null);
  const [heroBlob, setHeroBlob] = useState(null);
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [edgeChecked, setEdgeChecked] = useState(false);
  const [labelChecked, setLabelChecked] = useState(false);
  const [depthChecked, setDepthChecked] = useState(false);
  const [sceneChecked, setSceneChecked] = useState(false);
  const workerRef = useRef(null);
  const sourceUrl = useObjectUrl(sourceFile);
  const cutoutUrl = useObjectUrl(cutout);
  const depthUrl = useObjectUrl(depthMap);
  const logoUrl = useObjectUrl(logoFile);

  const palette = useMemo(() => ({
    ...PALETTES[paletteKey], primary: brandColor, accent: accentColor, background: backgroundColor,
  }), [paletteKey, brandColor, accentColor, backgroundColor]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  useEffect(() => {
    setSceneChecked(false);
  }, [brandName, productName, palette, scale, logoUrl, cutout]);

  useEffect(() => {
    let active = true;
    if (!cutout) { setHeroBlob(null); return undefined; }
    createHeroBlob(cutout, { palette, brandName, productName, scale, logoUrl })
      .then((blob) => { if (active) setHeroBlob(blob); })
      .catch((error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [cutout, palette, brandName, productName, scale, logoUrl]);

  const processSource = () => {
    if (!sourceFile) return;
    workerRef.current?.terminate();
    setCutout(null); setDepthMap(null); setHeroBlob(null); setStatus('processing'); setMessage('Loading the image segmentation model for the first time…');
    setProgress(0); setEdgeChecked(false); setLabelChecked(false); setDepthChecked(false); setSceneChecked(false);
    const worker = new Worker(new URL('../reorder/productCutout.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const id = `${Date.now()}-${Math.random()}`;
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'progress') {
        const value = data.progress?.progress;
        if (Number.isFinite(value)) setProgress(value);
        setMessage(data.progress?.file || 'Preparing product cutout…');
        return;
      }
      if (data.id !== id) return;
      if (data.type === 'result' && data.blob) {
        setCutout(data.blob); setStatus('depth'); setMessage('Cutout ready. Generating a depth map for the 2.5D layers…'); worker.terminate();
        const depthWorker = new Worker(new URL('../reorder/productCutout.worker.js', import.meta.url), { type: 'module' });
        workerRef.current = depthWorker;
        const depthId = `${Date.now()}-${Math.random()}`;
        depthWorker.onmessage = (depthEvent) => {
          const result = depthEvent.data || {};
          if (result.type === 'progress') {
            const value = result.progress?.progress;
            if (Number.isFinite(value)) setProgress(value);
            setMessage(result.progress?.file || 'Estimating product depth…');
            return;
          }
          if (result.id !== depthId) return;
          if (result.type === 'depth-result' && result.blob) {
            setDepthMap(result.blob); setStatus('ready'); setMessage('Cutout and depth map are ready. Review both before export.'); depthWorker.terminate();
          } else if (result.type === 'error') {
            setStatus('error'); setMessage(result.message || 'Depth estimation failed.'); depthWorker.terminate();
          }
        };
        depthWorker.onerror = () => { setStatus('error'); setMessage('The depth estimator failed to start. Retry with a smaller source image.'); depthWorker.terminate(); };
        depthWorker.postMessage({ id: depthId, action: 'depth', blob: sourceFile, cutoutBlob: data.blob, crop: data.crop });
      } else if (data.type === 'error') {
        setStatus('error'); setMessage(data.message || 'Segmentation failed.'); worker.terminate();
      }
    };
    worker.onerror = () => { setStatus('error'); setMessage('The image processor failed to start. Try a smaller source image.'); worker.terminate(); };
    worker.postMessage({ id, blob: sourceFile });
  };

  const exportPackage = async () => {
    if (!brandName.trim() || !productName.trim() || !cutout || !depthMap || !heroBlob || !edgeChecked || !labelChecked || !depthChecked || !sceneChecked) return;
    const sourceExt = sourceFile.name.split('.').pop().replace(/[^a-z0-9]/gi, '') || 'img';
    const logoExt = logoFile?.name.split('.').pop().replace(/[^a-z0-9]/gi, '') || 'img';
    const safeBrand = htmlText(brandName || 'YOUR BRAND');
    const safeProduct = htmlText(productName);
    const manifest = {
      schemaVersion: 1,
      brand: { id: slug(brandName), name: brandName, logo: logoFile ? `brand-logo.${logoExt}` : null, colors: { primary: brandColor, accent: accentColor, background: backgroundColor }, scenePreset: paletteKey },
      product: { id: slug(productName), name: productName, source: sourceFile.name },
      assets: { source: `source-image.${sourceExt}`, cutout: 'cutout.png', depthMap: 'depth-map.png', hero: 'hero.png' },
      composition: { aspectRatio: '4:5', subjectScale: scale, parallaxReady: true, depthModel: 'depth-anything-v2-small', depthIsRelative: true, layers: [{ id: 'background', type: 'brand-scene' }, { id: 'contact-shadow', type: 'procedural' }, { id: 'product', image: 'cutout.png', depth: 'depth-map.png' }], surfaceColor: palette.surface },
      integration: { productField: 'visualAssets', value: { cutout: `/reorder/${slug(brandName)}/${slug(productName)}/cutout.png`, depthMap: `/reorder/${slug(brandName)}/${slug(productName)}/depth-map.png`, scene: { background: backgroundColor, surface: palette.surface, accent: accentColor } } },
      review: { edge: 'pass', label: 'pass', depth: 'relative depth visually reviewed', scene: 'brand fit and lighting visually reviewed', approvedAt: new Date().toISOString() },
    };
    const previewHtml = `<!doctype html><meta name="viewport" content="width=device-width"><title>${safeBrand} · ${safeProduct}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161c18;font:16px system-ui}.frame{width:min(90vw,560px);overflow:hidden;border-radius:24px;box-shadow:0 28px 90px #0008}img{display:block;width:100%;height:auto}</style><div class="frame"><img src="hero.png" alt="${htmlText(`${brandName} ${productName}`)}"></div>`;
    const files = await Promise.all([
      cutout.arrayBuffer().then((bytes) => ({ name: 'cutout.png', bytes })),
      depthMap.arrayBuffer().then((bytes) => ({ name: 'depth-map.png', bytes })),
      heroBlob.arrayBuffer().then((bytes) => ({ name: 'hero.png', bytes })),
      sourceFile.arrayBuffer().then((bytes) => ({ name: `source-image.${sourceExt}`, bytes })),
    ]);
    if (logoFile) files.push(await logoFile.arrayBuffer().then((bytes) => ({ name: `brand-logo.${logoExt}`, bytes })));
    const zip = makeZip([...files,
      { name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
      { name: 'preview.html', bytes: new TextEncoder().encode(previewHtml) },
    ]);
    download(zip, `${slug(brandName)}-${slug(productName)}-2p5d.zip`);
  };

  return (
    <main className="ps-app">
      <header className="ps-topbar"><div className="ps-mark">FC</div><span>Product Studio</span><span className="ps-topbar__tag">2.5D asset workflow</span></header>
      <div className="ps-layout">
        <section className="ps-editor" aria-label="Product setup">
          <div className="ps-intro"><p className="ps-eyebrow">BRAND ASSET WORKFLOW</p><h1>Build a product scene</h1><p>Turn a product photo into a reviewed, brand-colored hero asset package.</p></div>

          <section className="ps-step"><div className="ps-step__heading"><span>01</span><div><h2>Brand identity</h2><p>Set the colors and visual direction for this brand.</p></div></div>
            <label className="ps-field">Brand name<input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="e.g. PURA JUICE" /></label>
            <label className="ps-field">Logo file <span className="ps-optional">Optional</span><input type="file" accept="image/*,.svg" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} /></label>
            <div className="ps-colors"><label className="ps-field">Primary color<input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} /></label><label className="ps-field">Accent color<input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} /></label></div>
            <label className="ps-field">Scene direction<select value={paletteKey} onChange={(e) => { setPaletteKey(e.target.value); setBackgroundColor(PALETTES[e.target.value].background); }}>{Object.entries(PALETTES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
            <label className="ps-field">Scene background<input type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} /></label>
          </section>

          <section className="ps-step"><div className="ps-step__heading"><span>02</span><div><h2>Product photo</h2><p>Use a clear, complete front-facing image.</p></div></div>
            <label className="ps-upload"><input type="file" accept="image/*" onChange={(e) => { workerRef.current?.terminate(); setSourceFile(e.target.files?.[0] || null); setCutout(null); setDepthMap(null); setMessage(''); setStatus('idle'); setEdgeChecked(false); setLabelChecked(false); setDepthChecked(false); setSceneChecked(false); }} /><span className="ps-upload__icon">↑</span><b>{sourceFile?.name || 'Choose a product image'}</b><small>PNG, JPG, or WebP · transparent backgrounds work best</small></label>
            <label className="ps-field">Product name<input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. Orange Juice, 12 bottles" /></label>
            <button className="ps-primary" type="button" onClick={processSource} disabled={!sourceFile || status === 'processing'}>{status === 'processing' ? 'Preparing cutout…' : 'Prepare product cutout'}</button>
            {(status === 'processing' || status === 'depth') && <div className="ps-progress"><span style={{ width: `${Math.max(4, progress)}%` }} /></div>}
            {message && <p className={`ps-message ps-message--${status}`} role="status">{message}</p>}
          </section>

          <section className={`ps-step${cutout ? '' : ' ps-step--muted'}`}><div className="ps-step__heading"><span>03</span><div><h2>Review & export</h2><p>Approve the cutout before creating the package.</p></div></div>
            <label className="ps-check"><input type="checkbox" checked={edgeChecked} disabled={!cutout || !depthMap} onChange={(e) => setEdgeChecked(e.target.checked)} /><span><b>Edges checked</b><small>No halos, holes, or missing product details</small></span></label>
            <label className="ps-check"><input type="checkbox" checked={labelChecked} disabled={!cutout || !depthMap} onChange={(e) => setLabelChecked(e.target.checked)} /><span><b>Label checked</b><small>Brand marks and text remain clear</small></span></label>
            <label className="ps-check"><input type="checkbox" checked={depthChecked} disabled={!depthMap} onChange={(e) => setDepthChecked(e.target.checked)} /><span><b>Depth map checked</b><small>Depth stays within the product silhouette</small></span></label>
            <label className="ps-check"><input type="checkbox" checked={sceneChecked} disabled={!heroBlob} onChange={(e) => setSceneChecked(e.target.checked)} /><span><b>Brand scene checked</b><small>Colors, product scale, and contact shadow fit the brand</small></span></label>
            <button className="ps-export" type="button" disabled={!brandName.trim() || !productName.trim() || !cutout || !depthMap || !heroBlob || !edgeChecked || !labelChecked || !depthChecked || !sceneChecked} onClick={exportPackage}>Download reviewed asset package</button>
          </section>
          <p className="ps-footnote">Images stay in your browser. First use downloads the segmentation/depth models and inference runtime; review the cutout and depth map before export.</p>
        </section>

        <section className="ps-preview-panel" aria-label="Live 2.5D preview">
          <div className="ps-preview-panel__head"><div><p className="ps-eyebrow">LIVE PREVIEW</p><h2>{productName || 'Your product'}</h2></div><span className="ps-aspect">4:5 · Mobile hero</span></div>
          <div className={`ps-scene ps-scene--${paletteKey}`} style={{ '--ps-bg': palette.background, '--ps-surface': palette.surface, '--ps-primary': palette.primary, '--ps-accent': palette.accent }}>
            <div className="ps-scene__wash" />
            <div className="ps-scene__brand">{logoUrl ? <img src={logoUrl} alt={brandName} /> : <span>{brandName || 'YOUR BRAND'}</span>}<small>{productName || 'Product name'}</small></div>
            <div className="ps-scene__floor" />
            {cutoutUrl ? <>
              <div className="ps-scene__contact" style={{ transform: `translateX(-50%) scale(${scale})` }} />
              {depthUrl ? <DepthProductCanvas cutoutUrl={cutoutUrl} depthUrl={depthUrl} scale={scale} className="ps-scene__depth-product" fallbackClassName="ps-scene__product" /> : <img className="ps-scene__product" src={cutoutUrl} alt="Prepared product cutout" style={{ transform: `translate(-50%, -50%) scale(${scale})` }} />}
            </> : sourceUrl ? <img className="ps-scene__source" src={sourceUrl} alt="Product source preview" /> : <div className="ps-scene__empty"><span>◇</span><b>Product scene</b><small>Add brand colors and a product photo to begin</small></div>}
            <div className="ps-scene__footer"><span>{brandName || 'Brand'}</span><i /> <span>PRODUCT STUDIO</span></div>
          </div>
          {depthUrl && <div className="ps-depth-preview"><img src={depthUrl} alt="Estimated relative depth map" /><span><b>Depth layer ready</b><small>Relative depth estimate · inspect boundaries before export</small></span></div>}
          <div className="ps-scale"><span>Product scale</span><input type="range" min="0.75" max="1.2" step="0.01" value={scale} onChange={(e) => setScale(Number(e.target.value))} /><b>{Math.round(scale * 100)}%</b></div>
          <div className="ps-preview-note"><span>✦</span><p>Move your pointer over the scene to preview a subtle displacement driven by the estimated depth map. The package includes the original, cutout, relative depth map, brand scene, and a rendered hero.</p></div>
        </section>
      </div>
    </main>
  );
}
