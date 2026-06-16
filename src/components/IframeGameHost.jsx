import { useEffect, useMemo, useRef, useState } from 'react';
import { attachIframeHost } from '@fc/game-bridge';
import { completeGameSession } from '../api/client.js';
import { dbg, dbgError } from '../lib/debug.js';

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
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  const startRef = useRef(start);
  onDoneRef.current = onDone;
  onErrorRef.current = onError;
  startRef.current = start;

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

  useEffect(() => {
    setBootAttempt(0);
    setStatus('loading');
    setErrorMessage('');
  }, [start.sessionId]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    let session = null;
    let cancelled = false;

    const attach = () => {
      if (cancelled) return;
      setStatus('loading');
      setErrorMessage('');
      dbg('[FCDBG][IframeGameHost] attach', {
        sessionId: start.sessionId,
        iframeSrc,
        allowedOrigin: resolvedAllowedOrigin,
      });

      session = attachIframeHost({
        iframe,
        allowedOrigin: resolvedAllowedOrigin,
        payload: startRef.current,
        handlers: {
          onReady: () => {
            dbg('[FCDBG][IframeGameHost] runtime ready', {
              sessionId: startRef.current?.sessionId,
              attempt: bootAttempt,
            });
            setStatus('playing');
          },
          onComplete: async (result) => {
            try {
              const view = await completeGameSession(result);
              onDoneRef.current?.(view);
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Complete failed';
              dbgError('[FCDBG][IframeGameHost] complete failed', err);
              setStatus('error');
              setErrorMessage(message);
              onErrorRef.current?.(message);
            }
          },
          onEvent: (event) => {
            onRuntimeEvent?.(event);
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

    if (iframe.contentDocument?.readyState === 'complete') {
      attach();
    } else {
      iframe.addEventListener('load', attach);
    }

    return () => {
      cancelled = true;
      iframe.removeEventListener('load', attach);
      session?.cancel();
    };
  }, [bootAttempt, iframeSrc, resolvedAllowedOrigin, start.sessionId]);

  useEffect(() => {
    if (status !== 'loading') return undefined;
    if (bootAttempt >= 2) return undefined;

    const timeoutId = window.setTimeout(() => {
      dbgError('[FCDBG][IframeGameHost] ready timeout; retry bootstrap', {
        sessionId: start.sessionId,
        attempt: bootAttempt,
      });
      setBootAttempt((value) => value + 1);
    }, 4500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [bootAttempt, start.sessionId, status]);

  useEffect(() => {
    if (status !== 'loading' || bootAttempt < 2) return;
    const timeoutId = window.setTimeout(() => {
      if (status !== 'loading') return;
      const message = 'Game start timed out. Please retry.';
      setStatus('error');
      setErrorMessage(message);
      onErrorRef.current?.(message);
    }, 6500);
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
    </div>
  );
}
