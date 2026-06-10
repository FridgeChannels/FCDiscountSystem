// FC Discount Coupon Home — state & interaction logic (v2)

// 1. State
const state = {
  points: 72,
  targetPoints: 90,
  discounts: [
    { num: '15', value: '15% OFF', target: 0,   code: 'FC15RITUAL' },
    { num: '20', value: '20% OFF', target: 90,  code: 'FC20RITUAL' },
    { num: '25', value: '25% OFF', target: 120, code: 'FC25RITUAL' }
  ],
  currentStepIndex: 0,
  countdownSeconds: 2 * 24 * 3600 + 4 * 3600 + 55 * 60, // 2d 4h 55m
  initialSeconds: 2 * 24 * 3600 + 4 * 3600 + 55 * 60,
  isTimerRunning: true,
  dailyCapReached: false
};

// 2. DOM
const $ = (id) => document.getElementById(id);

const el = {
  // countdown
  timerDays: $('timer-days'),
  timerHours: $('timer-hours'),
  timerMins: $('timer-mins'),
  timerSecs: $('timer-secs'),
  depleteFill: $('deplete-fill'),
  urgencyBanner: $('urgency-banner'),
  ubLabelText: $('ub-label-text'),
  ubSub: $('ub-sub'),
  ubDiscount: $('ub-discount'),
  capsuleTimer: $('capsule-timer'),

  // tap toast
  tapRewardBanner: $('tap-reward-banner'),
  closeAlertBtn: $('close-alert-btn'),

  // wallet
  wallet: $('wallet'),
  walletTag: $('wallet-tag'),
  currentWrap: $('current-wrap'),
  currentCoupon: $('current-coupon'),
  currentStubValue: $('current-stub-value'),
  currentTag: $('current-tag'),
  currentCodeChip: $('current-code-chip'),
  couponExpireText: $('coupon-expire-text'),
  useNowBtn: $('use-now-btn'),

  upgradeRail: $('upgrade-rail'),
  railNeeded: $('rail-needed'),
  railTarget: $('rail-target'),

  targetWrap: $('target-wrap'),
  targetCoupon: $('target-coupon'),
  targetStubValue: $('target-stub-value'),
  targetTag: $('target-tag'),
  couponFill: $('coupon-fill'),
  tpFill: $('tp-fill'),
  progressRatioText: $('progress-ratio-text'),
  routeCoin: $('route-coin'),
  couponRoute: document.querySelector('.coupon-route'),

  // completed state
  completedBanner: $('completed-banner'),
  maxDiscountLabel: $('max-discount-label'),
  currentExpiryTitle: $('current-expiry-title'),
  nextRoundCard: $('next-round-card'),
  nextRoundTimer: $('next-round-timer'),
  currentKicker: $('current-kicker'),
  currentStubOff: $('current-stub-off'),
  currentTitle: $('current-title'),

  // challenges
  tasksSection: $('tasks-section'),
  playGameBtn: $('play-game-btn'),
  playMemoryBtn: $('play-memory-btn'),
  playSpinBtn: $('play-spin-btn'),
  takeSurveyBtn: $('take-survey-btn'),

  // rules
  rulesTrigger: $('rules-trigger'),
  rulesContent: $('rules-content'),

  // drawer
  drawerOverlay: $('drawer-overlay'),
  couponDrawer: $('coupon-drawer'),
  closeDrawerBtn: $('close-drawer-btn'),
  drawerCouponValue: $('drawer-coupon-value'),
  couponCodeText: $('coupon-code-text'),
  copyCodeBtn: $('copy-code-btn'),
  shopNowBtn: $('shop-now-btn'),
  drawerTimerText: $('drawer-timer-text'),

  // tap game
  gameModal: $('game-modal'),
  closeGameBtn: $('close-game-btn'),
  startGameBtn: $('start-game-btn'),
  gameTimer: $('game-timer'),
  gameScore: $('game-score'),
  gameTapTarget: $('game-tap-target'),

  // memory game
  memoryModal: $('memory-modal'),
  closeMemoryBtn: $('close-memory-btn'),
  startMemoryBtn: $('start-memory-btn'),
  memoryCards: document.querySelectorAll('.memory-card'),

  // spin game
  spinModal: $('spin-modal'),
  closeSpinBtn: $('close-spin-btn'),
  startSpinBtn: $('start-spin-btn'),
  wheelOuter: $('wheel-outer'),

  // survey
  surveyModal: $('survey-modal'),
  closeSurveyBtn: $('close-survey-btn'),
  surveyStepProgress: $('survey-step-progress'),
  surveyQuestionSteps: document.querySelectorAll('.survey-question-step'),
  surveyOptionBtns: document.querySelectorAll('.survey-option-btn'),

  // notification
  notificationModal: $('notification-modal'),
  notificationTitle: $('notification-title'),
  notificationMessage: $('notification-message'),
  notificationIcon: $('notification-icon'),
  notificationConfirmBtn: $('notification-confirm-btn'),
  closeNotificationBtn: $('close-notification-btn'),

  viewport: document.querySelector('.mobile-viewport')
};

// 3. Init
function init() {
  setupEventListeners();
  updateUI();
  startCountdown();
  initConfetti();
}

function pctHTML(d) {
  return d.num + '<small>%</small>';
}

function setUseButton(label) {
  el.useNowBtn.innerHTML = '<span>' + label + '</span><span class="use-arrow"></span>';
}

