import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { fetchFcExperience, resolveSnFromUrl } from './lib/fcExperience.js';
import { normalizeLogoUrl } from './lib/brandTheme.js';
import { parseTouchIdFromUrl } from './lib/touchId.js';
import { prefetchMagnetBrandParam, prefetchDtcEntry } from './api/client.js';
import { isShopifyOAuthPending } from './api/cache.js';
import { buildScenario } from './reorder/fixtures.js';
import { resolveFcConfiguration, resolveFcId, resolveScenario } from './reorder/reorderService.js';
import ExperienceLoading from './ExperienceLoading.jsx';
import { notifyEmbedReady, trackEmbed } from './lib/investorEmbed.js';

const ReorderApp = lazy(() => import('./reorder/ReorderApp.jsx'));

function bootDtcApp() {
  return Promise.all([
    import('./rewards.css'),
    import('./App.jsx'),
  ]).then(([, app]) => app.default);
}

async function resolveAsinConfiguration(fcId) {
  const [config] = await Promise.all([
    resolveFcConfiguration({ fcId, scenario: resolveScenario(), mode: 'live' }),
    import('./reorder/ReorderApp.jsx'),
  ]);
  return config;
}

function openingBrand(source = {}) {
  const logo = source.brandLogo || source.logoUrl || source.logoImage;
  return Object.fromEntries(Object.entries({
    logoUrl: logo && normalizeLogoUrl(logo),
    brandName: source.brandName || source.name,
    primary: source.colors?.primary || source.primaryColor,
    secondary: source.colors?.secondary || source.secondaryColor,
    logoBlendMode: source.logoBlendMode,
  }).filter(([, value]) => Boolean(value)));
}

function getPreviewEntry() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('scenario') && !(import.meta.env.DEV && !resolveSnFromUrl())) return null;
  const config = { ...buildScenario(resolveScenario()), fcId: resolveFcId() };
  return { status: 'asin_plus_preview', resolved: { status: config.status, config } };
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

