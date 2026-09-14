import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import './experience-loading.css';

const LOADING_VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_083109_283f3553-e28f-428b-a723-d639c617eb2b.mp4';
// Replace only with a background-removed transparent PNG so the video stays visible.
const LOADING_LOGO_SRC = '/loading/logo-cutout.png';

export default function ExperienceLoading({ detail = 'Preparing your experience…', onSkip }) {
  const [isLogoReady, setIsLogoReady] = useState(false);
  const shouldReduceMotion = useReducedMotion();
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
      <div className="fc-experience-loading__logo-stage">
        <motion.div
          className="fc-experience-loading__logo-motion"
          initial={logoHidden}
          animate={isLogoReady ? logoVisible : logoHidden}
          transition={logoTransition}
        >
          <img
            className="fc-experience-loading__logo"
            src={LOADING_LOGO_SRC}
            alt="Brand logo"
            width={1254}
            height={1254}
            decoding="async"
            fetchPriority="high"
            onLoad={() => setIsLogoReady(true)}
          />
        </motion.div>
      </div>
      {onSkip ? (
        <motion.button
          className="fc-experience-loading__skip"
          type="button"
          onClick={onSkip}
          whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          Skip
        </motion.button>
      ) : null}
      <span className="fc-experience-loading__status">{detail}</span>
    </main>
  );
}
