import { useEffect, useState } from 'react';
import { fetchFcExperience, resolveSnFromUrl } from './lib/fcExperience.js';
import ReorderApp from './reorder/ReorderApp.jsx';

function bootDtcApp() {
  return import('./App.jsx').then((mod) => mod.default);
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

/**
 * /p/{sn} entry: resolve experience via dedicated API, then mount ASIN or DTC UI.
 */
export default function ExperienceRoot() {
  const [phase, setPhase] = useState({ status: 'resolving' });

  const resolve = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('scenario')) {
      setPhase({ status: 'asin_plus_preview' });
      return;
    }
    const sn = resolveSnFromUrl();
    if (!sn) {
      setPhase({ status: 'unknown', reason: 'missing_sn' });
      return;
    }
    setPhase({ status: 'resolving', sn });
    fetchFcExperience(sn)
      .then(async (result) => {
        if (result.experience === 'asin_plus') {
          setPhase({ status: 'asin_plus', sn: result.sn || sn, experience: result });
          return;
        }
        if (result.experience === 'dtc') {
          await import('../fc-style.css');
          await import('../fc-coupons.css');
          await import('../fc-tiers.css');
          await import('../fc-leaderboard.css');
          await import('../fc-coupon-wallet.css');
          const App = await bootDtcApp();
          setPhase({ status: 'dtc', sn: result.sn || sn, App });
          return;
        }
        setPhase({
          status: 'unknown',
          sn: result.sn || sn,
          reason: result.reason || 'unknown',
        });
      })
      .catch((error) => {
        setPhase({
          status: 'error',
          sn,
          detail: error?.message || 'Failed to resolve experience',
        });
      });
  };

  useEffect(() => {
    resolve();
  }, []);

  if (phase.status === 'resolving') {
    return <ErrorScreen title="Loading…" detail="Resolving your FridgeChannel experience." />;
  }
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
  if (phase.status === 'asin_plus_preview') {
    return <ReorderApp mode="preview" />;
  }
  if (phase.status === 'asin_plus') {
    return <ReorderApp mode="live" sn={phase.sn} experienceMeta={phase.experience} />;
  }
  if (phase.status === 'dtc' && phase.App) {
    const App = phase.App;
    return <App />;
  }
  return <ErrorScreen title="Unable to open this link" onRetry={resolve} />;
}
