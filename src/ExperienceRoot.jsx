import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { fetchFcExperience, resolveSnFromUrl } from './lib/fcExperience.js';
import { normalizeLogoUrl } from './lib/brandTheme.js';
import ExperienceLoading from './ExperienceLoading.jsx';

const ReorderApp = lazy(() => import('./reorder/ReorderApp.jsx'));

function bootDtcApp() {
  // Stylesheet <link>s are inserted in call order; keep this order for the cascade.
  return Promise.all([
    import('../fc-style.css'),
    import('../fc-coupons.css'),
    import('../fc-tiers.css'),
    import('../fc-leaderboard.css'),
    import('../fc-coupon-wallet.css'),
    import('./App.jsx'),
  ]).then((mods) => mods[mods.length - 1].default);
}

async function resolveAsinConfiguration(fcId) {
  const [{ resolveFcConfiguration, resolveScenario }] = await Promise.all([
    import('./reorder/reorderService.js'),
    import('./reorder/ReorderApp.jsx'),
  ]);
  return resolveFcConfiguration({ fcId, scenario: resolveScenario(), mode: 'live' });
}

function brandFromExperience(result) {
  const raw = typeof result?.brandLogo === 'string' ? result.brandLogo.trim() : '';
  // Loading shell uses <img> — prefer the absolute CDN URL (no brand-asset proxy hop).
  const logoUrl = raw
    ? (/^https?:\/\//i.test(raw) ? raw : normalizeLogoUrl(raw))
    : null;
  return {
    logoUrl,
    brandName: result?.brandName ?? null,
  };
}

/** Warm the brand logo as soon as experience returns so loading can swap quickly. */
function preloadLogo(url) {
  if (!url || typeof window === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}

function ErrorScreen({ title, detail, onRetry }) {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 420, margin: '40px auto' }}>
      <h1 style={{ fontSize: 22 }}>{title}</h1>
      {detail ? <p style={{ color: '#555' }}>{detail}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} style={{ marginTop: 16, padding: '10px 16px' }}>
          Retry
        </button>
      ) : null}
    </main>
  );
}

function PendingShell({ ready, children }) {
  return (
    <div
      aria-hidden={!ready}
      style={ready ? undefined : {
        visibility: 'hidden',
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
      }}
    >
      {children}
    </div>
  );
}

/**
 * /p/{sn} entry: resolve experience via dedicated API, then mount ASIN or DTC UI.
 * Keeps a single logo loading shell until the destination first paint is ready.
 */
export default function ExperienceRoot() {
  const [phase, setPhase] = useState({ status: 'resolving' });
  const [contentReady, setContentReady] = useState(false);
  const [loadingBrand, setLoadingBrand] = useState({ logoUrl: null, brandName: null });
  const [logoSettled, setLogoSettled] = useState(true);
  const contentReadyRef = useRef(false);
  const resolveSeqRef = useRef(0);

  const markContentReady = useCallback(() => {
    if (contentReadyRef.current) return;
    contentReadyRef.current = true;
    setContentReady(true);
  }, []);

  const markLogoSettled = useCallback(() => {
    setLogoSettled(true);
  }, []);

  const resolve = () => {
    const seq = ++resolveSeqRef.current;
    contentReadyRef.current = false;
    setContentReady(false);
    setLoadingBrand({ logoUrl: null, brandName: null });
    setLogoSettled(true);

    const params = new URLSearchParams(window.location.search);
    if (params.has('scenario')) {
      setPhase({ status: 'asin_plus_preview' });
      markContentReady();
      return;
    }

    const sn = resolveSnFromUrl();
    if (!sn) {
      setPhase({ status: 'unknown', reason: 'missing_sn' });
      markContentReady();
      return;
    }

    setPhase({ status: 'resolving', sn });

    // DTC is the common destination; warm its JS while experience resolves (stylesheets wait for the result).
    import('./App.jsx').catch(() => {});

    fetchFcExperience(sn)
      .then(async (result) => {
        if (seq !== resolveSeqRef.current) return;

        // Experience API already loaded magnet_brand_param — apply logo before destination boot.
        const brand = brandFromExperience(result);
        if (brand.logoUrl) {
          setLogoSettled(false);
          setLoadingBrand(brand);
          preloadLogo(brand.logoUrl);
        } else {
          setLoadingBrand(brand);
          setLogoSettled(true);
        }

        if (result.experience === 'asin_plus') {
          const resolvedSn = result.sn || sn;
          const config = await resolveAsinConfiguration(resolvedSn);
          if (seq !== resolveSeqRef.current) return;
          setPhase({
            status: 'asin_plus',
            sn: resolvedSn,
            experience: result,
            resolved: { status: config.status, config },
          });
          return;
        }

        if (result.experience === 'dtc') {
          const App = await bootDtcApp();
          if (seq !== resolveSeqRef.current) return;
          setPhase({ status: 'dtc', sn: result.sn || sn, App });
          return;
        }

        setPhase({
          status: 'unknown',
          sn: result.sn || sn,
          reason: result.reason || 'unknown',
        });
        markContentReady();
      })
      .catch((error) => {
        if (seq !== resolveSeqRef.current) return;
        setPhase({
          status: 'error',
          sn,
          detail: error?.message || 'Failed to resolve experience',
        });
        markContentReady();
      });
  };

  useEffect(() => {
    resolve();
  }, []);

  const hasDestination = phase.status === 'dtc' || phase.status === 'asin_plus';
  const waitingForDestination = hasDestination && !contentReady;
  const waitingForLogo = Boolean(loadingBrand.logoUrl) && !logoSettled;
  const showLoading = phase.status === 'resolving'
    || waitingForDestination
    || waitingForLogo;

  if (phase.status === 'error') {
    return (
      <ErrorScreen
        title="Unable to open this link"
        detail={phase.detail}
        onRetry={resolve}
      />
    );
  }
  if (phase.status === 'unknown') {
    return (
      <ErrorScreen
        title="We can’t find this magnet"
        detail={phase.reason === 'missing_sn'
          ? 'Open this page by tapping your FridgeChannel magnet.'
          : 'This FC link may be unavailable.'}
      />
    );
  }

  return (
    <>
      {showLoading ? (
        <ExperienceLoading
          logoUrl={loadingBrand.logoUrl}
          brandName={loadingBrand.brandName}
          onLogoReady={markLogoSettled}
          onLogoError={markLogoSettled}
        />
      ) : null}

      {phase.status === 'asin_plus_preview' ? (
        <Suspense fallback={<ExperienceLoading />}>
          <ReorderApp mode="preview" />
        </Suspense>
      ) : null}

      {phase.status === 'asin_plus' ? (
        <PendingShell ready={contentReady}>
          <Suspense fallback={null}>
            <ReorderApp
              mode="live"
              sn={phase.sn}
              experienceMeta={phase.experience}
              initialResolved={phase.resolved}
              onEntryReady={markContentReady}
              suppressLocalLoading
            />
          </Suspense>
        </PendingShell>
      ) : null}

      {phase.status === 'dtc' && phase.App ? (
        <PendingShell ready={contentReady}>
          <DtcApp
            App={phase.App}
            onEntryReady={markContentReady}
          />
        </PendingShell>
      ) : null}
    </>
  );
}

function DtcApp({ App, onEntryReady }) {
  return <App skipEntryGiftIntro onEntryReady={onEntryReady} />;
}
