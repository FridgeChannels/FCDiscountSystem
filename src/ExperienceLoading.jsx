import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { gsap } from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import BrandBirdVector from './BrandBirdVector.jsx';
import launchSoundSrc from './rive/brand-bird/assets/brand-launch-whoosh.wav';
import './experience-loading.css';

gsap.registerPlugin(MotionPathPlugin);

const LOADING_VIDEO_SRC = '/loading/loading-bg.mp4';
const LOADING_VIDEO_POSTER = '/loading/loading-bg-poster.webp';
const SPARKS = [
  [-320, -210], [-260, -320], [-120, -280], [40, -310], [210, -250], [330, -145],
  [350, -10], [320, 160], [200, 270], [80, 320], [-90, 300], [-250, 230],
  [-350, 110], [-380, 0], [-320, -120], [-205, -50], [-100, -140], [20, -150],
  [160, -90], [250, 40], [160, 135], [40, 205], [-130, 170], [-250, 40],
];

export default function ExperienceLoading({
  detail = 'Preparing your experience…',
  videoEnabled = true,
  logoUrl = null,
  brandName = null,
  brandReady = false,
  readyToExit = false,
  onLogoReady,
  onLogoError,
  onExitComplete,
}) {
  const rootRef = useRef(null);
  const introTimelineRef = useRef(null);
  const onExitCompleteRef = useRef(onExitComplete);
  const audioRef = useRef(null);
  const [isLogoReady, setIsLogoReady] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [introComplete, setIntroComplete] = useState(false);
  const imgRef = useRef(null);
  const notifiedRef = useRef(false);
  const shouldReduceMotion = useReducedMotion();
  const resolvedLogo = typeof logoUrl === 'string' && logoUrl.trim()
    ? logoUrl.trim()
    : null;
  const displayBrand = typeof brandName === 'string' && brandName.trim()
    ? brandName.trim()
    : null;
  const visibleLogo = logoFailed ? null : resolvedLogo;
  const showBrandCard = brandReady && Boolean(displayBrand || visibleLogo);

  useEffect(() => {
    onExitCompleteRef.current = onExitComplete;
  }, [onExitComplete]);

  const markReady = useCallback(() => {
    setIsLogoReady(true);
    if (notifiedRef.current) return;
    notifiedRef.current = true;
    onLogoReady?.();
  }, [onLogoReady]);

  const markError = useCallback(() => {
    setLogoFailed(true);
    if (notifiedRef.current) return;
    notifiedRef.current = true;
    onLogoError?.();
  }, [onLogoError]);

  useEffect(() => {
    notifiedRef.current = false;
    setIsLogoReady(false);
    setLogoFailed(false);
  }, [resolvedLogo]);

  useEffect(() => {
    if (!resolvedLogo) return undefined;
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      markReady();
      return undefined;
    }
    // A slow brand CDN must not hold the entry shell forever.
    const timer = window.setTimeout(() => {
      if (!notifiedRef.current) markError();
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [markError, markReady, resolvedLogo]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const context = gsap.context(() => {
      const camera = root.querySelector('.fc-loading__camera');
      const bird = root.querySelector('.fc-loading__bird-flight');
      const rays = root.querySelector('.fc-loading__burst-rays');
      const core = root.querySelector('.fc-loading__burst-core');
      const rings = root.querySelectorAll('.fc-loading__shockwave');
      const flash = root.querySelector('.fc-loading__flash');
      const halo = root.querySelector('.fc-loading__halo');
      const orbits = root.querySelectorAll('.fc-loading__ambient-orbit');
      const wings = root.querySelectorAll('.fc-loading__wing');
      const sparks = root.querySelectorAll('.fc-loading__spark');
      const eyes = root.querySelectorAll('.fc-loading__eye');
      const scene = root.querySelector('.fc-loading__scene');

      if (shouldReduceMotion) {
        gsap.set([rays, core, ...rings, flash, bird], { autoAlpha: 0 });
        gsap.set(scene, { autoAlpha: 1 });
        setIntroComplete(true);
        return;
      }

      const width = window.innerWidth;
      const height = window.innerHeight;
      const anchorX = Math.min(width * 0.18, 220);
      const anchorY = -Math.min(height * 0.28, 225);
      const centerPath = [
        { x: -Math.max(width * 0.44, 240), y: -Math.max(height * 0.34, 190) },
        { x: -Math.max(width * 0.24, 132), y: -Math.max(height * 0.32, 170) },
        { x: -Math.min(width * 0.09, 88), y: -Math.min(height * 0.08, 54) },
        { x: Math.min(width * 0.12, 92), y: -Math.min(height * 0.2, 124) },
      ];
      const path = [
        ...centerPath.map(({ x, y }) => ({ x: x - anchorX, y: y - anchorY })),
        { x: 0, y: 0 },
      ];

      gsap.set(scene, { autoAlpha: 1 });
      gsap.set(camera, { x: 0, y: 0, rotation: 0, scale: 1.035, transformOrigin: '50% 50%' });
      gsap.set(bird, { autoAlpha: 0, xPercent: -50, yPercent: -50, x: path[0].x, y: path[0].y, scale: 0.58, rotation: -20, transformOrigin: '50% 50%' });
      gsap.set([rays, core], { autoAlpha: 0, scale: 0.12, rotation: -28, transformOrigin: '50% 50%' });
      gsap.set(rings, { autoAlpha: 0, scale: 0.12, transformOrigin: '50% 50%' });
      gsap.set(flash, { autoAlpha: 0 });
      gsap.set(halo, { autoAlpha: 0, scale: 0.36, transformOrigin: '50% 50%' });
      gsap.set(sparks, { autoAlpha: 0, x: 0, y: 0, scale: 0, transformOrigin: '50% 50%' });

      const intro = gsap.timeline({
        onComplete: () => setIntroComplete(true),
      });
      introTimelineRef.current = intro;
      intro
        .to(bird, {
          duration: 0.94,
          autoAlpha: 1,
          scale: 1.25,
          ease: 'power3.in',
          motionPath: {
            path,
            curviness: 1.5,
            autoRotate: true,
          },
        }, 0)
        .addLabel('impact', 0.82)
        .to(camera, { scale: 1.12, duration: 0.05, ease: 'power4.in' }, 'impact')
        .to(camera, { x: 16, y: -10, rotation: -0.8, scale: 1.12, duration: 0.045, ease: 'none' }, 'impact')
        .to(camera, { x: -18, y: 13, rotation: 1.05, duration: 0.055, ease: 'none' }, 'impact+=0.045')
        .to(camera, { x: 11, y: -7, rotation: -0.62, duration: 0.065, ease: 'none' }, 'impact+=0.1')
        .to(camera, { x: -6, y: 4, rotation: 0.32, duration: 0.075, ease: 'none' }, 'impact+=0.165')
        .to(camera, { x: 0, y: 0, rotation: 0, scale: 1.035, duration: 0.17, ease: 'elastic.out(1, 0.5)' }, 'impact+=0.24')
        .to(flash, { autoAlpha: 1, duration: 0.035, ease: 'none' }, 'impact')
        .to(flash, { autoAlpha: 0, duration: 0.3, ease: 'power2.out' }, 'impact+=0.035')
        .to(rays, { autoAlpha: 1, scale: 1.08, rotation: 4, duration: 0.24, ease: 'power4.out' }, 'impact')
        .to(rays, { autoAlpha: 0, scale: 1.52, rotation: 18, duration: 0.82, ease: 'power2.in' }, 'impact+=0.2')
        .to(core, { autoAlpha: 1, scale: 1.25, duration: 0.12, ease: 'power3.out' }, 'impact')
        .to(core, { autoAlpha: 0, scale: 2.4, duration: 0.67, ease: 'power2.in' }, 'impact+=0.1')
        .to(rings[0], { autoAlpha: 1, scale: 1, duration: 0.13, ease: 'power4.out' }, 'impact+=0.015')
        .to(rings[0], { autoAlpha: 0, scale: 3.4, duration: 0.92, ease: 'power2.out' }, 'impact+=0.1')
        .to(rings[1], { autoAlpha: 0.86, scale: 1, duration: 0.14, ease: 'power4.out' }, 'impact+=0.09')
        .to(rings[1], { autoAlpha: 0, scale: 2.8, duration: 0.94, ease: 'power2.out' }, 'impact+=0.18')
        .to(rings[2], { autoAlpha: 0.62, scale: 1, duration: 0.18, ease: 'power4.out' }, 'impact+=0.18')
        .to(rings[2], { autoAlpha: 0, scale: 2.4, duration: 1, ease: 'power2.out' }, 'impact+=0.28')
        .to(rings[2], { autoAlpha: 0.2, scale: 1.55, duration: 0.76, ease: 'sine.out' }, 'impact+=0.62')
        .to(halo, { autoAlpha: 1, scale: 1.2, duration: 0.18, ease: 'power3.out' }, 'impact')
        .to(halo, { autoAlpha: 0.56, scale: 1.42, duration: 0.62, ease: 'sine.out' }, 'impact+=0.22')
        .to(rays, { autoAlpha: 0.3, scale: 1.35, rotation: 25, duration: 0.8, ease: 'sine.out' }, 'impact+=0.68')
        .to(sparks, {
          autoAlpha: 1,
          scale: 'random(0.85, 1.7)',
          x: (index) => SPARKS[index % SPARKS.length][0],
          y: (index) => SPARKS[index % SPARKS.length][1],
          duration: 0.9,
          stagger: 0.012,
          ease: 'power4.out',
        }, 'impact+=0.015')
        .to(sparks, { autoAlpha: 0, scale: 0, duration: 0.52, stagger: 0.01, ease: 'power2.in' }, 'impact+=0.58')
        .to(bird, { rotation: 0, scale: 0.94, duration: 0.4, ease: 'elastic.out(1, 0.5)' }, 'impact+=0.53');

      gsap.to(wings, {
        rotation: (index) => (index === 0 ? 27 : -27),
        transformOrigin: (index) => (index === 0 ? '95% 80%' : '5% 80%'),
        duration: 0.14,
        yoyo: true,
        repeat: -1,
        ease: 'sine.inOut',
      });
      gsap.to(eyes, {
        scaleY: 0.12,
        transformOrigin: '50% 50%',
        duration: 0.08,
        repeat: -1,
        repeatDelay: 2.4,
        yoyo: true,
        ease: 'power1.inOut',
      });
      gsap.to(rays, { rotation: 385, duration: 26, repeat: -1, ease: 'none', delay: 2.35 });
      gsap.to(rays, { scale: 1.5, autoAlpha: 0.38, duration: 1.8, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: 2.35 });
      gsap.to(rings[2], { scale: 2.05, autoAlpha: 0.13, duration: 1.7, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: 2.35 });
      gsap.to(halo, { scale: 1.52, autoAlpha: 0.62, duration: 1.65, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: 2.35 });
      gsap.to(orbits[0], { rotation: 360, duration: 28, repeat: -1, ease: 'none' });
      gsap.to(orbits[1], { rotation: -360, duration: 36, repeat: -1, ease: 'none' });
      gsap.to(sparks, {
        autoAlpha: 0.78,
        scale: 'random(0.45, 1.1)',
        x: (index) => SPARKS[index % SPARKS.length][0] * 0.58,
        y: (index) => SPARKS[index % SPARKS.length][1] * 0.58,
        duration: 1.9,
        repeat: -1,
        yoyo: true,
        stagger: { each: 0.035, from: 'random' },
        ease: 'sine.inOut',
        delay: 2.35,
      });
    }, root);

    return () => {
      introTimelineRef.current = null;
      context.revert();
    };
  }, [shouldReduceMotion]);

  useEffect(() => {
    const root = rootRef.current;
    const card = root?.querySelector('.fc-loading__brand-card');
    if (!card) return undefined;

    const logo = card.querySelector('.fc-loading__logo');
    const brandCopy = card.querySelector('.fc-loading__brand-copy');
    if (!showBrandCard) {
      gsap.set(card, { autoAlpha: 0 });
      return undefined;
    }

    if (shouldReduceMotion) {
      gsap.set(card, {
        autoAlpha: 1,
        xPercent: -50,
        yPercent: -50,
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        rotationX: 0,
        rotationY: 0,
      });
      gsap.set([logo, brandCopy].filter(Boolean), { autoAlpha: 1, clearProps: 'transform' });
      return undefined;
    }

    const impactTime = 0.82;
    const introTime = introTimelineRef.current?.time() ?? impactTime;
    const timeline = gsap.timeline({ delay: Math.max(0, impactTime - introTime) });
    timeline
      .fromTo(card,
        { autoAlpha: 0, xPercent: -50, yPercent: -50, x: 0, y: 70, scale: 0.18, rotation: -14, rotationX: -18, rotationY: 12, transformOrigin: '50% 50%' },
        { autoAlpha: 1, xPercent: -50, yPercent: -50, y: 0, scale: 1.16, rotation: 0, rotationX: -7, rotationY: 7, duration: 0.52, ease: 'back.out(2.6)' },
      )
      .to(card, { scale: 1, rotationX: 0, rotationY: 0, duration: 0.48, ease: 'elastic.out(1, 0.48)' });

    if (logo) {
      timeline.fromTo(logo,
        { autoAlpha: 0, y: 26, scale: 0.82 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.38, ease: 'back.out(1.8)' },
        '-=0.2',
      );
    }
    if (brandCopy) {
      timeline.fromTo(brandCopy,
        { autoAlpha: 0, y: 20 },
        { autoAlpha: 1, y: 0, duration: 0.42, ease: 'power4.out' },
        '<+0.1',
      );
    }

    return () => timeline.kill();
  }, [brandReady, displayBrand, resolvedLogo, showBrandCard, shouldReduceMotion]);

  useEffect(() => {
    if (!readyToExit || !introComplete || !rootRef.current) return undefined;
    const timeline = gsap.timeline({
      onComplete: () => onExitCompleteRef.current?.(),
    });
    timeline.to(rootRef.current, {
      autoAlpha: 0,
      scale: shouldReduceMotion ? 1 : 1.035,
      duration: shouldReduceMotion ? 0 : 0.34,
      ease: 'power2.in',
    });
    return () => timeline.kill();
  }, [introComplete, readyToExit, shouldReduceMotion]);

  const skipAnimation = () => {
    introTimelineRef.current?.progress(1);
    setIntroComplete(true);
  };

  const playLaunchSound = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  };

  return (
    <main ref={rootRef} className="fc-experience-loading" aria-busy="true" aria-live="polite">
      <div className="fc-loading__camera" aria-hidden="true">
        <video
          className="fc-experience-loading__video"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster={LOADING_VIDEO_POSTER}
          // Keep network use low until the destination code has downloaded.
          src={videoEnabled ? LOADING_VIDEO_SRC : undefined}
        />
        <div className="fc-loading__scrim" />

        <div className="fc-loading__scene">
          <div className="fc-loading__ambient-orbit fc-loading__ambient-orbit--one" />
          <div className="fc-loading__ambient-orbit fc-loading__ambient-orbit--two" />
          <div className="fc-loading__halo" />
          <div className="fc-loading__burst-rays" />
          <div className="fc-loading__burst-core" />
          <div className="fc-loading__shockwave fc-loading__shockwave--one" />
          <div className="fc-loading__shockwave fc-loading__shockwave--two" />
          <div className="fc-loading__shockwave fc-loading__shockwave--three" />
          <i className="fc-loading__spark" />
          {SPARKS.slice(1).map((_, index) => <i className="fc-loading__spark" key={index} />)}

          {showBrandCard ? (
            <section className="fc-loading__brand-card" aria-hidden="true">
              {visibleLogo ? (
                <div className="fc-loading__logo-wrap">
                  <img
                    ref={imgRef}
                    className="fc-loading__logo"
                    src={visibleLogo}
                    alt=""
                    width="520"
                    height="250"
                    decoding="async"
                    fetchPriority="high"
                    onLoad={resolvedLogo && !logoFailed ? markReady : undefined}
                    onError={resolvedLogo && !logoFailed ? markError : undefined}
                  />
                  {!isLogoReady && resolvedLogo && !logoFailed ? (
                    <span className="fc-loading__logo-shimmer" />
                  ) : null}
                </div>
              ) : null}
              {displayBrand ? (
                <div className="fc-loading__brand-copy">
                  <p className="fc-loading__brand-name">{displayBrand}</p>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="fc-loading__bird-flight">
            <BrandBirdVector />
          </div>
          <div className="fc-loading__flash" />
        </div>
      </div>

      <p className="fc-experience-loading__status" role="status">{detail}</p>
      <audio ref={audioRef} src={launchSoundSrc} preload="auto" aria-hidden="true" />
      <button className="fc-loading__sound" type="button" onClick={playLaunchSound} aria-label="Play launch sound" title="Play launch sound">
        <span aria-hidden="true">♪</span>
        <span>Sound</span>
      </button>
      {!introComplete && !shouldReduceMotion ? (
        <button className="fc-loading__skip" type="button" onClick={skipAnimation}>
          Skip animation
        </button>
      ) : null}

      <span className="fc-experience-loading__logo-a11y" aria-live="polite">
        {resolvedLogo && !isLogoReady
          ? 'Loading brand logo'
          : displayBrand ? `Loading ${displayBrand} experience` : 'Loading brand experience'}
      </span>
    </main>
  );
}
