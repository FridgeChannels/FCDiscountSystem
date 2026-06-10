// FC Discount Progression System - State & Interaction Logic

// 1. App State
const state = {
  points: 72,
  targetPoints: 90,
  currentDiscount: '15% OFF',
  targetDiscount: '20% OFF',
  availableDiscounts: [
    { value: '15% OFF', target: 0, code: 'FC15RITUAL' },
    { value: '20% OFF', target: 90, code: 'FC20RITUAL' },
    { value: '25% OFF', target: 120, code: 'FC25RITUAL_BEST' }
  ],
  currentStepIndex: 0, // Points to 15% OFF being active
  countdownSeconds: 2 * 24 * 3600 + 4 * 3600 + 55 * 60, // 2d 4h 55m
  isTimerRunning: true,
  dailyCapReached: false,
  questMode: false,
  completedSteps: [],
};

// 2. DOM Elements
const elements = {
  // Header & Urgency Clock
  timerDays: document.getElementById('timer-days'),
  timerHours: document.getElementById('timer-hours'),
  timerMins: document.getElementById('timer-mins'),
  timerSecs: document.getElementById('timer-secs'),
  timerProgressBar: document.getElementById('timer-progress-bar'),
  
  // Banner
  tapRewardBanner: document.getElementById('tap-reward-banner'),
  closeAlertBtn: document.getElementById('close-alert-btn'),
  
  // Progression Card
  progressionCard: document.getElementById('progression-card'),
  targetStatus: document.getElementById('target-status'),
  targetValue: document.getElementById('target-value'),
  nodeTarget: document.getElementById('node-target'),
  targetTooltip: document.getElementById('target-tooltip'),
  progressRatioText: document.getElementById('progress-ratio-text'),
  progressBarFill: document.getElementById('progress-bar-fill'),
  progressHelper: document.getElementById('progress-helper'),
  pointsNeeded: document.getElementById('points-needed'),
  
  // Unlocked values
  currentDiscountValue: document.getElementById('current-discount-value'),
  useNowBtn: document.getElementById('use-now-btn'),
  
  // Tasks
  tasksSection: document.getElementById('tasks-section'),
  playGameBtn: document.getElementById('play-game-btn'),
  playMemoryBtn: document.getElementById('play-memory-btn'),
  playSpinBtn: document.getElementById('play-spin-btn'),
  takeSurveyBtn: document.getElementById('take-survey-btn'),
  
  // Rules Accordion
  rulesTrigger: document.getElementById('rules-trigger'),
  rulesContent: document.getElementById('rules-content'),
  
  // Coupon Drawer
  drawerOverlay: document.getElementById('drawer-overlay'),
  couponDrawer: document.getElementById('coupon-drawer'),
  closeDrawerBtn: document.getElementById('close-drawer-btn'),
  drawerCouponValue: document.getElementById('drawer-coupon-value'),
  couponCodeText: document.getElementById('coupon-code-text'),
  copyCodeBtn: document.getElementById('copy-code-btn'),
  shopNowBtn: document.getElementById('shop-now-btn'),
  drawerTimerText: document.getElementById('drawer-timer-text'),
  
  // Game Modal 1: Tap
  gameModal: document.getElementById('game-modal'),
  closeGameBtn: document.getElementById('close-game-btn'),
  startGameBtn: document.getElementById('start-game-btn'),
  gameTimer: document.getElementById('game-timer'),
  gameScore: document.getElementById('game-score'),
  gameTapTarget: document.getElementById('game-tap-target'),
  
  // Game Modal 2: Memory
  memoryModal: document.getElementById('memory-modal'),
  closeMemoryBtn: document.getElementById('close-memory-btn'),
  startMemoryBtn: document.getElementById('start-memory-btn'),
  memoryCards: document.querySelectorAll('.memory-card'),
  
  // Game Modal 3: Lucky Spin
  spinModal: document.getElementById('spin-modal'),
  closeSpinBtn: document.getElementById('close-spin-btn'),
  startSpinBtn: document.getElementById('start-spin-btn'),
  wheelOuter: document.getElementById('wheel-outer'),
  
  // Survey Modal
  surveyModal: document.getElementById('survey-modal'),
  closeSurveyBtn: document.getElementById('close-survey-btn'),
  surveyStepProgress: document.getElementById('survey-step-progress'),
  surveyQuestionSteps: document.querySelectorAll('.survey-question-step'),
  surveyOptionBtns: document.querySelectorAll('.survey-option-btn'),
    
  // Notification Modal
  notificationModal: document.getElementById('notification-modal'),
  notificationTitle: document.getElementById('notification-title'),
  notificationMessage: document.getElementById('notification-message'),
  notificationIcon: document.getElementById('notification-icon'),
  notificationConfirmBtn: document.getElementById('notification-confirm-btn'),
  closeNotificationBtn: document.getElementById('close-notification-btn'),
};