// 4. Render state
function updateUI() {
  const cur = state.discounts[state.currentStepIndex];
  const next = state.discounts[state.currentStepIndex + 1];

  el.currentStubValue.innerHTML = pctHTML(cur);
  if (el.currentCodeChip) el.currentCodeChip.innerText = cur.code;
  el.drawerCouponValue.innerText = cur.value;
  el.couponCodeText.innerText = cur.code;
  setUseButton('Use now');
  el.ubDiscount.innerText = cur.value;

  // Best offer (final tier)
  if (!next) {
    el.wallet.classList.add('best-offer');
    el.walletTag.innerText = 'Best offer unlocked';
    if (el.currentTag) el.currentTag.innerText = '★ Best Offer · Maximum discount';
    setUseButton('Claim now');

    // Show completed banners and labels
    if (el.completedBanner) el.completedBanner.style.display = 'block';
    if (el.maxDiscountLabel) el.maxDiscountLabel.style.display = 'inline-flex';
    if (el.currentExpiryTitle) el.currentExpiryTitle.style.display = 'block';
    if (el.nextRoundCard) el.nextRoundCard.style.display = 'block';

    // Customize current coupon face text
    if (el.currentKicker) el.currentKicker.innerText = '当前可用优惠券';
    if (el.currentStubOff) el.currentStubOff.style.display = 'none';
    if (el.currentTitle) el.currentTitle.innerText = 'CODE: ' + cur.code;

    // Hide route progress, target coupon wrap, and challenges section
    if (el.couponRoute) el.couponRoute.style.display = 'none';
    if (el.targetWrap) el.targetWrap.style.display = 'none';
    el.tasksSection.style.display = 'none';

    el.ubSub.innerHTML = 'Best price secured — order before <b>' + cur.value + '</b> expires';

    // Initialize timer displays in completed state
    const fmtInit = (n) => String(n).padStart(2, '0');
    const dInit = Math.floor(state.countdownSeconds / 86400);
    const hInit = Math.floor((state.countdownSeconds % 86400) / 3600);
    const mInit = Math.floor((state.countdownSeconds % 3600) / 60);
    const sInit = state.countdownSeconds % 60;
    const totalHoursInit = dInit * 24 + hInit;
    const tickerInit = fmtInit(totalHoursInit) + ':' + fmtInit(mInit) + ':' + fmtInit(sInit);
    if (el.currentExpiryTitle) el.currentExpiryTitle.innerText = tickerInit + ' 后结束';
    if (el.nextRoundTimer) el.nextRoundTimer.innerText = tickerInit;

    return;
  }

  // Restore Default State (when next exists)
  if (el.completedBanner) el.completedBanner.style.display = 'none';
  if (el.maxDiscountLabel) el.maxDiscountLabel.style.display = 'none';
  if (el.currentExpiryTitle) el.currentExpiryTitle.style.display = 'none';
  if (el.nextRoundCard) el.nextRoundCard.style.display = 'none';
  
  if (el.currentKicker) el.currentKicker.innerText = 'From coupon';
  if (el.currentStubOff) el.currentStubOff.style.display = 'inline';
  if (el.currentTitle) el.currentTitle.innerText = 'Sitewide · No minimum';

  if (el.couponRoute) el.couponRoute.style.display = 'block';
  if (el.targetWrap) el.targetWrap.style.display = 'block';
  el.tasksSection.style.display = 'block';

  el.wallet.classList.remove('best-offer');
  el.walletTag.innerText = 'Your coupon';
  if (el.currentTag) el.currentTag.innerText = '✓ Unlocked · Ready to use';

  el.targetStubValue.innerHTML = pctHTML(next);
  if (el.railTarget) el.railTarget.innerText = next.value;
  state.targetPoints = next.target;

  renderProgress(state.points);

  const delta = state.targetPoints - state.points;
  if (delta > 0) {
    el.targetWrap.classList.remove('ready');
    if (el.targetTag) el.targetTag.innerText = delta + ' pts to go';
  } else {
    el.targetWrap.classList.add('ready');
    if (el.targetTag) el.targetTag.innerText = 'Ready to unlock!';
  }

  if (state.dailyCapReached) {
    [el.playGameBtn, el.playMemoryBtn, el.playSpinBtn, el.takeSurveyBtn].forEach((b) => {
      b.disabled = true;
      b.innerText = 'Cap Reached';
    });
  }
}

function renderProgress(points) {
  const pct = Math.min((points / state.targetPoints) * 100, 100);
  el.couponFill.style.width = pct + '%';
  if (el.tpFill) el.tpFill.style.width = pct + '%';
  el.progressRatioText.innerText = points + ' / ' + state.targetPoints;
  el.railNeeded.innerText = Math.max(state.targetPoints - points, 0);

  // Dynamically position route coin along the Bezier curve of the arc
  if (el.routeCoin) {
    const t = pct / 100;
    const u = 1 - t;
    const x = 8 * u * u * u + 156 * u * u * t + 372 * u * t * t + 170 * t * t * t;
    const y = 58 * u * u * u + 6 * u * u * t + 6 * u * t * t + 58 * t * t * t;
    el.routeCoin.style.left = (x / 178) * 100 + '%';
    el.routeCoin.style.top = (y / 70) * 100 + '%';
  }
}

