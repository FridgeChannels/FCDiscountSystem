import { useCallback, useEffect, useRef, useState } from 'react';
import { completeGameSession } from '../api/client.js';

/** How long the Game Over overlay stays visible before calling complete. */
export const GAME_OVER_DISPLAY_MS = 1400;

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Show a host-level Game Over overlay, then submit the session result.
 * Shared by iframe and inline game hosts so each game does not implement its own UI.
 */
export function useGameOverSettlement({ onDone, onError, sessionId }) {
  const [gameOverVisible, setGameOverVisible] = useState(false);
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  onDoneRef.current = onDone;
  onErrorRef.current = onError;

  useEffect(() => {
    setGameOverVisible(false);
  }, [sessionId]);

  const settleGameResult = useCallback(async (result) => {
    setGameOverVisible(true);
    await delay(GAME_OVER_DISPLAY_MS);
    const view = await completeGameSession(result);
    setGameOverVisible(false);
    onDoneRef.current?.(view);
    return view;
  }, []);

  const settleGameResultSafe = useCallback(async (result) => {
    try {
      return await settleGameResult(result);
    } catch (error) {
      setGameOverVisible(false);
      const message = error instanceof Error ? error.message : 'Complete failed';
      onErrorRef.current?.(message);
      throw error;
    }
  }, [settleGameResult]);

  return { gameOverVisible, settleGameResult, settleGameResultSafe };
}