// 3. Initialize App
function init() {
  setupEventListeners();
  updateUI();
  startCountdown();
  initConfetti();
  
  // Trigger initial subtle bounce on the target card to draw attention
  setTimeout(() => {
    elements.progressionCard.classList.add('pulse-glow');
  }, 1000);
}

// 4. Update UI to match State
function updateUI() {
  const currentStep = state.availableDiscounts[state.currentStepIndex];
  const nextStep = state.availableDiscounts[state.currentStepIndex + 1];
  
  // Handle Best Offer State (Max discount reached)
  if (!nextStep) {
    // We are at 25% OFF (Best Offer)
    elements.tasksSection.style.display = 'none';
    
    // Rebuild progression card inner HTML
    elements.progressionCard.innerHTML = `
      <div class="best-offer-content text-center" style="display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; animation: slide-down 0.4s ease-out;">
        <span class="section-tag" style="color: var(--brand-secondary); font-weight: 700; letter-spacing: 1.5px; font-size: 0.75rem;">🔥 Best Offer Unlocked</span>
        <h3 class="banner-title" style="font-family: var(--font-serif); font-size: 3.6rem; font-weight: 700; color: var(--brand-primary); margin: 6px 0; line-height: 1;">25% OFF</h3>
        <p class="banner-subtitle" style="font-size: 0.8rem; color: var(--text-secondary);">You have unlocked our maximum discount! Copy your code and shop now.</p>
        <button class="btn btn-primary btn-block" id="use-now-btn" style="margin-top: 10px;">Use 25% OFF Now</button>
      </div>
    `;
    
    // Update drawer coupon values directly
    elements.drawerCouponValue.innerText = currentStep.value;
    elements.couponCodeText.innerText = currentStep.code;
    
    // Re-bind use now click listener
    document.getElementById('use-now-btn').addEventListener('click', openDrawer);
    return;
  }
  
  // Regular Progression State
  elements.currentDiscountValue.innerText = currentStep.value;
  elements.drawerCouponValue.innerText = currentStep.value;
  elements.couponCodeText.innerText = currentStep.code;
  
  elements.targetValue.innerText = nextStep.value;
  document.getElementById('target-highlight').innerText = nextStep.value;
  state.targetPoints = nextStep.target;
  
  // Points / Progress
  elements.progressRatioText.innerText = `${state.points} / ${state.targetPoints} Pts`;
  
  // Calculate fill percentage
  const percentage = Math.min((state.points / state.targetPoints) * 100, 100);
  elements.progressBarFill.style.width = `${percentage}%`;
  
  const delta = state.targetPoints - state.points;
  if (delta > 0) {
    elements.pointsNeeded.innerText = delta;
    elements.targetStatus.innerHTML = `🔒 Target`;
    if (elements.targetTooltip) {
      elements.targetTooltip.innerText = `Keep playing! ${delta} pts to unlock ${nextStep.value}`;
    }
  } else {
    // If it is fully filled (awaiting next tier trigger)
    elements.targetStatus.innerHTML = `Ready!`;
    if (elements.targetTooltip) {
      elements.targetTooltip.innerText = `Ready to Unlock!`;
    }
  }
  
  // Disable tasks if cap reached
  if (state.dailyCapReached) {
    elements.playGameBtn.disabled = true;
    elements.playGameBtn.innerText = 'Cap Reached';
    elements.takeSurveyBtn.disabled = true;
    elements.takeSurveyBtn.innerText = 'Cap Reached';
  }
}