// 5. Events
function setupEventListeners() {
  if (el.closeAlertBtn && el.tapRewardBanner) {
    el.closeAlertBtn.addEventListener('click', () => {
      el.tapRewardBanner.style.opacity = '0';
      setTimeout(() => { el.tapRewardBanner.style.display = 'none'; }, 300);
    });
  }

  el.rulesTrigger.addEventListener('click', () => {
    el.rulesContent.classList.toggle('open');
    el.rulesTrigger.querySelector('.accordion-icon').innerText =
      el.rulesContent.classList.contains('open') ? '−' : '+';
  });

  el.useNowBtn.addEventListener('click', playTearThenOpenDrawer);
  el.closeDrawerBtn.addEventListener('click', closeDrawer);
  el.drawerOverlay.addEventListener('click', closeDrawer);
  el.copyCodeBtn.addEventListener('click', handleCopyCode);

  el.shopNowBtn.addEventListener('click', () => {
    el.shopNowBtn.innerText = 'Opening store...';
    el.shopNowBtn.disabled = true;
    setTimeout(() => {
      showCustomAlert('Ready to use', 'Your coupon is claimed. We are opening Ritual with this code ready for checkout!', '🛍️', () => {
        el.shopNowBtn.innerText = 'Use at Store';
        el.shopNowBtn.disabled = false;
        closeDrawer();
      });
    }, 1200);
  });

  el.playGameBtn.addEventListener('click', () => openModal(el.gameModal));
  el.closeGameBtn.addEventListener('click', () => closeModal(el.gameModal));
  el.startGameBtn.addEventListener('click', startMiniGame);

  el.playMemoryBtn.addEventListener('click', () => openModal(el.memoryModal));
  el.closeMemoryBtn.addEventListener('click', () => closeModal(el.memoryModal));
  el.startMemoryBtn.addEventListener('click', startMemoryGame);

  el.playSpinBtn.addEventListener('click', () => openModal(el.spinModal));
  el.closeSpinBtn.addEventListener('click', () => closeModal(el.spinModal));
  el.startSpinBtn.addEventListener('click', startSpinGame);

  el.takeSurveyBtn.addEventListener('click', () => openModal(el.surveyModal));
  el.closeSurveyBtn.addEventListener('click', () => closeModal(el.surveyModal));
  el.surveyOptionBtns.forEach((btn) => btn.addEventListener('click', handleSurveyOptionClick));
}

// 5b. Reset Round
function resetRound() {
  // Generate fresh discounts
  const prevDiscounts = state.discounts;
  const nextStart = parseInt(prevDiscounts[0].num, 10) + 5;
  const finalStart = nextStart > 30 ? 15 : nextStart;
  state.discounts = [
    { num: String(finalStart), value: finalStart + '% OFF', target: 0,   code: 'FC' + finalStart + 'RITUAL' },
    { num: String(finalStart + 5), value: (finalStart + 5) + '% OFF', target: 90,  code: 'FC' + (finalStart + 5) + 'RITUAL' },
    { num: String(finalStart + 10), value: (finalStart + 10) + '% OFF', target: 120, code: 'FC' + (finalStart + 10) + 'RITUAL' }
  ];
  state.currentStepIndex = 0;
  state.points = 5;
  state.countdownSeconds = state.initialSeconds;
  state.isTimerRunning = true;
  state.dailyCapReached = false;

  // Clean up zoom overlay
  var zoomOverlay = document.getElementById('zoom-overlay');
  var zoomContainer = document.getElementById('zoom-card-container');
  if (zoomOverlay) zoomOverlay.remove();
  if (zoomContainer) zoomContainer.remove();

  // Clean up printer overlay
  var printerOverlay = document.getElementById('printer-overlay');
  if (printerOverlay) printerOverlay.remove();

  // Reset expired state
  el.currentCoupon.classList.remove('expired');
  el.useNowBtn.disabled = false;
  el.urgencyBanner.classList.remove('urgent');
  el.ubLabelText.innerText = 'Limited offer ends in';
  el.currentWrap.classList.remove('tearing');

  updateUI();
}

// 6. Countdown
function startCountdown() {
  const fmt = (n) => String(n).padStart(2, '0');

  const updateTimer = () => {
    if (state.countdownSeconds <= 0) {
      resetRound();
      return;
    }

    state.countdownSeconds--;

    const d = Math.floor(state.countdownSeconds / 86400);
    const h = Math.floor((state.countdownSeconds % 86400) / 3600);
    const m = Math.floor((state.countdownSeconds % 3600) / 60);
    const s = state.countdownSeconds % 60;

    el.timerDays.innerText = fmt(d);
    el.timerHours.innerText = fmt(h);
    el.timerMins.innerText = fmt(m);
    el.timerSecs.innerText = fmt(s);

    // seconds tick pop
    el.timerSecs.classList.remove('tick');
    void el.timerSecs.offsetWidth;
    el.timerSecs.classList.add('tick');

    const short = d > 0 ? `${d}d ${fmt(h)}h` : `${h}h ${fmt(m)}m`;
    if (el.capsuleTimer) el.capsuleTimer.innerText = short + ' left';
    if (el.couponExpireText) el.couponExpireText.innerText = short;
    el.drawerTimerText.innerText = `${d}d ${fmt(h)}h ${fmt(m)}m`;

    // Update completed-state timer displays
    const totalHours = d * 24 + h;
    const tickerStr = fmt(totalHours) + ':' + fmt(m) + ':' + fmt(s);
    if (el.currentExpiryTitle) el.currentExpiryTitle.innerText = tickerStr + ' 后结束';
    if (el.nextRoundTimer) el.nextRoundTimer.innerText = tickerStr;

    el.depleteFill.style.width = Math.max(0, (state.countdownSeconds / state.initialSeconds) * 100) + '%';

    if (state.countdownSeconds < 86400) {
      el.urgencyBanner.classList.add('urgent');
      if (el.capsuleTimer) el.capsuleTimer.classList.add('alert-countdown');
      el.ubLabelText.innerText = 'Ends today — don\u2019t lose it';
    }
  };

  updateTimer();
  const interval = setInterval(() => {
    if (state.isTimerRunning) updateTimer();
    else clearInterval(interval);
  }, 1000);
}

// 7. Drawer
function openDrawer() {
  el.drawerOverlay.classList.add('open');
  el.couponDrawer.classList.add('open');
}

