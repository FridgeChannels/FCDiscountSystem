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
 * @property {{ connected: boolean, shopifyCustomerId?: string, shopDomain?: string, shop?: string, email?: string }} [shopifyStatus]
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
    label: 'Gift',
    fixture: DEV_FIXTURES.intro,
    ui: { welcomeStep: 0, introActive: true, clearWelcome: true, clearClaimed: true },
  },
  {
    id: 'welcome',
    label: 'Welcome',
    fixture: DEV_FIXTURES.welcome,
    ui: { welcomeStep: 1, introActive: false, clearWelcome: true, clearClaimed: true },
  },
  {
    id: 'return-visit',
    label: '回访礼盒',
    fixture: DEV_FIXTURES.returnVisit,
    ui: {
      welcomeStep: 3,
      introActive: true,
      setWelcomeCompleted: true,
      clearClaimed: true,
    },
  },
  {
    id: 'home',
    label: 'Home',
    fixture: DEV_FIXTURES.home,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      clearClaimed: true,
      shopifyStatus: {
        connected: true,
        shopifyCustomerId: 'mock-customer-001',
        shopDomain: 'ritual-demo.myshopify.com',
        shop: 'Ritual Demo',
        email: 'shopper@example.com',
      },
    },
  },
  {
    id: 'single-target',
    label: 'Single',
    fixture: DEV_FIXTURES.singleTarget,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      clearClaimed: true,
    },
  },
  {
    id: 'urgent',
    label: 'Countdown',
    fixture: DEV_FIXTURES.urgent,
    ui: { welcomeStep: 3, introActive: false, setWelcomeCompleted: true, clearClaimed: true },
  },
  {
    id: 'unlocked',
    label: '礼包解锁',
    fixture: DEV_FIXTURES.unlocked,
    ui: { welcomeStep: 3, introActive: false, setWelcomeCompleted: true, clearClaimed: true },
  },
  {
    id: 'completed',
    label: 'Completed',
    fixture: DEV_FIXTURES.completed,
    ui: { welcomeStep: 3, introActive: false, setWelcomeCompleted: true, clearClaimed: true },
  },
  {
    id: 'receipt',
    label: 'Receipt',
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
    label: 'Flip',
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
    label: 'Survey',
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
    id: 'redeemed',
    label: 'Redeemed',
    fixture: DEV_FIXTURES.redeemed,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      clearClaimed: true,
      newChallenge: {
        reason: 'redeemed',
        coupon: { num: '30', value: '30% OFF', code: 'FC30RITUAL', tier: 3 },
      },
    },
  },
  {
    id: 'expired',
    label: 'Expired',
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
    label: 'Notify',
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
    label: 'Game',
    fixture: DEV_FIXTURES.game,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      clearClaimed: true,
      activeModal: 'platform-game',
    },
  },
  {
    id: 'shopify-auth',
    label: 'Shopify Auth',
    fixture: DEV_FIXTURES.game,
    ui: {
      welcomeStep: 3,
      introActive: false,
      setWelcomeCompleted: true,
      clearClaimed: true,
      shopifyAuthOverlay: { source: 'claim' },
    },
  },
];

const SCENE_BY_ID = new Map(DEV_SCENES.map((scene) => [scene.id, scene]));

export function getSceneConfig(sceneId) {
  if (!sceneId) return null;
  return SCENE_BY_ID.get(sceneId) ?? null;
}