// 5. Event Listeners
function setupEventListeners() {
  // Tap Banner Dismiss
  elements.closeAlertBtn.addEventListener('click', () => {
    elements.tapRewardBanner.style.opacity = '0';
    setTimeout(() => elements.tapRewardBanner.style.display = 'none', 300);
  });
  
  // Rules Accordion
  elements.rulesTrigger.addEventListener('click', () => {
    elements.rulesContent.classList.toggle('open');
    elements.rulesTrigger.querySelector('.accordion-icon').innerText = 
      elements.rulesContent.classList.contains('open') ? '−' : '+';
  });
  
  // Target node click to show tooltip on mobile
  if (elements.nodeTarget) {
    elements.nodeTarget.addEventListener('click', (e) => {
      e.stopPropagation();
      elements.nodeTarget.classList.toggle('show-tip');
      if (elements.nodeTarget.classList.contains('show-tip')) {
        setTimeout(() => {
          elements.nodeTarget.classList.remove('show-tip');
        }, 2500);
      }
    });
  }
  
  document.addEventListener('click', () => {
    if (elements.nodeTarget) {
      elements.nodeTarget.classList.remove('show-tip');
    }
  });
  
  // Coupon Drawer Open/Close
  elements.useNowBtn.addEventListener('click', openDrawer);
  elements.closeDrawerBtn.addEventListener('click', closeDrawer);
  elements.drawerOverlay.addEventListener('click', closeDrawer);
  
  // Copy Code
  elements.copyCodeBtn.addEventListener('click', handleCopyCode);
  
  // Shop Now (Simulate checkout redirect)
  elements.shopNowBtn.addEventListener('click', () => {
    elements.shopNowBtn.innerText = 'Going to Ritual...';
    elements.shopNowBtn.disabled = true;
    setTimeout(() => {
      showCustomAlert('Redirecting', 'We are opening Ritual shop with your discount coupon pre-applied at checkout!', '🛍️', () => {
        elements.shopNowBtn.innerText = 'Shop Now';
        elements.shopNowBtn.disabled = false;
        closeDrawer();
      });
    }, 1200);
  });
  
  // Game 1 Modal Hooks (Tap Speed)
  elements.playGameBtn.addEventListener('click', () => openModal(elements.gameModal));
  elements.closeGameBtn.addEventListener('click', () => closeModal(elements.gameModal));
  elements.startGameBtn.addEventListener('click', startMiniGame);
  
  // Game 2 Modal Hooks (Memory Card Match)
  elements.playMemoryBtn.addEventListener('click', () => openModal(elements.memoryModal));
  elements.closeMemoryBtn.addEventListener('click', () => closeModal(elements.memoryModal));
  elements.startMemoryBtn.addEventListener('click', startMemoryGame);
  
  // Game 3 Modal Hooks (Lucky Spin)
  elements.playSpinBtn.addEventListener('click', () => openModal(elements.spinModal));
  elements.closeSpinBtn.addEventListener('click', () => closeModal(elements.spinModal));
  elements.startSpinBtn.addEventListener('click', startSpinGame);
  
  // Survey Modal Hooks
  elements.takeSurveyBtn.addEventListener('click', () => openModal(elements.surveyModal));
  elements.closeSurveyBtn.addEventListener('click', () => closeModal(elements.surveyModal));
  
  // Setup Survey Options clicking
  elements.surveyOptionBtns.forEach(btn => {
    btn.addEventListener('click', handleSurveyOptionClick);
  });
}