function playTearThenOpenDrawer() {
  el.currentWrap.classList.add('tearing');
  el.useNowBtn.disabled = true;

  const canvas = document.createElement('canvas');
  canvas.className = 'tear-canvas';
  el.currentWrap.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width;
  const H = 250;
  const H_btn = 58;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  let animationFrameId;
  let startTime = null;
  const tearDuration = 650;
  const maxTearAngle = 0.38;

  const numPoints = 15;
  const jaggedOffsets = Array.from({ length: numPoints }, (v, i) => {
    if (i === 0 || i === numPoints - 1) return 0;
    return (Math.random() - 0.5) * 3.5;
  });

  let particles = [];
  const isBestOffer = el.wallet.classList.contains('best-offer');

  function spawnParticle(x, y) {
    const isWhite = Math.random() > 0.4;
    const color = isWhite 
      ? '#ffffff' 
      : (isBestOffer ? '#cda756' : '#ec82bd');
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.7) * 2.5,
      vy: (Math.random() - 0.6) * 3,
      g: 0.14,
      size: Math.random() * 2 + 1,
      alpha: 1.0,
      decay: Math.random() * 0.02 + 0.025
    });
  }

  let fallX = 0;
  let fallY = 0;
  let fallVX = 0.6;
  let fallVY = 1.0;
  let fallAngle = 0;
  let fallVAngle = 0.045;
  let fallAlpha = 1.0;
  const gravity = 0.35;

  function drawButtonBase(ctx, text) {
    const grad = ctx.createLinearGradient(0, 0, W, H_btn);
    if (isBestOffer) {
      grad.addColorStop(0, '#cda756');
      grad.addColorStop(1, '#977229');
    } else {
      grad.addColorStop(0, '#ec82bd');
      grad.addColorStop(1, '#cf609f');
    }
    ctx.fillStyle = grad;
    
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, H_btn - 18);
    ctx.quadraticCurveTo(W, H_btn, W - 18, H_btn);
    ctx.lineTo(18, H_btn);
    ctx.quadraticCurveTo(0, H_btn, 0, H_btn - 18);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 12px "DM Sans", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textCenterX = 18 + (W - 66) / 2;
    ctx.fillText(text, textCenterX, H_btn / 2);

    const ax = W - 33;
    const ay = H_btn / 2;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(ax - 9, ay + 8);
    ctx.lineTo(ax + 9, ay + 8);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(ax, ay - 8);
    ctx.lineTo(ax, ay + 8);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(ax - 4, ay + 4);
    ctx.lineTo(ax, ay + 8);
    ctx.lineTo(ax + 4, ay + 4);
    ctx.stroke();
  }

  function drawJaggedLine(ctx, startX, startY, endX, endY) {
    const steps = numPoints - 1;
    for (let i = 1; i <= steps; i++) {
      const pct = i / steps;
      const cy = startY + (endY - startY) * pct;
      const cx = startX + (endX - startX) * pct + jaggedOffsets[i];
      ctx.lineTo(cx, cy);
    }
  }

  let completedTriggered = false;

  const render = (timestamp) => {
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;

    ctx.clearRect(0, 0, W, H);

    particles.forEach((p, idx) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.g;
      p.alpha -= p.decay;
      if (p.alpha <= 0) {
        particles.splice(idx, 1);
      }
    });

    if (elapsed < tearDuration) {
      const p = elapsed / tearDuration;
      const x_tear = p * W;

      // Dynamic clip path: set CSS --tear-x on parent to crop card background
      if (canvas.parentElement) {
        canvas.parentElement.style.setProperty('--tear-x', `${x_tear}px`);
      }

      const vibrate = Math.sin(p * 55) * 0.012 * (1 - p);
      const theta = -maxTearAngle * Math.pow(p, 1.6) + vibrate;

      if (Math.random() > 0.1) {
        spawnParticle(x_tear, 0);
        spawnParticle(x_tear, H_btn / 2);
        spawnParticle(x_tear, H_btn);
      }

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x_tear, 0);
      drawJaggedLine(ctx, x_tear, 0, x_tear, H_btn);
      ctx.lineTo(W, H_btn);
      ctx.lineTo(W, 0);
      ctx.closePath();
      ctx.clip();
      
      drawButtonBase(ctx, isBestOffer ? 'CLAIM NOW' : 'USE NOW');
      ctx.restore();

      ctx.save();
      ctx.translate(x_tear, 0);
      ctx.rotate(theta);
      
      ctx.beginPath();
      ctx.moveTo(-x_tear, 0);
      ctx.lineTo(0, 0);
      drawJaggedLine(ctx, 0, 0, 0, H_btn);
      ctx.lineTo(-x_tear, H_btn);
      ctx.closePath();
      ctx.clip();

      ctx.translate(-x_tear, 0);
      drawButtonBase(ctx, isBestOffer ? 'CLAIM NOW' : 'USE NOW');
      ctx.restore();

      fallX = x_tear;
      fallY = 0;
      fallAngle = theta;

    } else {
      const fallElapsed = elapsed - tearDuration;
      
      // Lock clip path to full width when tear is complete
      if (canvas.parentElement) {
        canvas.parentElement.style.setProperty('--tear-x', `${W}px`);
      }

      if (!completedTriggered && fallElapsed > 250) {
        completedTriggered = true;
        openZoomCardFromTear();
      }

      fallY += fallVY;
      fallVY += gravity;
      fallX += fallVX;
      fallAngle += fallVAngle;
      fallAlpha -= 0.032;

      if (fallAlpha > 0) {
        ctx.save();
        ctx.translate(fallX, fallY);
        ctx.rotate(fallAngle);
        ctx.globalAlpha = fallAlpha;

        ctx.beginPath();
        ctx.moveTo(-W, 0);
        ctx.lineTo(0, 0);
        drawJaggedLine(ctx, 0, 0, 0, H_btn);
        ctx.lineTo(-W + 18, H_btn);
        ctx.quadraticCurveTo(-W, H_btn, -W, H_btn - 18);
        ctx.closePath();
        ctx.clip();

        ctx.translate(-W, 0);
        drawButtonBase(ctx, isBestOffer ? 'CLAIM NOW' : 'USE NOW');
        ctx.restore();
      }
    }

    particles.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    if (elapsed < tearDuration || fallAlpha > 0 || particles.length > 0) {
      animationFrameId = requestAnimationFrame(render);
    } else {
      if (canvas.parentElement) {
        canvas.parentElement.style.removeProperty('--tear-x');
      }
      canvas.remove();
    }
  };

  animationFrameId = requestAnimationFrame(render);
}

