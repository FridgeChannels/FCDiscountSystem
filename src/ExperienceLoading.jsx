import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import MotionArt from './lib/logoMotionRenderer.js';
import { normalizeLogoUrl } from './lib/brandTheme.js';
import './experience-loading.css';

const DURATION = 1800;
export default function ExperienceLoading({ logoUrl, readyToExit = false, onLogoReady, onLogoError, onExitComplete }) {
  const canvasRef = useRef(null);
  const [logoState, setLogoState] = useState({ url: null, status: 'pending' });
  const [animationDone, setAnimationDone] = useState(false);
  const [logoHeld, setLogoHeld] = useState(false);
  const [exiting, setExiting] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    setAnimationDone(false);
    setLogoHeld(false);
    if (!logoUrl) { setLogoState({ url: null, status: 'none' }); return; }
    let active = true;
    const img = new Image();
    const cacheKey = `vivora-opening-logo:${logoUrl}`;
    let cachedLogo = null;
    try { cachedLogo = localStorage.getItem(cacheKey); } catch { /* storage unavailable */ }
    img.crossOrigin = 'anonymous';
    const timeout = window.setTimeout(() => { if (active) { setLogoState({ url: logoUrl, status: 'error' }); onLogoError?.(); } }, 20000);
    img.onload = () => {
      if (!active) return;
      window.clearTimeout(timeout);
      try {
        MotionArt.setUpload(img);
        if (!cachedLogo) { try { const saved = document.createElement('canvas'); const scale = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight)); saved.width = Math.round(img.naturalWidth * scale); saved.height = Math.round(img.naturalHeight * scale); saved.getContext('2d').drawImage(img, 0, 0, saved.width, saved.height); localStorage.setItem(cacheKey, saved.toDataURL('image/png')); } catch { /* cache is optional */ } }
        // Verify that the canvas can read the image before starting playback.
        const probe = document.createElement('canvas'); probe.width = probe.height = 1;
        const ctx = probe.getContext('2d'); ctx.drawImage(img, 0, 0, 1, 1); ctx.getImageData(0, 0, 1, 1);
        setLogoState({ url: logoUrl, status: 'ready' }); onLogoReady?.();
      } catch (error) { console.error('Logo animation preparation failed', error); setLogoState({ url: logoUrl, status: 'error' }); onLogoError?.(); }
    };
    img.onerror = () => { if (active) { window.clearTimeout(timeout); setLogoState({ url: logoUrl, status: 'error' }); onLogoError?.(); } };
    img.src = cachedLogo || normalizeLogoUrl(logoUrl) || logoUrl;
    return () => { active = false; window.clearTimeout(timeout); };
  }, [logoUrl, onLogoReady, onLogoError]);

  useEffect(() => {
    if (logoState.status !== 'ready' || logoState.url !== logoUrl || !canvasRef.current) return;
    let frame, start;
    const preset = MotionArt.presets.find(item => item.id === 'dust');
    const tick = (now) => {
      if (start == null) start = now;
      const progress = reduced ? 1 : Math.min(1, (now - start) / DURATION);
      try { MotionArt.draw(canvasRef.current, { preset, brand: 'custom', color: '#007d89', t: progress, transparentBackground: true }); }
      catch (error) { console.error('Logo animation render failed', error); setLogoState({ url: logoUrl, status: 'error' }); onLogoError?.(); return; }
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setAnimationDone(true);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [logoState, logoUrl, reduced, onLogoError]);

  useEffect(() => {
    if (!animationDone) return;
    const timer = window.setTimeout(() => setLogoHeld(true), reduced ? 0 : 1000);
    return () => window.clearTimeout(timer);
  }, [animationDone, reduced]);

  useEffect(() => {
    if (!readyToExit) return;
    if (logoUrl && logoState.url !== logoUrl) return;
    if (logoState.status === 'ready' && !logoHeld) return;
    if (logoState.status === 'pending') return;
    setExiting(true);
  }, [readyToExit, logoUrl, logoState, logoHeld]);
  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => onExitComplete?.(), reduced ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [exiting, onExitComplete, reduced]);

  return <main className={'world-entry' + (exiting ? ' world-entry--exit' : '')} aria-label="Entering game" aria-busy="true">
    <div className="world-entry__frame world-entry__particle">
      {logoState.status !== 'ready' && logoState.status !== 'error' && <div className="world-entry__waiting" aria-hidden="true" />}
      {logoState.status === 'ready' && <canvas ref={canvasRef} className="world-entry__canvas" aria-hidden="true" />}
      {animationDone && logoState.status === 'ready' && <img className="world-entry__logo-final" src={logoUrl} alt="" />}
      {logoState.status === 'error' && logoUrl && <img className="world-entry__fallback" src={logoUrl} alt="" />}
    </div>
  </main>;
}