// 6. Countdown Timer Logic
function startCountdown() {
  const formatNumber = (num) => String(num).padStart(2, '0');
  const initialTotalSeconds = 2 * 24 * 3600 + 4 * 3600 + 55 * 60; // 2d 4h 55m
  
  const updateTimer = () => {
    if (state.countdownSeconds <= 0) {
      state.isTimerRunning = false;
      elements.timerDays.innerText = '00';
      elements.timerHours.innerText = '00';
      elements.timerMins.innerText = '00';
      elements.timerSecs.innerText = '00';
      
      if (elements.timerProgressBar) {
        elements.timerProgressBar.style.width = '0%';
      }
      
      elements.useNowBtn.disabled = true;
      elements.useNowBtn.innerText = 'Expired';
      return;
    }
    
    state.countdownSeconds--;
    
    const d = Math.floor(state.countdownSeconds / (24 * 3600));
    const h = Math.floor((state.countdownSeconds % (24 * 3600)) / 3600);
    const m = Math.floor((state.countdownSeconds % 3600) / 60);
    const s = state.countdownSeconds % 60;
    
    elements.timerDays.innerText = formatNumber(d);
    elements.timerHours.innerText = formatNumber(h);
    elements.timerMins.innerText = formatNumber(m);
    elements.timerSecs.innerText = formatNumber(s);
    
    elements.drawerTimerText.innerText = `${d}d ${h}h ${m}m left`;
    
    // Scale the urgency progress bar line
    if (elements.timerProgressBar) {
      const pct = Math.max(0, (state.countdownSeconds / initialTotalSeconds) * 100);
      elements.timerProgressBar.style.width = `${pct}%`;
    }
    
    // Highlight if under 24 hours
    if (state.countdownSeconds < 24 * 3600) {
      document.getElementById('urgency-timer-banner').style.borderColor = '#f5c2c2';
      document.getElementById('urgency-timer-banner').style.background = 'linear-gradient(180deg, var(--card-bg) 0%, #fcebeb 100%)';
    }
  };
  
  updateTimer();
  const interval = setInterval(() => {
    if (state.isTimerRunning) updateTimer();
    else clearInterval(interval);
  }, 1000);
}

// 7. Drawer controls
function openDrawer() {
  elements.drawerOverlay.classList.add('open');
  elements.couponDrawer.classList.add('open');
}

function closeDrawer() {
  elements.drawerOverlay.classList.remove('open');
  elements.couponDrawer.classList.remove('open');
}

function handleCopyCode() {
  const code = elements.couponCodeText.innerText;
  navigator.clipboard.writeText(code).then(() => {
    elements.copyCodeBtn.innerText = 'Copied!';
    elements.copyCodeBtn.classList.add('copied');
    
    setTimeout(() => {
      elements.copyCodeBtn.innerText = 'Copy';
      elements.copyCodeBtn.classList.remove('copied');
    }, 2000);
  }).catch(err => {
    showCustomAlert('Copy Failed', `We couldn't copy it automatically. Please highlight and copy manually: ${code}`, '⚠️');
  });
}

// 8. Modal controls
function openModal(modal) {
  modal.classList.add('open');
}

function closeModal(modal) {
  modal.classList.remove('open');
}

// 9. Interactive Mini-Game Simulator
let gameActive = false;
let gameTaps = 0;
let gameTimerInterval;

function startMiniGame() {
  elements.startGameBtn.style.display = 'none';
  elements.gameTapTarget.classList.remove('disabled');
  
  gameActive = true;
  gameTaps = 0;
  elements.gameScore.innerText = `Taps: ${gameTaps}`;
  
  let timeLeft = 5.00;
  elements.gameTimer.innerText = timeLeft.toFixed(2);
  
  elements.gameTapTarget.onclick = () => {
    if (gameActive) {
      gameTaps++;
      elements.gameScore.innerText = `Taps: ${gameTaps}`;
      // Physical scale animation bounce
      elements.gameTapTarget.style.transform = 'scale(0.9)';
      setTimeout(() => elements.gameTapTarget.style.transform = 'scale(1)', 50);
    }
  };
  
  gameTimerInterval = setInterval(() => {
    timeLeft -= 0.05;
    if (timeLeft <= 0) {
      clearInterval(gameTimerInterval);
      endMiniGame();
    } else {
      elements.gameTimer.innerText = timeLeft.toFixed(2);
    }
  }, 50);
}

