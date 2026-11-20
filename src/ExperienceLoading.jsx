import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { normalizeLogoUrl } from './lib/brandTheme.js';
import './experience-loading.css';

const HOLD_MS = 480;
const HANDOFF_MS = 520;
const FADE_MS = 140;

// Both logo boxes use object-fit: contain. Match the painted artwork, including
// when a wide wordmark lands in a square header slot.
function logoHandoff(image, destination) {
  if (!image?.naturalWidth || !destination) return null;
  const target = Array.from(destination.querySelectorAll('header img[data-entry-logo]')).find((element) => {
    const rect = element.getBoundingClientRect();
    const visible = !element.checkVisibility || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    return visible && element.complete && element.naturalWidth && normalizeLogoUrl(element.currentSrc) === normalizeLogoUrl(image.currentSrc)
      && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight
      && rect.left >= 0 && rect.right <= window.innerWidth;
  });
  if (!target) return null;
  const start = image.getBoundingClientRect();
  const end = target.getBoundingClientRect();
  const centerX = end.left + end.width / 2;
  const centerY = end.top + end.height / 2;
  // The destination is inert throughout the opening. Briefly enable hit testing
  // in this layout pass so a welcome sheet covering the logo gets a fade instead.
  const wasInert = destination.inert;
  const pointerEvents = target.style.pointerEvents;
  destination.inert = false;
  target.style.pointerEvents = 'auto';
  let front;
  try {
    front = document.elementsFromPoint(centerX, centerY).find(el => !el.closest('.world-entry'));
  } finally {
    destination.inert = wasInert;
    target.style.pointerEvents = pointerEvents;
  }
  if (front !== target) return null;
  const fit = (box) => Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const dx = centerX - start.left - start.width / 2;
  const dy = centerY - start.top - start.height / 2;
  return { target, transform: `translate(${dx}px, ${dy}px) scale(${fit(end) / fit(start)})` };
}

export default function ExperienceLoading({
  logoUrl, brandName, primary, secondary, logoBlendMode, destinationRef,
  readyToExit = false, onExitComplete,
}) {
  const reduced = useReducedMotion();
  const overlayRef = useRef(null);
  const markRef = useRef(null);
  const imageRef = useRef(null);
  const [imageStatus, setImageStatus] = useState('pending');
  const [held, setHeld] = useState(false);
  const settled = !logoUrl || imageStatus !== 'pending';

  useEffect(() => {
    if (settled) return;
    // A slow logo must not hold an otherwise ready page indefinitely.
    if (!readyToExit) return;
    const timer = window.setTimeout(() => setImageStatus('failed'), 900);
    return () => window.clearTimeout(timer);
  }, [settled, readyToExit]);

  useEffect(() => {
    if (!settled) return;
    const timer = window.setTimeout(() => setHeld(true), reduced || (!brandName && !logoUrl) ? 0 : HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [settled, reduced, brandName, logoUrl]);

  useLayoutEffect(() => {
    if (!readyToExit || !held) return;
    const overlay = overlayRef.current;
    const mark = markRef.current;
    const handoff = !reduced && logoHandoff(imageRef.current, destinationRef?.current);
    const duration = handoff ? HANDOFF_MS : reduced ? FADE_MS : 260;
    overlay.style.setProperty('--entry-exit-time', duration + 'ms');
    overlay.dataset.exiting = 'true';
    const timing = { duration, easing: 'cubic-bezier(.4,0,.18,1)', fill: 'both' };
    const movement = mark.animate(handoff ? [
      { transform: 'none', opacity: 1 },
      { transform: handoff.transform, opacity: 1, offset: .92 },
      { transform: handoff.transform, opacity: 0 },
    ] : [{ opacity: 1 }, { opacity: 0 }], timing);
    const arrival = handoff && handoff.target.animate([
      { opacity: 0 }, { opacity: 0, offset: .86 }, { opacity: 1 },
    ], timing);
    movement.onfinish = () => onExitComplete?.();
    return () => {
      movement.onfinish = null;
      movement.cancel();
      if (arrival) arrival.cancel();
      delete overlay.dataset.exiting;
    };
  }, [held, readyToExit, reduced, destinationRef, onExitComplete]);

  return (
    <div ref={overlayRef} className="world-entry" role="status" aria-label={brandName ? `Opening ${brandName}` : 'Opening page'}
      style={{ '--entry-primary': primary, '--entry-secondary': secondary, '--entry-logo-blend': logoBlendMode }}>
      <div ref={markRef} className="world-entry__mark" style={logoBlendMode ? { mixBlendMode: logoBlendMode } : undefined}>
        {logoUrl && imageStatus !== 'failed' && <img ref={imageRef} className="world-entry__logo" src={logoUrl} alt=""
          data-loaded={imageStatus === 'ready'} onLoad={() => setImageStatus('ready')} onError={() => setImageStatus('failed')} />}
        {(!logoUrl || imageStatus === 'failed') && brandName && <span className="world-entry__name">{brandName}</span>}
        {!brandName && !logoUrl && <span className="world-entry__waiting" aria-hidden="true" />}
      </div>
    </div>
  );
}
