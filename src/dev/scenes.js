import { DEV_FIXTURES } from './fixtures.js';

/** @typedef {import('./fixtures.js').DEV_FIXTURES} Fixtures */

/**
 * @typedef {Object} DevSceneUi
 * @property {number} [welcomeStep]
 * @property {boolean} [introActive]
 * @property {boolean} [clearWelcome]
 * @property {boolean} [setWelcomeCompleted]
 * @property {boolean} [clearClaimed]
 * @property {string} [claimedCode]
 * @property {boolean} [openReceipt]
 * @property {boolean} [openZoomFlip]
 * @property {'flipped' | 'zoomed' | 'init'} [zoomPhase]
 * @property {'survey' | 'platform-game'} [activeModal]
 * @property {number} [surveyStep]
 * @property {{ reason: 'redeemed' | 'expired' }} [newChallenge]
 * @property {{ title: string, message: string, icon: string }} [notification]
 * @property {{ onConfirm: () => void, discount: string | number }} [claimConfirm]
 */

/**
 * @typedef {Object} DevSceneConfig
 * @property {string} id
 * @property {string} label
 * @property {() => object} fixture
 * @property {DevSceneUi} ui
 */

/** @type {DevSceneConfig[]} */
export const DEV_SCENES = [
  {
    id: 'intro',
    label: '礼盒',
    fixture: DEV_FIXTURES.intro,
    ui: { welcomeStep: 0, introActive: true, clearWelcome: true, clearClaimed: true },
  },
  {
    id: 'welcome',
    label: '欢迎流',
    fixture: DEV_FIXTURES.welcome,
    ui: { welcomeStep: 1, introActive: false, clearWelcome: true, clearClaimed: true },
  },
  {
    id: 'home',
    label: '首页',
    fixture: DEV_FIXTURES.home,
    ui: { welcomeStep: 3, introActive: false, setWelcomeCompleted: true, clearClaimed: true },
  },
  {
    id: 'urgent',
    label: '倒计时',
    fixture: DEV_FIXTURES.urgent,
    ui: { welcomeStep: 3, introActive: false, setWelcomeCompleted: true, clearClaimed: true },
  },
  {
    id: 'best',
    label: '最高档',
    fixture: DEV_FIXTURES.best,
    ui: { welcomeStep: 3, introActive: false, setWelcomeCompleted: true, clearClaimed: true },
  },
  {
    id: 'claimed',
    label: '已领取',
    fixture: DEV_FIXTURES.claimed,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      claimedCode: 'FC30RITUAL',
    },
  },
  {
    id: 'receipt',
    label: '小票',
    fixture: DEV_FIXTURES.receipt,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      clearClaimed: true,
      openReceipt: true,
    },
  },
  {
    id: 'zoom',
    label: '翻转',
    fixture: DEV_FIXTURES.zoom,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      claimedCode: 'FC20RITUAL',
      openZoomFlip: true,
      zoomPhase: 'flipped',
    },
  },
  {
    id: 'survey',
    label: '问卷',
    fixture: DEV_FIXTURES.survey,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      clearClaimed: true,
      activeModal: 'survey',
      surveyStep: 0,
    },
  },
  {
    id: 'claim',
    label: '确认领',
    fixture: DEV_FIXTURES.claim,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      clearClaimed: true,
      claimConfirm: { onConfirm: () => {}, discount: '30' },
    },
  },
  {
    id: 'redeemed',
    label: '已核销',
    fixture: DEV_FIXTURES.redeemed,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      clearClaimed: true,
      newChallenge: { reason: 'redeemed' },
    },
  },
  {
    id: 'expired',
    label: '已过期',
    fixture: DEV_FIXTURES.expired,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      clearClaimed: true,
      newChallenge: { reason: 'expired' },
    },
  },
  {
    id: 'notify',
    label: '通知',
    fixture: DEV_FIXTURES.notify,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      clearClaimed: true,
      notification: {
        title: 'Survey Completed!',
        message: 'Thanks for sharing — you earned +10 pts.',
        icon: '📝',
      },
    },
  },
  {
    id: 'game',
    label: '游戏',
    fixture: DEV_FIXTURES.game,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      clearClaimed: true,
      activeModal: 'platform-game',
    },
  },
];

const SCENE_BY_ID = new Map(DEV_SCENES.map((scene) => [scene.id, scene]));

export function getSceneConfig(sceneId) {
  if (!sceneId) return null;
  return SCENE_BY_ID.get(sceneId) ?? null;
}