function endMiniGame() {
  gameActive = false;
  elements.gameTapTarget.classList.add('disabled');
  
  // Award points based on taps (min 10, max 20)
  const pointsEarned = Math.min(Math.max(gameTaps, 10), 20);
  
  setTimeout(() => {
    closeModal(elements.gameModal);
    
    // Reset modal button
    elements.startGameBtn.style.display = 'block';
    elements.gameTapTarget.onclick = null;
    elements.gameTimer.innerText = "05.00";
    elements.gameScore.innerText = "Taps: 0";
    
    showCustomAlert(
      'Challenge Completed!', 
      `Awesome job! You tapped the target ${gameTaps} times and earned +${pointsEarned} points.`, 
      '🎮', 
      () => {
        // Add points & trigger UI progress animation after modal closes
        addPoints(pointsEarned);
      }
    );
  }, 600);
}

// 9b. Interactive Game 2 Simulator: Memory Match
let memoryActive = false;
let memoryMatchedPairs = 0;
let firstFlippedCard = null;
let secondFlippedCard = null;
const cardIcons = ['🍋', '🍇', '🍋', '🍇']; // Simple 2 pairs

function startMemoryGame() {
  elements.startMemoryBtn.style.display = 'none';
  memoryActive = true;
  memoryMatchedPairs = 0;
  firstFlippedCard = null;
  secondFlippedCard = null;
  
  // Reset and shuffle card classes & contents
  const shuffledIcons = [...cardIcons].sort(() => Math.random() - 0.5);
  elements.memoryCards.forEach((card, idx) => {
    card.classList.remove('flipped', 'matched');
    card.querySelector('span').innerText = '❓';
    
    // Bind click handler
    card.onclick = () => {
      if (!memoryActive || card.classList.contains('flipped') || card.classList.contains('matched')) return;
      
      // Flip card
      card.classList.add('flipped');
      card.querySelector('span').innerText = shuffledIcons[idx];
      
      if (!firstFlippedCard) {
        firstFlippedCard = { element: card, icon: shuffledIcons[idx] };
      } else {
        secondFlippedCard = { element: card, icon: shuffledIcons[idx] };
        memoryActive = false; // Pause actions during check
        
        // Check match
        setTimeout(() => {
          if (firstFlippedCard.icon === secondFlippedCard.icon) {
            firstFlippedCard.element.classList.add('matched');
            secondFlippedCard.element.classList.add('matched');
            memoryMatchedPairs++;
            
            if (memoryMatchedPairs === 2) {
              // All pairs matched! Win game.
              setTimeout(() => {
                closeModal(elements.memoryModal);
                elements.startMemoryBtn.style.display = 'block';
                
                showCustomAlert(
                  'Memory Match Completed!',
                  'Excellent memory! You matched all card pairs and earned +15 points.',
                  '🃏',
                  () => {
                    addPoints(15);
                  }
                );
              }, 600);
            } else {
              memoryActive = true; // Resume play
            }
          } else {
            // Mis-match flip back
            firstFlippedCard.element.classList.remove('flipped');
            firstFlippedCard.element.querySelector('span').innerText = '❓';
            secondFlippedCard.element.classList.remove('flipped');
            secondFlippedCard.element.querySelector('span').innerText = '❓';
            memoryActive = true; // Resume play
          }
          firstFlippedCard = null;
          secondFlippedCard = null;
        }, 800);
      }
    };
  });
}

// 9c. Interactive Game 3 Simulator: Lucky Spin
let spinActive = false;

