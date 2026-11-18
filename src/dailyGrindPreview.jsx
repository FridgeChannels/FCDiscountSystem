import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../fc-style.css';
import '../fc-coupons.css';
import '../fc-tiers.css';
import '../fc-leaderboard.css';
import '../fc-coupon-wallet.css';
import './components/dailyGrindPreview.css';
import { completeSurvey, fetchRewardPlan, fetchSurveyQuestions, startGameSession, submitSurveyAnswers } from './api/client.js';
import {
  clearCachedRewardPlan,
  clearCachedShopifyStatus,
  markShopifyOAuthPending,
  readRememberedTouchId,
} from './api/cache.js';
import { mapPlanToViewModel } from './api/mapPlan.js';
import { DEV_FIXTURES } from './dev/fixtures.js';
import { parseTouchIdFromUrl } from './lib/touchId.js';
import { applyShellBrandToGameStart } from './lib/brandTheme.js';
import { ensureRuntimesRegistered, getRuntime, preloadRuntimeManifest } from './lib/runtimeRegistry.js';
import DailyGrindGameMap from './components/DailyGrindGameMap.jsx';
import PlatformGameModal from './components/PlatformGameModal.jsx';

const DEV_TOUCH_ID = 'A8SQN3V2OW';

function ensureDodgePlaneTask(view) {
  if (!view || view.challenges?.some((challenge) => challenge.templateKey === 'dodge_plane')) return view;
  return {
    ...view,
    challenges: [
      ...(view.challenges ?? []),
      {
        id: 'preview_dodge_plane',
        type: 'game',
        previewOnly: true,
        gameInstanceId: 'preview_dodge_plane',
        templateKey: 'dodge_plane',
        title: 'Dodge Plane',
        difficultyLevel: 1,
        rewardPotentialLevel: 1,
      },
    ],
  };
}

function createLocalPreviewView() {
  const view = ensureDodgePlaneTask(mapPlanToViewModel(DEV_FIXTURES.home()));
  view.challenges = [
    {
      id: 'shopify_connect',
      type: 'shopify_connect',
      title: 'Connect Shopify Account',
      pointsOffered: 100,
    },
    {
      id: 'survey-dev-campaign',
      type: 'survey',
      title: 'Preferences',
      campaignId: 'dev-campaign',
      questionCount: 1,
      pointsOffered: 10,
      pointsPerQuestion: 10,
      allowSkip: true,
    },
    ...view.challenges,
  ];
  return view;
}

function DirectRuntime({ start, onExit }) {
  const [Runtime, setRuntime] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    ensureRuntimesRegistered();
    const loader = getRuntime(start.runtimeComponent);
    if (!loader) {
      setError(`找不到游戏运行时：${start.runtimeComponent}`);
      return () => { cancelled = true; };
    }
    loader().then((module) => {
      if (!cancelled) setRuntime(() => module.default);
    }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : '游戏加载失败。');
    });
    return () => { cancelled = true; };
  }, [start.runtimeComponent]);

  return (
    <div className="daily-grind-runtime-overlay" role="dialog" aria-modal="true" aria-label={start.templateKey}>
      <button type="button" className="daily-grind-runtime-close" onClick={onExit} aria-label="返回小岛地图">×</button>
      <div className="daily-grind-runtime-stage">
        {error ? <p role="alert">{error}</p> : Runtime ? (
          <Runtime gameStartPayload={start} onComplete={onExit} onEvent={() => {}} />
        ) : <p>Loading game…</p>}
      </div>
    </div>
  );
}

function getTouchId() {
  return parseTouchIdFromUrl().touchId
    || readRememberedTouchId()
    || (import.meta.env.DEV ? DEV_TOUCH_ID : '');
}

function localGameStart(challenge, view) {
  const isBridge = challenge.templateKey === 'bridge_cross';
  const isDodgePlane = challenge.templateKey === 'dodge_plane';
  const sessionId = `preview-${crypto.randomUUID()}`;
  return {
    sessionId,
    rewardPlanId: view?.rewardPlanId ?? 'local-preview',
    policyVersion: 'local-preview',
    gameInstanceId: challenge.gameInstanceId,
    templateKey: challenge.templateKey,
    runtimeTier: isBridge || isDodgePlane ? 'canvas_pixi' : 'react_dom',
    runtimeComponent: isBridge
      ? 'BridgeCrossRuntime'
      : isDodgePlane
        ? 'DodgePlaneRuntime'
        : 'MemoryMatchRuntime',
    brandTheme: view?.brand ? applyShellBrandToGameStart({}, view.brand).brandTheme : {},
    contentConfig: {},
    difficultyParams: isBridge
      ? { stageCount: 4 }
      : isDodgePlane
        ? { survivalSeconds: 12 }
        : { pairs: 6 },
    difficultyLevel: 1,
    pointsMode: 'completion_only',
    serverSeed: sessionId,
    targetScore: 0,
    scoringPreview: { completionBonus: 0, accuracyWeight: 0 },
  };
}

