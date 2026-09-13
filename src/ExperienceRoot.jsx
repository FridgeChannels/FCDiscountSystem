import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFcExperience, resolveSnFromUrl } from './lib/fcExperience.js';
import { resolveFcConfiguration, resolveScenario } from './reorder/reorderService.js';
import ReorderApp from './reorder/ReorderApp.jsx';
import './experience-loading.css';

function bootDtcApp() {
  return import('./App.jsx').then((mod) => mod.default);
}

function ExperienceLoading({ detail = 'Preparing your experience…' }) {
  return (
    <main className="fc-experience-loading" aria-busy="true" aria-live="polite">
      <img
        className="fc-experience-loading__logo"
        src="/fc-logo.svg"
        alt="FridgeChannel"
        width={220}
        height={50}
        decoding="async"
        fetchPriority="high"
      />
      <p className="fc-experience-loading__copy">{detail}</p>
    </main>
  );
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
  const contentReadyRef = useRef(false);
  const resolveSeqRef = useRef(0);

  const markContentReady = useCallback(() => {
    if (contentReadyRef.current) return;
    contentReadyRef.current = true;
    setContentReady(true);
  }, []);

  const resolve = () => {
    const seq = ++resolveSeqRef.current;
    contentReadyRef.current = false;
    setContentReady(false);

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

    fetchFcExperience(sn)
      .then(async (result) => {
        if (seq !== resolveSeqRef.current) return;

        if (result.experience === 'asin_plus') {
          const resolvedSn = result.sn || sn;
          const config = await resolveFcConfiguration({
            fcId: resolvedSn,
            scenario: resolveScenario(),
            mode: 'live',
          });
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
          await import('../fc-style.css');
          await import('../fc-coupons.css');
          await import('../fc-tiers.css');
          await import('../fc-leaderboard.css');
          await import('../fc-coupon-wallet.css');
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

  const waitingForDestination = (phase.status === 'dtc' || phase.status === 'asin_plus') && !contentReady;
  const showLoading = phase.status === 'resolving' || waitingForDestination;

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
      {showLoading ? <ExperienceLoading /> : null}

      {phase.status === 'asin_plus_preview' ? (
        <ReorderApp mode="preview" />
      ) : null}

      {phase.status === 'asin_plus' ? (
        <PendingShell ready={contentReady}>
          <ReorderApp
            mode="live"
            sn={phase.sn}
            experienceMeta={phase.experience}
            initialResolved={phase.resolved}
            onEntryReady={markContentReady}
            suppressLocalLoading
          />
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