function PendingShell({ ready, revealed, destinationRef, children }) {
  return (
    <div
      className="experience-destination"
      ref={destinationRef}
      inert={!revealed}
      aria-hidden={!revealed}
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
  const [preview] = useState(getPreviewEntry);
  const [offerBrandPreview] = useState(() => import.meta.env.DEV && new URLSearchParams(window.location.search).get('palette') === 'mosh'
    ? buildScenario('mosh-product').brand
    : null);
  const [phase, setPhase] = useState(preview || { status: 'resolving' });
  const [contentReady, setContentReady] = useState(false);
  const [loadingBrand, setLoadingBrand] = useState(() => openingBrand(preview?.resolved.config.brand || {}));
  const destinationRef = useRef(null);
  const [loadingOverlayDismissed, setLoadingOverlayDismissed] = useState(false);
  const contentReadyRef = useRef(false);
  const resolveSeqRef = useRef(0);
  const amazonProductPreview = new URLSearchParams(window.location.search).get('view') === 'amazon-product';

  const markContentReady = useCallback((destinationBrand) => {
    if (contentReadyRef.current) return;
    if (destinationBrand) setLoadingBrand(current => ({ ...current, ...openingBrand(destinationBrand) }));
    contentReadyRef.current = true;
    setContentReady(true);
  }, []);

  const dismissOpening = useCallback(() => {
    setLoadingOverlayDismissed(true);
  }, []);

  const resolve = () => {
    const seq = ++resolveSeqRef.current;
    contentReadyRef.current = false;
    setContentReady(false);
    setLoadingBrand({});
    setLoadingOverlayDismissed(false);

    const sn = resolveSnFromUrl();
    if (!sn) {
      setPhase({ status: 'unknown', reason: 'missing_sn' });
      markContentReady();
      return;
    }

    setPhase({ status: 'resolving', sn });
    const brandRequest = prefetchMagnetBrandParam(sn);

    // DTC is the common destination; warm its JS while experience resolves (stylesheets wait for the result).
    import('./App.jsx').catch(() => {});

    fetchFcExperience(sn)
      .then(async (result) => {
        if (seq !== resolveSeqRef.current) return;

        const brand = openingBrand(result.experience === 'dtc' && offerBrandPreview ? offerBrandPreview : result);
        const dtc = result.experience === 'dtc';
        setLoadingBrand(dtc ? { ...brand, dtc, logoBlendMode: 'normal' } : brand);

        // Older router responses contain just the name and logo. Enrich the
        // palette concurrently, and ignore a different brand on a dual-channel SN.
        brandRequest.then((param) => {
          if (!param || seq !== resolveSeqRef.current || (dtc && offerBrandPreview)) return;
          const theme = openingBrand(param);
          const sameName = brand.brandName && theme.brandName
            && brand.brandName.trim().toLowerCase() === theme.brandName.trim().toLowerCase();
          if ((brand.brandName || brand.logoUrl) && !sameName && (!brand.logoUrl || brand.logoUrl !== theme.logoUrl)) return;
          setLoadingBrand(current => dtc ? { ...current, ...theme } : { ...current, ...theme, ...brand });
        }).catch(() => {});

        if (result.experience === 'asin_plus') {
          const resolvedSn = result.sn || sn;
          const config = await resolveAsinConfiguration(resolvedSn);
          if (seq !== resolveSeqRef.current) return;
          if (config.brand) setLoadingBrand(current => ({ ...openingBrand(config.brand), ...current }));
          setPhase({
            status: 'asin_plus',
            sn: resolvedSn,
            experience: result,
            resolved: { status: config.status, config },
          });
          return;
        }

        if (result.experience === 'dtc') {
          const { touchId } = parseTouchIdFromUrl();
          // OAuth return must load the plan only after the refreshed Shopify status (see App bootstrap).
          prefetchDtcEntry(touchId, { includeRewardPlan: !isShopifyOAuthPending(touchId) });
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
    if (preview) return;
    resolve();
    return () => { resolveSeqRef.current += 1; };
  }, [preview]);

  const hasDestination = phase.status === 'dtc' || phase.status === 'asin_plus';
  useEffect(() => {
    if (hasDestination && contentReady) notifyEmbedReady(phase.status);
    else if (phase.status === 'error' || phase.status === 'unknown') {
      trackEmbed('experience_error', { status: phase.status, reason: phase.reason || phase.detail || null });
    }
  }, [hasDestination, contentReady, phase.status, phase.reason, phase.detail]);
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

  // A router response can contain the logo before the SN's actual paper color.
  // Present the brand only once the two can be painted together.
  const opening = loadingBrand.dtc && !loadingBrand.secondary && !contentReady ? {} : loadingBrand;
  return (
    <>
      {!loadingOverlayDismissed && (
        <ExperienceLoading
          key={opening.logoUrl || opening.brandName || 'pending'}
          {...opening}
          destinationRef={destinationRef}
          readyToExit={contentReady}
          onExitComplete={dismissOpening}
        />
      )}
      <PendingShell ready={contentReady} revealed={loadingOverlayDismissed} destinationRef={destinationRef}>
        <Suspense fallback={null}>
          {(phase.status === 'asin_plus_preview' || phase.status === 'asin_plus') && (
            <ReorderApp
              mode={preview || amazonProductPreview ? 'preview' : 'live'}
              sn={phase.sn}
              experienceMeta={phase.experience}
              initialResolved={phase.resolved}
              onEntryReady={markContentReady}
              suppressLocalLoading
            />
          )}
          {phase.status === 'dtc' && phase.App && (
            <phase.App key={phase.sn} skipEntryGiftIntro onEntryReady={markContentReady} offerBrandPreview={offerBrandPreview} />
          )}
        </Suspense>
      </PendingShell>
    </>
  );
}