function closeDrawer() {
  el.drawerOverlay.classList.remove('open');
  el.couponDrawer.classList.remove('open');
  setTimeout(() => {
    el.currentWrap.classList.remove('tearing');
    el.useNowBtn.disabled = false;
    const leftoverCanvas = el.currentWrap.querySelector('.tear-canvas');
    if (leftoverCanvas) leftoverCanvas.remove();
  }, 260);
}

// ---- 3D Zoom-and-Flip Card ----

function formatCountdownShort(seconds) {
  const safe = Math.max(seconds, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const d = Math.floor(safe / 86400);
  const h = Math.floor((safe % 86400) / 3600);
  const m = Math.floor((safe % 3600) / 60);
  return d > 0 ? `${d}d ${pad(h)}h` : `${h}h ${pad(m)}m`;
}

function openZoomCardFromTear() {
  const cur = state.discounts[state.currentStepIndex];
  const faceEl = el.currentCoupon.querySelector('.coupon-face');
  if (!faceEl) { openDrawer(); return; }

  const faceRect = faceEl.getBoundingClientRect();
  const vpRect = el.viewport.getBoundingClientRect();

  showZoomCard(cur, {
    left: faceRect.left,
    top: faceRect.top,
    width: faceRect.width,
    height: faceRect.height
  }, false);
}

function openZoomCardCentered(coupon) {
  const vpRect = el.viewport.getBoundingClientRect();
  const cardW = Math.min(vpRect.width * 0.82, 320);
  const cardH = cardW * 1.58;

  showZoomCard(coupon, {
    left: vpRect.left + (vpRect.width - cardW) / 2,
    top: vpRect.top + (vpRect.height - cardH) / 2,
    width: cardW,
    height: cardH
  }, true);
}

function showZoomCard(coupon, initRect, startFlipped) {
  const isBest = el.wallet.classList.contains('best-offer');
  const timeStr = formatCountdownShort(state.countdownSeconds);

  // Build DOM
  const overlay = document.createElement('div');
  overlay.className = 'zoom-overlay';
  overlay.id = 'zoom-overlay';

  const container = document.createElement('div');
  container.className = 'zoom-card-container';
  container.id = 'zoom-card-container';
  container.style.left = initRect.left + 'px';
  container.style.top = initRect.top + 'px';
  container.style.width = initRect.width + 'px';
  container.style.height = initRect.height + 'px';

  container.innerHTML = `
    <div class="zoom-card-inner" id="zoom-card-inner">
      <div class="zoom-card-front ${isBest ? 'best-offer-face' : ''}">
        <span class="front-kicker">From coupon</span>
        <span class="front-value">${coupon.num}<small>%</small></span>
        <span class="front-label">COUPON</span>
        <span class="front-subtitle">Sitewide \u00b7 No minimum</span>
      </div>
      <div class="zoom-card-back">
        <button class="zoom-back-close" id="zoom-close-btn" aria-label="Close">\u00d7</button>
        <div class="zoom-back-brand">Ritual</div>
        <div class="zoom-back-code-section">
          <div class="zoom-back-code-label">Coupon Code</div>
          <div class="zoom-back-code">${coupon.code}</div>
          <button class="zoom-back-copy-btn" id="zoom-copy-btn">\ud83d\udccb Copy</button>
        </div>
        <div class="zoom-back-divider"></div>
        <div class="zoom-back-conditions">
          <div class="zoom-back-conditions-title">\u4f7f\u7528\u6761\u4ef6 \u00b7 Usage Conditions</div>
          <ul class="zoom-back-check-list">
            <li>Valid sitewide \u2014 no minimum order</li>
            <li>One-time use per account</li>
            <li>Cannot combine with other offers</li>
            <li>Applied at checkout automatically</li>
          </ul>
        </div>
        <div class="zoom-back-expiry">
          <span class="zoom-back-expiry-label">\u6709\u6548\u671f \u00b7 Expires in</span>
          <span class="zoom-back-expiry-value" id="zoom-expiry-val">${timeStr}</span>
        </div>
        <button class="zoom-back-redeem-btn" id="zoom-redeem-btn">Redeem at Ritual \u2192</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(container);

  const inner = document.getElementById('zoom-card-inner');

  // Countdown timer update interval
  const expiryEl = document.getElementById('zoom-expiry-val');
  const expiryInterval = setInterval(() => {
    if (expiryEl) expiryEl.innerText = formatCountdownShort(state.countdownSeconds);
  }, 1000);

  function cleanupZoom() {
    clearInterval(expiryInterval);
    overlay.remove();
    container.remove();
    el.currentWrap.classList.remove('tearing');
    el.useNowBtn.disabled = false;
    const leftoverCanvas = el.currentWrap.querySelector('.tear-canvas');
    if (leftoverCanvas) leftoverCanvas.remove();
  }

  function closeZoom() {
    // Flip back
    inner.classList.remove('flipped');

    setTimeout(() => {
      // Zoom out to original card position
      container.classList.remove('zoomed');
      const faceEl = el.currentCoupon.querySelector('.coupon-face');
      if (faceEl) {
        const faceRect = faceEl.getBoundingClientRect();
        container.style.left = faceRect.left + 'px';
        container.style.top = faceRect.top + 'px';
        container.style.width = faceRect.width + 'px';
        container.style.height = faceRect.height + 'px';
      }
      overlay.classList.add('closing');

      setTimeout(() => {
        cleanupZoom();
      }, 550);
    }, 700);
  }

  if (startFlipped) {
    // Direct centered + flipped (from receipt "Use Now")
    container.classList.add('zoomed');
    inner.classList.add('flipped');
  } else {
    // Animate: init -> zoomed -> flipped
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const vpRect = el.viewport.getBoundingClientRect();
        const cardW = Math.min(vpRect.width * 0.82, 320);
        const cardH = cardW * 1.58;
        container.style.left = (vpRect.left + (vpRect.width - cardW) / 2) + 'px';
        container.style.top = (vpRect.top + (vpRect.height - cardH) / 2) + 'px';
        container.style.width = cardW + 'px';
        container.style.height = cardH + 'px';
        container.classList.add('zoomed');

        setTimeout(() => {
          inner.classList.add('flipped');
        }, 580);
      });
    });
  }

  // Event handlers
  overlay.addEventListener('click', closeZoom);
  document.getElementById('zoom-close-btn').addEventListener('click', closeZoom);

  document.getElementById('zoom-copy-btn').addEventListener('click', function() {
    const btn = this;
    navigator.clipboard.writeText(coupon.code).then(() => {
      btn.classList.add('copied');
      btn.innerHTML = '\u2713 Copied!';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '\ud83d\udccb Copy';
      }, 2000);
    }).catch(() => {
      showCustomAlert('Copy Failed', 'We couldn\u2019t copy it automatically. Please copy manually: ' + coupon.code, '\u26a0\ufe0f');
    });
  });

  document.getElementById('zoom-redeem-btn').addEventListener('click', () => {
    window.open('https://ritual.com', '_blank');
  });
}

function handleCopyCode() {
  const code = el.couponCodeText.innerText;
  navigator.clipboard.writeText(code).then(() => {
    el.copyCodeBtn.innerText = 'Copied!';
    el.copyCodeBtn.classList.add('copied');
    setTimeout(() => {
      el.copyCodeBtn.innerText = 'Copy';
      el.copyCodeBtn.classList.remove('copied');
    }, 2000);
  }).catch(() => {
    showCustomAlert('Copy Failed', 'We couldn\u2019t copy it automatically. Please copy manually: ' + code, '⚠️');
  });
}

// 8. Modals
function openModal(modal) { modal.classList.add('open'); }
function closeModal(modal) { modal.classList.remove('open'); }

// 9. Game 1: Tap Target
let gameActive = false;
let gameTaps = 0;
let gameTimerInterval;

function startMiniGame() {
  el.startGameBtn.style.display = 'none';
  el.gameTapTarget.classList.remove('disabled');
  gameActive = true;
  gameTaps = 0;
  el.gameScore.innerText = 'Taps: 0';

  let timeLeft = 5.0;
  el.gameTimer.innerText = timeLeft.toFixed(2);

  el.gameTapTarget.onclick = () => {
    if (!gameActive) return;
    gameTaps++;
    el.gameScore.innerText = 'Taps: ' + gameTaps;
    el.gameTapTarget.style.transform = 'scale(0.9)';
    setTimeout(() => { el.gameTapTarget.style.transform = 'scale(1)'; }, 50);
  };

  gameTimerInterval = setInterval(() => {
    timeLeft -= 0.05;
    if (timeLeft <= 0) {
      clearInterval(gameTimerInterval);
      endMiniGame();
    } else {
      el.gameTimer.innerText = timeLeft.toFixed(2);
    }
  }, 50);
}

function endMiniGame() {
  gameActive = false;
  el.gameTapTarget.classList.add('disabled');
  const pointsEarned = Math.min(Math.max(gameTaps, 10), 20);

  setTimeout(() => {
    closeModal(el.gameModal);
    el.startGameBtn.style.display = 'block';
    el.gameTapTarget.onclick = null;
    el.gameTimer.innerText = '05.00';
    el.gameScore.innerText = 'Taps: 0';

    showCustomAlert(
      'Challenge Completed!',
      `You tapped the target ${gameTaps} times and earned +${pointsEarned} pts.`,
      '🎮',
      () => addPoints(pointsEarned)
    );
  }, 600);
}

// 9b. Game 2: Memory Match
let memoryActive = false;
let memoryMatchedPairs = 0;
let firstFlippedCard = null;
let secondFlippedCard = null;
const cardIcons = ['🍋', '🍇', '🍋', '🍇'];

function startMemoryGame() {
  el.startMemoryBtn.style.display = 'none';
  memoryActive = true;
  memoryMatchedPairs = 0;
  firstFlippedCard = null;
  secondFlippedCard = null;

  const shuffled = [...cardIcons].sort(() => Math.random() - 0.5);
  el.memoryCards.forEach((card, idx) => {
    card.classList.remove('flipped', 'matched');
    card.querySelector('span').innerText = '❓';

    card.onclick = () => {
      if (!memoryActive || card.classList.contains('flipped') || card.classList.contains('matched')) return;
      card.classList.add('flipped');
      card.querySelector('span').innerText = shuffled[idx];

      if (!firstFlippedCard) {
        firstFlippedCard = { element: card, icon: shuffled[idx] };
      } else {
        secondFlippedCard = { element: card, icon: shuffled[idx] };
        memoryActive = false;

        setTimeout(() => {
          if (firstFlippedCard.icon === secondFlippedCard.icon) {
            firstFlippedCard.element.classList.add('matched');
            secondFlippedCard.element.classList.add('matched');
            memoryMatchedPairs++;

            if (memoryMatchedPairs === 2) {
              setTimeout(() => {
                closeModal(el.memoryModal);
                el.startMemoryBtn.style.display = 'block';
                showCustomAlert(
                  'Memory Match Completed!',
                  'Excellent memory! You matched all pairs and earned +15 pts.',
                  '🃏',
                  () => addPoints(15)
                );
              }, 600);
            } else {
              memoryActive = true;
            }
          } else {
            firstFlippedCard.element.classList.remove('flipped');
            firstFlippedCard.element.querySelector('span').innerText = '❓';
            secondFlippedCard.element.classList.remove('flipped');
            secondFlippedCard.element.querySelector('span').innerText = '❓';
            memoryActive = true;
          }
          firstFlippedCard = null;
          secondFlippedCard = null;
        }, 800);
      }
    };
  });
}

// 9c. Game 3: Lucky Spin
let spinActive = false;

function startSpinGame() {
  if (spinActive) return;
  spinActive = true;
  el.startSpinBtn.disabled = true;

  const baseRotations = 1440;
  const randomSector = Math.floor(Math.random() * 4);
  const targetAngle = baseRotations + randomSector * 90;
  el.wheelOuter.style.transform = `rotate(${targetAngle}deg)`;

  const sectorRewards = [
    { pts: 5, label: '+5 pts' },
    { pts: 10, label: '+10 pts' },
    { pts: 15, label: '+15 pts' },
    { pts: 8, label: '+8 pts' }
  ];
  const reward = sectorRewards[randomSector];

  setTimeout(() => {
    closeModal(el.spinModal);
    el.wheelOuter.style.transition = 'none';
    el.wheelOuter.style.transform = 'rotate(0deg)';
    void el.wheelOuter.offsetHeight;
    el.wheelOuter.style.transition = 'transform 3s cubic-bezier(0.25, 0.1, 0.25, 1)';
    el.startSpinBtn.disabled = false;
    spinActive = false;

    showCustomAlert(
      'Lucky Spin Winner!',
      `The wheel stopped on ${reward.label}. Points added to your locked coupon!`,
      '🎡',
      () => addPoints(reward.pts)
    );
  }, 3200);
}

// 10. Survey
let currentSurveyStep = 1;

function handleSurveyOptionClick() {
  if (currentSurveyStep < 3) {
    currentSurveyStep++;
    el.surveyStepProgress.style.width = (currentSurveyStep / 3) * 100 + '%';
    el.surveyQuestionSteps.forEach((step) => {
      step.classList.toggle('active', parseInt(step.dataset.step, 10) === currentSurveyStep);
    });
  } else {
    setTimeout(() => {
      closeModal(el.surveyModal);
      currentSurveyStep = 1;
      el.surveyStepProgress.style.width = '33%';
      el.surveyQuestionSteps.forEach((step) => {
        step.classList.toggle('active', step.dataset.step === '1');
      });
      showCustomAlert(
        'Survey Completed!',
        'Thanks for sharing your preferences. +10 pts added to your progress!',
        '📝',
        () => addPoints(10)
      );
    }, 400);
  }
}

// 11. Points, coins, unlock
function addPoints(pts) {
  if (state.currentStepIndex >= state.discounts.length - 1) return;
  const startPoints = state.points;
  state.points += pts;

  flyCoins(Math.min(6, Math.max(3, Math.round(pts / 3))), () => {
    animateProgressBar(startPoints, state.points);
  });
}

// Gold coins fly from the bottom of the screen into the locked coupon
function flyCoins(count, done) {
  const vpRect = el.viewport.getBoundingClientRect();
  const targetRect = el.targetCoupon.getBoundingClientRect();

  const startX = vpRect.width / 2;
  const startY = vpRect.height * 0.78;
  const endX = (targetRect.left - vpRect.left) + targetRect.width * 0.5;
  const endY = (targetRect.top - vpRect.top) + targetRect.height * 0.5;

  // Target off-screen? Skip the flight.
  if (targetRect.bottom < vpRect.top || targetRect.top > vpRect.bottom) {
    done();
    return;
  }

  let landed = 0;
  for (let i = 0; i < count; i++) {
    const coin = document.createElement('div');
    coin.className = 'fly-coin';
    coin.innerText = '¢';
    const jx = (Math.random() - 0.5) * 70;
    const jy = (Math.random() - 0.5) * 30;
    coin.style.left = (startX + jx - 11) + 'px';
    coin.style.top = (startY + jy - 11) + 'px';
    el.viewport.appendChild(coin);

    setTimeout(() => {
      void coin.offsetWidth;
      coin.style.transform = `translate(${endX - startX - jx}px, ${endY - startY - jy}px) scale(0.45)`;
      coin.style.opacity = '0.15';

      setTimeout(() => {
        coin.remove();
        el.targetWrap.classList.remove('absorb');
        void el.targetWrap.offsetWidth;
        el.targetWrap.classList.add('absorb');
        landed++;
        if (landed === count) {
          setTimeout(() => {
            el.targetWrap.classList.remove('absorb');
            done();
          }, 200);
        }
      }, 660);
    }, i * 90);
  }
}

function animateProgressBar(start, end) {
  let current = start;
  const steps = end - start;
  const stepTime = Math.max(Math.floor(600 / Math.max(steps, 1)), 15);

  const timer = setInterval(() => {
    if (current < end) {
      current++;
      renderProgress(current);
    } else {
      clearInterval(timer);
      checkUnlock();
    }
  }, stepTime);
}

function checkUnlock() {
  if (state.points >= state.targetPoints) {
    triggerCelebration();
  } else {
    updateUI();
  }
}

function triggerCelebration() {
  renderProgress(state.targetPoints);
  el.targetWrap.classList.add('ready', 'unlocking');
  el.targetTag.innerText = 'Unlocked!';
  startConfetti();

  const nextCoupon = state.discounts[state.currentStepIndex + 1];
  const targetPointsVal = state.targetPoints;

  // Show receipt immediately — confetti falls on top of the printer overlay
  showReceiptPrinterOverlay(nextCoupon, targetPointsVal);
}

// 12. Confetti
let canvas, ctx;
let confettiParticles = [];
let confettiAnimationId = null;

function initConfetti() {
  canvas = $('confetti-canvas');
  ctx = canvas.getContext('2d');
  resizeConfettiCanvas();
  window.addEventListener('resize', resizeConfettiCanvas);
}

function resizeConfettiCanvas() {
  if (canvas) {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  }
}

function startConfetti() {
  confettiParticles = [];
  const colors = ['#5c6e58', '#b89855', '#d4dec9', '#ffffff', '#e2dbce', '#ddc483'];

  for (let i = 0; i < 110; i++) {
    confettiParticles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      r: Math.random() * 6 + 4,
      d: Math.random() * canvas.height,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10 - 5,
      tiltAngleIncremental: Math.random() * 0.07 + 0.02,
      tiltAngle: 0
    });
  }

  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);
  drawConfetti();
}

function drawConfetti() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let active = 0;

  confettiParticles.forEach((p, idx) => {
    p.tiltAngle += p.tiltAngleIncremental;
    p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
    p.x += Math.sin(p.tiltAngle);
    p.tilt = Math.sin(p.tiltAngle - idx / 3) * 15;

    if (p.y <= canvas.height) {
      active++;
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
      ctx.stroke();
    }
  });

  if (active > 0) {
    confettiAnimationId = requestAnimationFrame(drawConfetti);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// 13. Notification helper
function showCustomAlert(title, message, icon = '✨', onConfirm = null) {
  el.notificationTitle.innerText = title;
  el.notificationMessage.innerText = message;
  el.notificationIcon.innerText = icon;

  const confirmHandler = () => {
    closeModal(el.notificationModal);
    if (onConfirm) onConfirm();
    el.notificationConfirmBtn.removeEventListener('click', confirmHandler);
    el.closeNotificationBtn.removeEventListener('click', confirmHandler);
  };

  el.notificationConfirmBtn.addEventListener('click', confirmHandler);
  el.closeNotificationBtn.addEventListener('click', confirmHandler);
  openModal(el.notificationModal);
}

window.addEventListener('DOMContentLoaded', init);

function showReceiptPrinterOverlay(nextCoupon, targetPointsVal) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(now.getDate());
  const month = pad(now.getMonth() + 1);
  const year = String(now.getFullYear()).slice(-2);
  let hours = now.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const formattedDate = `${day}/${month}/${year} ${hours}${ampm} (EST)`;

  const overlay = document.createElement('div');
  overlay.className = 'printer-overlay';
  overlay.id = 'printer-overlay';

  const barcodeWidths = [1, 3, 2, 1, 4, 1, 2, 3, 1, 2, 4, 1, 3, 1, 2, 4, 1, 2, 3, 1, 4, 1, 2, 3, 1, 2, 4, 1, 2, 1];
  let barcodeHtml = '';
  barcodeWidths.forEach(width => {
    barcodeHtml += `<div class="bar" style="width: ${width}px"></div>`;
  });

  overlay.innerHTML = `
    <div class="printer-machine">
      <div class="printer-slot"></div>
      <div class="receipt-paper-wrap">
        <div class="receipt-paper">
          <div class="receipt-header">
            <div class="receipt-logo">Ritual</div>
            <div class="receipt-title">VIP Reward Voucher</div>
          </div>
          
          <div class="receipt-divider"></div>
          
          <div class="receipt-meta">
            <div class="receipt-meta-row">
              <span>REDEEM CODE:</span>
              <span style="font-weight: bold">${nextCoupon.code}</span>
            </div>
            <div class="receipt-meta-row">
              <span>DATE/TIME:</span>
              <span>${formattedDate}</span>
            </div>
            <div class="receipt-meta-row">
              <span>VOUCHER ID:</span>
              <span>#8849-002</span>
            </div>
          </div>
          
          <div class="receipt-divider"></div>
          
          <div class="receipt-big-text">
            ${nextCoupon.num}% OFF
          </div>
          
          <div class="receipt-divider"></div>
          
          <div class="receipt-meta">
            <div class="receipt-item-row">
              <span>UNLOCKED DISCOUNT</span>
              <span>${nextCoupon.value}</span>
            </div>
            <div class="receipt-item-row">
              <span>VALIDITY</span>
              <span>Sitewide · No Min</span>
            </div>
          </div>
          
          <div class="receipt-divider"></div>
          
          <div style="text-align: center; font-size: 0.62rem; letter-spacing: 0.5px; color: #555">
            ########## ${day}/${month}/${year} ##########
          </div>
          
          <div class="receipt-barcode">
            ${barcodeHtml}
          </div>
        </div>
      </div>
    </div>
    
    <div class="printer-buttons">
      <button class="btn-printer-primary" id="btn-receipt-use">Use Now</button>
      <button class="btn-printer-secondary" id="btn-receipt-accumulate">Keep Accumulating Points</button>
    </div>
  `;

  el.viewport.appendChild(overlay);

  document.getElementById('btn-receipt-use').addEventListener('click', () => {
    const nextCoupon = state.discounts[state.currentStepIndex + 1];
    state.currentStepIndex++;
    state.points = Math.max(state.points - targetPointsVal, 0);
    el.targetWrap.classList.remove('ready', 'unlocking');
    overlay.remove();
    
    // Stop confetti when opening zoom card
    if (confettiAnimationId) {
      cancelAnimationFrame(confettiAnimationId);
      confettiAnimationId = null;
    }
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    updateUI();
    openZoomCardCentered(nextCoupon); // 3D zoom card instead of drawer
  });

  document.getElementById('btn-receipt-accumulate').addEventListener('click', () => {
    state.currentStepIndex++;
    state.points = Math.max(state.points - targetPointsVal, 0);
    el.targetWrap.classList.remove('ready', 'unlocking');
    overlay.remove();

    el.currentWrap.classList.remove('swap');
    el.targetWrap.classList.remove('swap');
    void el.currentWrap.offsetWidth;
    void el.targetWrap.offsetWidth;
    el.currentWrap.classList.add('swap');
    el.targetWrap.classList.add('swap');
    setTimeout(() => {
      el.currentWrap.classList.remove('swap');
      el.targetWrap.classList.remove('swap');
    }, 800);
    
    updateUI();
  });
}
