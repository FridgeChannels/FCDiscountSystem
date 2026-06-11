import { useEffect, useMemo, useRef, useState } from 'react';
import { attachIframeHost } from '@fc/game-bridge';
import { completeGameSession } from '../api/client.js';
import { dbg, dbgError } from '../lib/debug.js';

export default function IframeGameHost({ start, iframeUrl, allowedOrigin, onDone, onError }) {
  const iframeRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  const startRef = useRef(start);
  onDoneRef.current = onDone;
  onErrorRef.current = onError;
  startRef.current = start;

  const iframeSrc = useMemo(() => {
    const url = new URL(iframeUrl, window.location.href);
    url.searchParams.set('parentOrigin', window.location.origin);
    return url.toString();
  }, [iframeUrl]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    setStatus('loading');
    setErrorMessage('');
    dbg('[FCDBG][IframeGameHost] attach', {
      sessionId: start.sessionId,
      iframeSrc,
      allowedOrigin,
    });

    const session = attachIframeHost({
      iframe,
      allowedOrigin,
      payload: startRef.current,
      handlers: {
        onReady: () => setStatus('playing'),
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
        onError: (message) => {
          dbgError('[FCDBG][IframeGameHost] runtime error', message);
          setStatus('error');
          setErrorMessage(message);
          onErrorRef.current?.(message);
        },
      },
    });

    return () => {
      session.cancel();
    };
  }, [allowedOrigin, iframeSrc, start.sessionId]);

  if (status === 'error') {
    return <p className="platform-game-error">{errorMessage || 'Game failed to load'}</p>;
  }

  return (
    <div className="iframe-game-host">
      {status === 'loading' ? <p className="platform-game-loading">Loading game shell…</p> : null}
      <iframe
        ref={iframeRef}
        title={`Game ${start.templateKey}`}
        src={iframeSrc}
        sandbox="allow-scripts allow-same-origin"
        className="platform-game-iframe"
        style={{
          width: '100%',
          minHeight: 420,
          border: '1px solid #ddd',
          borderRadius: 12,
          background: '#fff',
        }}
      />
    </div>
  );
}
