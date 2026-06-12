import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { completeGameSession } from '../api/client.js';
import { dbg, dbgError } from '../lib/debug.js';
import { ensureRuntimesRegistered, getRuntime, getRuntimeManifestEntry } from '../lib/runtimeRegistry.js';
import { getRuntimeLoadConfig } from '../lib/runtimeLoadConfig.js';
import IframeGameHost from './IframeGameHost.jsx';

function normalizeStartPayloadForLocalHost(start) {
  const params = { ...(start.difficultyParams ?? {}) };

  if (start.runtimeComponent === 'BridgeCrossRuntime') {
    const stageCount = Number(params.stageCount);
    params.stageCount = Number.isFinite(stageCount) && stageCount > 0 ? Math.min(Math.floor(stageCount), 4) : 4;
  }

  if (start.runtimeComponent === 'DodgePlaneRuntime') {
    const survivalSeconds = Number(params.survivalSeconds);
    params.survivalSeconds =
      Number.isFinite(survivalSeconds) && survivalSeconds > 0 ? Math.min(survivalSeconds, 12) : 12;
  }

  return {
    ...start,
    difficultyParams: params,
  };
}

function InlineGameHost({ start, onDone, onError }) {
  const [Comp, setComp] = useState(null);
  const [err, setErr] = useState(null);
  const eventsRef = useRef([]);
  const eventLogCountRef = useRef(0);
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  onDoneRef.current = onDone;
  onErrorRef.current = onError;

  const normalizedStart = useMemo(() => normalizeStartPayloadForLocalHost(start), [start]);

  useEffect(() => {
    eventsRef.current = [];
    eventLogCountRef.current = 0;
    setErr(null);
    setComp(null);
    dbg('[FCDBG][GameHost] mount/start inline', {
      sessionId: start.sessionId,
      templateKey: start.templateKey,
      runtimeComponent: start.runtimeComponent,
    });
    ensureRuntimesRegistered();
    const loader = getRuntime(start.runtimeComponent);
    if (!loader) {
      dbgError('[FCDBG][GameHost] runtime loader missing', {
        runtimeComponent: start.runtimeComponent,
      });
      setErr(`Unknown runtime: ${start.runtimeComponent}`);
      return undefined;
    }

    let cancelled = false;
    loader()
      .then((mod) => {
        if (!cancelled) {
          setComp(() => mod.default);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          dbgError('[FCDBG][GameHost] runtime load failed', error);
          setErr(error instanceof Error ? error.message : 'Failed to load game');
        }
      });

    return () => {
      cancelled = true;
      dbg('[FCDBG][GameHost] unmount', { sessionId: start.sessionId });
    };
  }, [start.pointsMode, start.runtimeComponent, start.sessionId, start.templateKey]);

  const handleComplete = useCallback(async (result) => {
    try {
      const payload = {
        ...result,
        rawEvents:
          result.rawEvents?.length || eventsRef.current.length === 0
            ? result.rawEvents
            : eventsRef.current,
      };
      const view = await completeGameSession(payload);
      onDoneRef.current?.(view);
    } catch (error) {
      dbgError('[FCDBG][GameHost] complete failed', error);
      onErrorRef.current?.(error instanceof Error ? error.message : 'Complete failed');
    }
  }, []);

  const handleRuntimeEvent = useCallback((event) => {
    eventsRef.current.push(event);
    eventLogCountRef.current += 1;
  }, []);

  if (err) {
    return <p className="platform-game-error">{err}</p>;
  }
  if (!Comp) {
    return <p className="platform-game-loading">Loading game…</p>;
  }

  return (
    <div className="inline-game-host">
      {createElement(Comp, {
        gameStartPayload: normalizedStart,
        onComplete: handleComplete,
        onEvent: handleRuntimeEvent,
      })}
    </div>
  );
}

export default function GameHost({ start, onDone, onError }) {
  const manifestEntry = getRuntimeManifestEntry(start.runtimeComponent);
  const loadConfig = useMemo(
    () => getRuntimeLoadConfig(start.runtimeComponent, manifestEntry),
    [manifestEntry, start.runtimeComponent],
  );

  useEffect(() => {
    if (loadConfig.loadMode !== 'iframe' || !loadConfig.iframeUrl || !loadConfig.allowedOrigin) {
      return;
    }
    dbg('[FCDBG][GameHost] using iframe runtime', {
      runtimeComponent: start.runtimeComponent,
      iframeUrl: loadConfig.iframeUrl,
      allowedOrigin: loadConfig.allowedOrigin,
      sessionId: start.sessionId,
    });
  }, [
    loadConfig.allowedOrigin,
    loadConfig.iframeUrl,
    loadConfig.loadMode,
    start.runtimeComponent,
    start.sessionId,
  ]);

  if (loadConfig.loadMode === 'iframe' && loadConfig.iframeUrl && loadConfig.allowedOrigin) {
    return (
      <IframeGameHost
        start={start}
        iframeUrl={loadConfig.iframeUrl}
        allowedOrigin={loadConfig.allowedOrigin}
        onDone={onDone}
        onError={onError}
      />
    );
  }

  return <InlineGameHost start={start} onDone={onDone} onError={onError} />;
}