function DailyGrindPreview() {
  const [touchId] = useState(getTouchId);
  const [planState, setPlanState] = useState({ loading: true, error: '', plan: null, view: null });
  const [gameState, setGameState] = useState({ challenge: null, start: null, loading: false, error: '' });
  const [surveyState, setSurveyState] = useState({ open: false, loading: false, submitting: false, question: null, error: '' });

  useEffect(() => {
    let cancelled = false;
    const hasExplicitTouchId = Boolean(parseTouchIdFromUrl().touchId || readRememberedTouchId());
    if (import.meta.env.DEV && !hasExplicitTouchId) {
      setPlanState({
        loading: false,
        error: '本地预览模式（游戏服务未连接）',
        plan: null,
        view: createLocalPreviewView(),
      });
      return () => { cancelled = true; };
    }
    if (!touchId) {
      setPlanState({ loading: false, error: '请从有效的 FC 页面打开，或在链接中添加 touchId。', plan: null, view: null });
      return () => { cancelled = true; };
    }
    Promise.all([
      fetchRewardPlan(touchId),
      preloadRuntimeManifest(touchId).catch(() => null),
    ]).then(([plan]) => {
      if (cancelled) return;
      const view = ensureDodgePlaneTask(mapPlanToViewModel(plan));
      setPlanState({ loading: false, error: '', plan, view });
    }).catch((error) => {
      if (cancelled) return;
      const fallbackView = import.meta.env.DEV ? createLocalPreviewView() : null;
      setPlanState({
        loading: false,
        error: import.meta.env.DEV
          ? '本地预览模式（游戏服务未连接）'
          : (error instanceof Error ? error.message : '无法加载游戏挑战。'),
        plan: null,
        view: fallbackView,
      });
    });
    return () => { cancelled = true; };
  }, [touchId]);

  const challenges = planState.view?.challenges ?? [];

  const startExistingGame = useCallback(async (challenge) => {
    if (!challenge?.gameInstanceId || gameState.loading) return;
    if (challenge.previewOnly || (import.meta.env.DEV && !planState.plan)) {
      setGameState({
        challenge,
        start: localGameStart(challenge, planState.view),
        loading: false,
        mode: 'local-preview',
        error: '',
      });
      return;
    }
    if (!planState.view?.rewardPlanId) {
      setGameState((current) => ({ ...current, error: '缺少游戏挑战计划，请从 FC 页面重新打开。' }));
      return;
    }
    setGameState({ challenge, start: null, loading: true, error: '' });
    try {
      const start = await startGameSession(planState.view.rewardPlanId, challenge.gameInstanceId);
      setGameState({
        challenge,
        start: applyShellBrandToGameStart(start, planState.view.brand),
        loading: false,
        mode: 'session',
        error: '',
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        setGameState({
          challenge,
          start: localGameStart(challenge, planState.view),
          loading: false,
          mode: 'local-preview',
          error: '',
        });
      } else {
        setGameState({
          challenge: null,
          start: null,
          loading: false,
          error: error instanceof Error ? error.message : '游戏暂时无法启动。',
        });
      }
    }
  }, [gameState.loading, planState.view]);

  const closeGame = useCallback(() => {
    setGameState({ challenge: null, start: null, loading: false, mode: '', error: '' });
  }, []);

  const openSurvey = useCallback(async (challenge) => {
    setSurveyState({ open: true, loading: true, submitting: false, question: null, error: '' });
    try {
      const payload = await fetchSurveyQuestions(touchId);
      const question = payload?.questions?.[0];
      if (!question) throw new Error('No survey questions are available right now.');
      setSurveyState({ open: true, loading: false, submitting: false, question, error: '', campaignId: payload?.survey_campaign?.id ?? challenge.campaignId });
    } catch (error) {
      if (import.meta.env.DEV) {
        setSurveyState({
          open: true,
          loading: false,
          submitting: false,
          campaignId: challenge.campaignId,
          localPreview: true,
          error: '',
          question: {
            id: 'local-preference',
            text: 'Which type of game would you like to play next?',
            options: [
              { id: 'memory', label: 'Card Match', value: 'Card Match' },
              { id: 'bridge', label: 'Bridge Cross', value: 'Bridge Cross' },
              { id: 'dodge', label: 'Dodge Plane', value: 'Dodge Plane' },
            ],
          },
        });
      } else {
        setSurveyState({ open: true, loading: false, submitting: false, question: null, error: error instanceof Error ? error.message : 'Could not load survey.' });
      }
    }
  }, [touchId]);

  const onOpenTask = useCallback((challenge) => {
    if (challenge.type === 'shopify_connect') {
      if (touchId) {
        markShopifyOAuthPending(touchId, 'task_card');
        clearCachedShopifyStatus(touchId);
        clearCachedRewardPlan(touchId);
      }
      const authBase = 'https://dtc-dashboard.fridgechannels.com/tap';
      const authUrl = touchId
        ? `${authBase}/${encodeURIComponent(touchId)}?redirectedFrom=${encodeURIComponent(window.location.href)}`
        : authBase;
      window.location.assign(authUrl);
      return;
    }
    if (challenge.type === 'survey') {
      openSurvey(challenge);
      return;
    }
    startExistingGame(challenge);
  }, [openSurvey, startExistingGame, touchId]);

  const answerSurvey = useCallback(async (option) => {
    if (surveyState.submitting || !surveyState.question) return;
    setSurveyState((current) => ({ ...current, submitting: true, error: '' }));
    const answerRecord = {
      questionId: surveyState.question.id,
      value: option?.value ?? option?.label ?? String(option),
      action: 'answered',
      optionId: option?.id,
    };
    try {
      if (!surveyState.localPreview) {
        await submitSurveyAnswers(touchId, {
          answer: {
            survey_campaign_id: surveyState.campaignId,
            survey_question_id: surveyState.question.id,
            action: 'answered',
            survey_option_id: option?.id,
            response_time_ms: 0,
          },
        });
        if (planState.view?.rewardPlanId) {
          await completeSurvey(touchId, planState.view.rewardPlanId, [answerRecord]).catch(() => null);
        }
      }
      setSurveyState({ open: false, loading: false, submitting: false, question: null, error: '' });
      if (!surveyState.localPreview) {
        const plan = await fetchRewardPlan(touchId).catch(() => null);
        if (plan) setPlanState({ loading: false, error: '', plan, view: mapPlanToViewModel(plan) });
      }
    } catch (error) {
      setSurveyState((current) => ({ ...current, submitting: false, error: error instanceof Error ? error.message : 'Could not save your answer.' }));
    }
  }, [planState.view?.rewardPlanId, surveyState, touchId]);

  const targetPoints = Number(planState.view?.discounts?.at(-1)?.target) || 0;
  const progressView = useMemo(() => ({
    currentPoints: Number(planState.view?.points) || 0,
    targetPoints,
    progressPct: targetPoints > 0 ? Math.min(100, ((Number(planState.view?.points) || 0) / targetPoints) * 100) : 0,
    label: `${Number(planState.view?.points) || 0} / ${targetPoints}`,
    ladder: (planState.view?.discounts ?? []).map((discount) => ({
      percent: Number.parseInt(String(discount.num ?? '').replace(/\D/g, ''), 10) || 0,
      threshold: Number(discount.target) || 0,
    })),
    giftReward: null,
  }), [planState.view, targetPoints]);

  const gameTitle = gameState.challenge?.title ?? 'Play & Earn';
  const loadingMessage = gameState.loading
    ? `Preparing ${gameState.challenge?.title ?? 'game'}…`
    : '';

  return (
    <main className="daily-grind-preview-page">
      <DailyGrindGameMap
        challenges={challenges}
        disabled={planState.loading}
        onOpen={onOpenTask}
      />
      {planState.loading && <p className="daily-grind-status">Loading your games…</p>}
      {planState.error && (
        <p className="daily-grind-status is-preview" role="status">
          本地预览模式：游戏服务未连接，点击小岛仍可体验现有游戏。
        </p>
      )}
      {!planState.loading && !planState.error && challenges.length === 0 && (
        <p className="daily-grind-status">No tasks are available right now.</p>
      )}
      {gameState.error && <p className="daily-grind-status is-error" role="alert">{gameState.error}</p>}
      <PlatformGameModal
        open={Boolean(gameState.start) && gameState.mode === 'session'}
        title={gameTitle}
        gameStart={gameState.start}
        brand={planState.view?.brand ?? null}
        progressView={progressView}
        loadingMessage={loadingMessage}
        leaderboard={[]}
        onClose={closeGame}
        onDone={closeGame}
        onError={(message) => setGameState((current) => ({ ...current, error: message }))}
        onRuntimeEvent={() => {}}
      />
      {gameState.start && gameState.mode === 'local-preview' && (
        <DirectRuntime start={gameState.start} onExit={closeGame} />
      )}
      {gameState.loading && (
        <div className="daily-grind-loading" role="status">
          <span />
          {loadingMessage}
        </div>
      )}
      {surveyState.open && (
        <div className="modal-overlay open" id="survey-modal" role="dialog" aria-modal="true" aria-labelledby="daily-grind-survey-title">
          <div className="modal-content">
            <div className="modal-header">
              <h3 id="daily-grind-survey-title">Quick Preferences Survey</h3>
              <button className="close-modal-btn" onClick={() => setSurveyState({ open: false, loading: false, submitting: false, question: null, error: '' })} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              {surveyState.loading ? <p className="survey-loading">Loading questions…</p> : surveyState.error ? <p role="alert">{surveyState.error}</p> : surveyState.question ? (
                <div className="survey-questions">
                  <div className="survey-question-step active">
                    <h4>{surveyState.question.text}</h4>
                    <div className="survey-options">
                      {(surveyState.question.options ?? []).map((option) => (
                        <button className="survey-option-btn" key={option.id} disabled={surveyState.submitting} onClick={() => answerSurvey(option)}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {surveyState.error && <p role="alert">{surveyState.error}</p>}
                    {surveyState.localPreview && <small className="daily-grind-survey-preview-note">Preview only · your answer won’t be submitted.</small>}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const previewRoot = window.__dailyGrindPreviewRoot ?? createRoot(document.getElementById('root'));
window.__dailyGrindPreviewRoot = previewRoot;
previewRoot.render(<DailyGrindPreview />);