function startSpinGame() {
  if (spinActive) return;
  spinActive = true;
  elements.startSpinBtn.disabled = true;
  
  // Choose random degrees (minimum 4 full rotations + 0 to 360 deg)
  const baseRotations = 1440;
  const randomSector = Math.floor(Math.random() * 4); // 4 sectors: 0, 1, 2, 3
  const targetAngle = baseRotations + randomSector * 90;
  
  elements.wheelOuter.style.transform = `rotate(${targetAngle}deg)`;
  
  // Define point outputs based on sector
  const sectorRewards = [
    { pts: 5, label: '+5 Pts' },
    { pts: 10, label: '+10 Pts' },
    { pts: 15, label: '+15 Pts' },
    { pts: 8, label: '+8 Pts' }
  ];
  
  const reward = sectorRewards[randomSector];
  
  setTimeout(() => {
    closeModal(elements.spinModal);
    
    // Reset wheel position stylesheet without transitions
    elements.wheelOuter.style.transition = 'none';
    elements.wheelOuter.style.transform = 'rotate(0deg)';
    // Trigger reflow
    elements.wheelOuter.offsetHeight;
    // Re-enable transition for next spins
    elements.wheelOuter.style.transition = 'transform 3s cubic-bezier(0.25, 0.1, 0.25, 1)';
    
    elements.startSpinBtn.disabled = false;
    spinActive = false;
    
    showCustomAlert(
      'Lucky Spin Winner!',
      `Nice spin! The wheel stopped on sector ${reward.label}. We have added the points to your progress!`,
      '🎡',
      () => {
        addPoints(reward.pts);
      }
    );
  }, 3200); // Allow wheel spin transition (3s) to end
}

// 10. Interactive Survey Simulator
let currentSurveyStep = 1;

function handleSurveyOptionClick(event) {
  console.log(`Survey option clicked. Current step before click: ${currentSurveyStep}`);
  // Move to next step or complete
  if (currentSurveyStep < 3) {
    currentSurveyStep++;
    elements.surveyStepProgress.style.width = `${(currentSurveyStep / 3) * 100}%`;
    console.log(`Advancing to step: ${currentSurveyStep}`);
    
    // Hide all steps, show next step
    elements.surveyQuestionSteps.forEach(step => {
      step.classList.remove('active');
      if (parseInt(step.dataset.step) === currentSurveyStep) {
        step.classList.add('active');
      }
    });
  } else {
    console.log('Survey completed! Triggering modal...');
    // Completed!
    setTimeout(() => {
      closeModal(elements.surveyModal);
      
      // Reset survey state
      currentSurveyStep = 1;
      elements.surveyStepProgress.style.width = '33%';
      elements.surveyQuestionSteps.forEach(step => {
        step.classList.remove('active');
        if (parseInt(step.dataset.step) === 1) {
          step.classList.add('active');
        }
      });
      
      console.log('Opening survey completed alert...');
      showCustomAlert(
        'Survey Completed!',
        'Thank you for sharing your preferences with us. We have added +10 points to your progress!',
        '📝',
        () => {
          addPoints(10);
        }
      );
    }, 400);
  }
}

// 11. Point Accumulation and Unlocking Transitions
function addPoints(pts) {
  // Check if we already hit best offer
  if (state.currentStepIndex >= state.availableDiscounts.length - 1) return;
  
  const startPoints = state.points;
  state.points += pts;
  
  // Animating the progress bar transition
  animateProgressBar(startPoints, state.points);
}

function animateProgressBar(start, end) {
  let current = start;
  const target = state.targetPoints;
  
  // Total animation time 600ms, calculated step time (at least 15ms per step)
  const steps = end - start;
  const stepTime = Math.max(Math.floor(600 / steps), 15);
  
  const timer = setInterval(() => {
    if (current < end) {
      current++;
      const percentage = Math.min((current / target) * 100, 100);
      elements.progressBarFill.style.width = `${percentage}%`;
      elements.progressRatioText.innerText = `${current} / ${target} Pts`;
      
      const delta = target - current;
      if (delta > 0) {
        elements.pointsNeeded.innerText = delta;
      } else {
        elements.pointsNeeded.innerText = 0;
      }
    } else {
      clearInterval(timer);
      checkUnlock();
    }
  }, stepTime);
}

