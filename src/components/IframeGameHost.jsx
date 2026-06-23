import { useEffect, useMemo, useRef, useState } from 'react';
import { attachIframeHost } from '@fc/game-bridge';
import { dbg, dbgError } from '../lib/debug.js';
import { bindIframeHostViewport } from '../lib/iframeHostViewport.js';
import { useGameOverSettlement } from '../lib/gameOverSettlement.js';
import GameOverOverlay from './GameOverOverlay.jsx';

export default function IframeGameHost({
  start,
  iframeUrl,
  allowedOrigin,
  onDone,
  onError,
  onRuntimeEvent,
}) {
  const iframeRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [bootAttempt, setBootAttempt] = useState(0);
  const onErrorRef = useRef(onError);
  const onRuntimeEventRef = useRef(onRuntimeEvent);
  const startRef = useRef(start);
  const sessionRef = useRef(null);
  const boundSessionKeyRef = useRef('');
  const playingRef = useRef(false);
  onErrorRef.current = onError;
  onRuntimeEventRef.current = onRuntimeEvent;
  startRef.current = start;

  const { gameOverVisible, settleGameResultSafe } = useGameOverSettlement({
    onDone,
    onError,
    sessionId: start.sessionId,
  });
  const settleGameResultSafeRef = useRef(settleGameResultSafe);
  settleGameResultSafeRef.current = settleGameResultSafe;

  const iframeSrc = useMemo(() => {
    const url = new URL(iframeUrl, window.location.href);
    url.searchParams.set('parentOrigin', window.location.origin);
    url.searchParams.set('hostBoot', String(bootAttempt));
    return url.toString();
  }, [bootAttempt, iframeUrl]);

  const resolvedAllowedOrigin = useMemo(
    () => new URL(iframeSrc, window.location.href).origin,
    [iframeSrc],
  );

  const hostSessionKey = `${start.sessionId}|${bootAttempt}|${iframeSrc}`;

  useEffect(() => {
    playingRef.current = false;
    boundSessionKeyRef.current = '';
    sessionRef.current?.cancel();
    sessionRef.current = null;
    setBootAttempt(0);
    setStatus('loading');
    setErrorMessage('');
  }, [start.sessionId]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    if (boundSessionKeyRef.current === hostSessionKey && sessionRef.current) {
      return undefined;
    }

    let cancelled = false;

    const attach = () => {
      if (cancelled) return;
      if (boundSessionKeyRef.current === hostSessionKey && sessionRef.current) {
        return;
      }

      sessionRef.current?.cancel();
      boundSessionKeyRef.current = hostSessionKey;

      if (!playingRef.current) {
        setStatus('loading');
        setErrorMessage('');
      }

      dbg('[FCDBG][IframeGameHost] attach', {
        sessionId: startRef.current?.sessionId,
        hostSessionKey,
        allowedOrigin: resolvedAllowedOrigin,
      });

      sessionRef.current = attachIframeHost({
        iframe,
        allowedOrigin: resolvedAllowedOrigin,
        payload: startRef.current,
        handlers: {
          onReady: () => {
            playingRef.current = true;
            dbg('[FCDBG][IframeGameHost] runtime ready', {
              sessionId: startRef.current?.sessionId,
              hostSessionKey,
            });
            setStatus('playing');
          },
          onComplete: async (result) => {
            try {
              await settleGameResultSafeRef.current(result);
            } catch (err) {
              dbgError('[FCDBG][IframeGameHost] complete failed', err);
              setStatus('error');
              setErrorMessage(err instanceof Error ? err.message : 'Complete failed');
            }
          },
          onEvent: (event) => {
            onRuntimeEventRef.current?.(event);
          },
          onError: (message) => {
            dbgError('[FCDBG][IframeGameHost] runtime error', message);
            setStatus('error');
            setErrorMessage(message);
            onErrorRef.current?.(message);
          },
        },
      });
    };

    const onLoad = () => {
      attach();
    };

    iframe.addEventListener('load', onLoad, { once: true });
    if (iframe.contentDocument?.readyState === 'complete') {
      attach();
    }

    return () => {
      cancelled = true;
      iframe.removeEventListener('load', onLoad);
      if (boundSessionKeyRef.current === hostSessionKey) {
        sessionRef.current?.cancel();
        sessionRef.current = null;
        boundSessionKeyRef.current = '';
      }
    };
  }, [hostSessionKey, resolvedAllowedOrigin]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    let cleanup = () => {};

    const attachViewport = () => {
      cleanup();
      cleanup = bindIframeHostViewport(iframe, resolvedAllowedOrigin);
    };

    if (iframe.contentDocument?.readyState === 'complete') {
      attachViewport();
    } else {
      iframe.addEventListener('load', attachViewport, { once: true });
    }

    return () => {
      iframe.removeEventListener('load', attachViewport);
      cleanup();
    };
  }, [iframeSrc, resolvedAllowedOrigin, start.sessionId]);

  useEffect(() => {
    if (status !== 'loading' || playingRef.current) return undefined;
    if (bootAttempt >= 1) return undefined;

    const timeoutId = window.setTimeout(() => {
      if (playingRef.current) return;
      dbgError('[FCDBG][IframeGameHost] ready timeout; retry bootstrap', {
        sessionId: start.sessionId,
        attempt: bootAttempt,
      });
      playingRef.current = false;
      boundSessionKeyRef.current = '';
      sessionRef.current?.cancel();
      sessionRef.current = null;
      setBootAttempt((value) => value + 1);
    }, 15000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [bootAttempt, start.sessionId, status]);

  useEffect(() => {
    if (status !== 'loading' || bootAttempt < 1 || playingRef.current) return;
    const timeoutId = window.setTimeout(() => {
      if (playingRef.current) return;
      const message = 'Game start timed out. Please retry.';
      setStatus('error');
      setErrorMessage(message);
      onErrorRef.current?.(message);
    }, 20000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [bootAttempt, status]);

  if (status === 'error') {
    return <p className="platform-game-error">{errorMessage || 'Game failed to load'}</p>;
  }

  return (
    <div className="iframe-game-host">
      <iframe
        ref={iframeRef}
        title={`Game ${start.templateKey}`}
        src={iframeSrc}
        sandbox="allow-scripts allow-same-origin"
        className="platform-game-iframe"
        scrolling="no"
        aria-hidden={status === 'loading'}
      />
      {status === 'loading' ? (
        <div className="platform-game-loading platform-game-loading--overlay" role="status">
          <span className="platform-game-spinner" aria-hidden="true" />
          <p>Loading game…</p>
        </div>
      ) : null}
      <GameOverOverlay visible={gameOverVisible} />
    </div>
  );
}
