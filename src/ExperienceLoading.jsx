import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import './experience-loading.css';

const LOADING_VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_083109_283f3553-e28f-428b-a723-d639c617eb2b.mp4';

export default function ExperienceLoading({
  detail = 'Preparing your experience…',
  logoUrl = null,
  brandName = null,
  onLogoReady,
  onLogoError,
}) {
  const [isLogoReady, setIsLogoReady] = useState(false);
  const imgRef = useRef(null);
  const notifiedRef = useRef(false);
  const shouldReduceMotion = useReducedMotion();
  const resolvedLogo = typeof logoUrl === 'string' && logoUrl.trim()
    ? logoUrl.trim()
    : null;
  const logoAlt = brandName ? `${brandName} logo` : 'Brand logo';

  const markReady = () => {
    setIsLogoReady(true);
    if (notifiedRef.current) return;
    notifiedRef.current = true;
    onLogoReady?.();
  };

  const markError = () => {
    setIsLogoReady(false);
    if (notifiedRef.current) return;
    notifiedRef.current = true;
    onLogoError?.();
  };

  useEffect(() => {
    notifiedRef.current = false;
    setIsLogoReady(false);
  }, [resolvedLogo]);

  useEffect(() => {
    if (!resolvedLogo) return undefined;
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      markReady();
      return undefined;
    }
    // Slow CDN: don't block the rest of entry forever.
    const timer = window.setTimeout(() => {
      if (!notifiedRef.current) markError();
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [resolvedLogo]);

  const logoHidden = shouldReduceMotion
    ? { opacity: 0, y: 0, scale: 1, rotate: 0 }
    : { opacity: 0, y: -42, scale: 0.88, rotate: -2 };
  const logoVisible = { opacity: 1, y: 0, scale: 1, rotate: 0 };
  const logoTransition = shouldReduceMotion
    ? { duration: 0 }
    : {
      opacity: { duration: 0.32, ease: 'easeOut', delay: 0.06 },
      y: { type: 'spring', stiffness: 82, damping: 16, mass: 0.9 },
      scale: { type: 'spring', stiffness: 82, damping: 16, mass: 0.9 },
      rotate: { type: 'spring', stiffness: 82, damping: 16, mass: 0.9 },
    };

  return (
    <main className="fc-experience-loading" aria-busy="true" aria-live="polite">
      <video
        className="fc-experience-loading__video"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
      >
        <source src={LOADING_VIDEO_SRC} type="video/mp4" />
      </video>
      {resolvedLogo ? (
        <div className="fc-experience-loading__logo-stage">
          <motion.div
            className="fc-experience-loading__logo-motion"
            initial={logoHidden}
            animate={isLogoReady ? logoVisible : logoHidden}
            transition={logoTransition}
          >
            <img
              key={resolvedLogo}
              ref={imgRef}
              className="fc-experience-loading__logo"
              src={resolvedLogo}
              alt={logoAlt}
              width={198}
              height={127}
              decoding="async"
              fetchPriority="high"
              onLoad={markReady}
              onError={markError}
            />
          </motion.div>
        </div>
      ) : null}
      <span className="fc-experience-loading__status">{detail}</span>
    </main>
  );
}