function checkUnlock() {
  console.log(`checkUnlock called. state.points: ${state.points}, state.targetPoints: ${state.targetPoints}`);
  if (state.points >= state.targetPoints) {
    console.log('Points threshold met. Triggering celebration...');
    // Trigger unlock sequence!
    triggerCelebration();
  } else {
    console.log('Points threshold not met. Updating regular UI.');
    updateUI();
  }
}

function triggerCelebration() {
  console.log('triggerCelebration executing...');
  // Start Confetti Particles
  startConfetti();
  
  // Highlight target card
  elements.progressionCard.classList.add('pulse-glow');
  elements.targetStatus.innerText = 'UNLOCKED!';
  elements.targetStatus.classList.add('unlocked');
  
  const newlyUnlocked = state.availableDiscounts[state.currentStepIndex + 1].value;
  console.log(`Newly unlocked discount tier determined: ${newlyUnlocked}`);
  
  setTimeout(() => {
    console.log('triggerCelebration setTimeout callback running...');
    // Remove glow class
    elements.progressionCard.classList.remove('pulse-glow');
    
    showCustomAlert(
      'Discount Upgraded!',
      `✨ Congratulations! You have successfully unlocked the ${newlyUnlocked} discount! You can redeem it now or keep playing.`,
      '🎉',
      () => {
        console.log('Custom alert closed. Updating state index...');
        // Advance state index
        state.currentStepIndex++;
        
        // Re-adjust points remaining
        // If they got extra points, they carry over to the next tier
        state.points = Math.max(state.points - state.targetPoints, 0);
        console.log(`New state.points after carryover: ${state.points}`);
        
        // Re-render
        updateUI();
      }
    );
  }, 1000);
}

// 12. Lightweight Canvas Confetti Engine
let canvas, ctx;
let confettiParticles = [];
let confettiAnimationId = null;

function initConfetti() {
  canvas = document.getElementById('confetti-canvas');
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
  const colors = ['#5c6e58', '#b89855', '#d4dec9', '#ffffff', '#e2dbce'];
  
  for (let i = 0; i < 100; i++) {
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
  
  if (confettiAnimationId) {
    cancelAnimationFrame(confettiAnimationId);
  }
  drawConfetti();
}

function drawConfetti() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let activeParticles = 0;
  
  confettiParticles.forEach((p, idx) => {
    p.tiltAngle += p.tiltAngleIncremental;
    p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
    p.x += Math.sin(p.tiltAngle);
    p.tilt = Math.sin(p.tiltAngle - idx/3) * 15;
    
    if (p.y <= canvas.height) {
      activeParticles++;
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
      ctx.stroke();
    }
  });
  
  if (activeParticles > 0) {
    confettiAnimationId = requestAnimationFrame(drawConfetti);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// 13. Unified Custom Alert Helper
function showCustomAlert(title, message, icon = '✨', onConfirm = null) {
  console.log(`showCustomAlert called: ${title} - ${message}`);
  elements.notificationTitle.innerText = title;
  elements.notificationMessage.innerText = message;
  elements.notificationIcon.innerText = icon;
  
  const confirmHandler = () => {
    console.log(`Custom alert confirmed: ${title}`);
    closeModal(elements.notificationModal);
    if (onConfirm) onConfirm();
    // Remove event listeners to avoid memory leaks/stacking
    elements.notificationConfirmBtn.removeEventListener('click', confirmHandler);
    elements.closeNotificationBtn.removeEventListener('click', confirmHandler);
  };
  
  elements.notificationConfirmBtn.addEventListener('click', confirmHandler);
  elements.closeNotificationBtn.addEventListener('click', confirmHandler);
  
  openModal(elements.notificationModal);
}

// Run Initializer
window.addEventListener('DOMContentLoaded', init);
