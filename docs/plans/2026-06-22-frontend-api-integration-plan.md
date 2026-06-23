# Frontend API Integration Plan For Gift-Pack Flow

**Goal:** Keep the latest frontend page design and interaction surfaces as-is, but replace the remaining mock/local gift issuance logic with real backend-driven coupon issuance for the new business model: one initial coupon code up front, one target gift pack for the remaining coupons, and wallet-based coupon management.

**Scope:** `FCDiscountSystem` frontend only, plus the backend contract required for `FCDiscountSystem` to consume real coupon data correctly.

**Out of scope:** redesigning the current UI, bringing back the old receipt/scratch/zoom flow, or changing the new page set (`Gift`, `Welcome`, `Home`, `Gift Unlock`, `Completed`, `My coupons`).

---

## 1. Current frontend baseline

The latest frontend has already moved to the pack-and-wallet UI model:

- `Welcome` renders a start pack on a full-page reward surface.
- `Home` renders a single target progress card plus challenge list.
- `Gift Unlock` (`GiftRevealModal`) shows the unlocked pack contents.
- `My coupons` renders all issued coupons grouped by status.
- `Completed` is the post-unlock wallet/completion state.

Relevant code today:

- `src/api/mapPlan.js`
  - `buildPacksFromDiscounts()` derives `startPack` and `targetPack` from `plan.ladder`.
- `src/App.jsx`
  - `currentPack`, `targetPack`, `giftReveal`, `couponWallet`, `CouponWalletPage`, `GiftRevealModal`, `WelcomeRitual`.

The remaining mismatch is that issuance still partially relies on frontend-local wallet writes and single-coupon API assumptions.

---

## 2. Target business model to support

The implementation should match this model:

1. Query all coupons available to the current `magnet`.
2. Pick one coupon as the initial reward.
3. Issue that initial coupon code directly to the user.
4. Put all remaining coupons into one target gift pack.
5. Let the user unlock that pack after reaching the single target threshold.
6. After unlock, issue all remaining coupon codes and save them into `My coupons`.

There is only one unlock stage for the remaining coupons. There is no multi-tier upgrade journey anymore.

---

## 3. Main gaps in the current code

### Gap A: Start pack shape does not match the new model

Today `buildPacksFromDiscounts()` treats **all** `pointsThreshold === 0` coupons as the start pack.

That does not match the new requirement of:

- exactly one initial coupon
- all other coupons go into the single target gift

### Gap B: Welcome still issues locally

In `src/App.jsx`, `handleContinueWelcomePack()` currently writes pack coupons into local wallet state via `claimMockPack()` instead of requiring a real backend-issued code path.

### Gap C: Target pack issuance still assumes one backend coupon

`issueTargetPack()` currently still calls the single-coupon flow once, then fills the rest from already-present codes if available.

That means the frontend is not yet truly integrated for:

- one call returning multiple coupon codes, or
- multiple real coupon issuance calls for the remaining pack coupons

### Gap D: Old single-coupon state is still partially alive

Legacy state remains in `src/App.jsx`, including:

- `claimedCode`
- `claimRecord`
- `showBestOffer`
- `showReceipt`
- `zoomActive`
- legacy single-coupon helpers and transitions

Those states are now mostly disconnected from the visible UI and should be reduced or isolated so the pack flow becomes the single source of truth.

---

## 4. Recommended backend contract

The cleanest implementation is to let backend become the source of truth for:

- which coupon is chosen as the initial coupon
- which coupons remain in the target pack
- which coupon codes are already issued

### 4.1 Reward plan response

Recommended plan shape addition:

```json
{
  "rewardPlanId": "cycle_xxx",
  "magnetId": 5001,
  "pointsBalance": 45,
  "cycleExpiresAt": "2026-06-29T12:00:00.000Z",
  "customerBrand": {},
  "tasks": [],
  "initialReward": {
    "couponId": "coupon_a",
    "discountValue": "15",
    "label": "15% OFF",
    "conditions": "Sitewide · No minimum",
    "couponCode": "WELCOME15",
    "issued": true
  },
  "targetRewardPack": {
    "threshold": 120,
    "coupons": [
      {
        "couponId": "coupon_b",
        "discountValue": "20",
        "label": "20% OFF",
        "conditions": "Sitewide · No minimum",
        "couponCode": null,
        "issued": false
      }
    ],
    "issued": false
  }
}
```

### 4.2 Required behaviors

- `initialReward` should already represent the one chosen initial coupon.
- `initialReward.couponCode` should be present once the user is allowed to see it.
- `targetRewardPack.coupons` should include all remaining coupons.
- `targetRewardPack.threshold` should be the single unlock threshold.
- `issued` fields should reflect server truth, not frontend guesswork.

### 4.3 Fallback option if backend cannot change plan shape yet

If backend must keep the existing ladder structure temporarily:

- frontend can still derive start/target packs from ladder
- but backend must also provide enough metadata to identify:
  - which coupon is the chosen initial coupon
  - which remaining coupons belong to the target pack
  - which coupons already have codes issued

Minimum extra fields in this fallback model:

- `initialCouponId`
- `initialCouponCode`
- `remainingCouponIds`
- `remainingIssuedCoupons[]`

This fallback is workable, but less clean than returning explicit `initialReward` and `targetRewardPack`.

---

## 5. Recommended issuance APIs

### Option A: Preferred

Two explicit issuance endpoints:

#### `POST /api/fc/rewards/claim-initial`

Purpose:

- issue the initial coupon if not yet issued
- return the initial coupon with code

Request:

```json
{
  "touchId": "xxx",
  "rewardPlanId": "cycle_xxx"
}
```

Response:

```json
{
  "coupon": {
    "couponId": "coupon_a",
    "discountValue": "15",
    "label": "15% OFF",
    "conditions": "Sitewide · No minimum",
    "couponCode": "WELCOME15",
    "expiresAt": "2026-06-29T12:00:00.000Z"
  }
}
```

#### `POST /api/fc/rewards/claim-target-pack`

Purpose:

- issue all remaining coupons once threshold is reached
- return all newly available target coupons

Request:

```json
{
  "touchId": "xxx",
  "rewardPlanId": "cycle_xxx"
}
```

Response:

```json
{
  "pack": {
    "threshold": 120,
    "coupons": [
      {
        "couponId": "coupon_b",
        "discountValue": "20",
        "label": "20% OFF",
        "conditions": "Sitewide · No minimum",
        "couponCode": "TARGET20",
        "expiresAt": "2026-06-29T12:00:00.000Z"
      }
    ]
  }
}
```

This is the best fit for the current UI.

### Option B: Transitional

Keep single-coupon redeem and let frontend call it several times.

This is less ideal because:

- it increases request count
- it complicates retries and partial failure handling
- it makes target pack issuance non-atomic

Only use this if backend cannot ship pack issuance quickly.

---

## 6. Frontend implementation plan

### Task 1: Normalize backend reward model

**Files:**

- `src/api/mapPlan.js`
- possibly `src/api/client.js`

**Changes:**

1. Add a new mapper that prefers backend-provided `initialReward` and `targetRewardPack`.
2. Keep `buildPacksFromDiscounts()` only as a fallback path.
3. Ensure the initial reward resolves to exactly one coupon.
4. Ensure the target pack contains all remaining coupons.
5. Carry through `couponCode`, `couponId`, `conditions`, `expiresAt`, and `issued`.

**Result:**

- `currentPack` becomes "one initial coupon"
- `targetPack` becomes "remaining coupons"

### Task 2: Replace local Welcome issuance with real API issuance

**Files:**

- `src/App.jsx`
- `src/api/client.js`
- `src/api/cache.js`

**Changes:**

1. Replace `claimMockPack(currentPack, { reveal: false })` in `handleContinueWelcomePack()`.
2. New behavior:
   - if backend plan already contains issued `initialReward.couponCode`, just persist it to wallet
   - otherwise call `claimInitialReward()`
3. After success:
   - upsert the issued coupon into `couponWallet`
   - mark Welcome complete
   - keep current `Welcome` page visuals unchanged

**Important rule:**

- the user should not leave `Welcome` without a real initial coupon code available in wallet, except in dev mock scenes

### Task 3: Replace target pack mock issuance with real pack issuance

**Files:**

- `src/App.jsx`
- `src/api/client.js`
- `src/api/cache.js`

**Changes:**

1. Replace current `issueTargetPack()` logic.
2. New behavior:
   - if target pack already issued according to plan, sync it into wallet
   - otherwise call `claimTargetRewardPack()`
3. The API response should return all target coupons with codes.
4. Upsert all returned coupons into wallet atomically.
5. Open `GiftRevealModal` using those real issued coupons.

**Important rule:**

- `GiftRevealModal` must show the exact codes returned by backend

### Task 4: Make wallet the primary source of issued state

**Files:**

- `src/App.jsx`
- `src/api/cache.js`

**Changes:**

1. Reduce dependency on old single-coupon `claimRecord`.
2. Drive:
   - `currentPackClaimed`
   - `targetClaimed`
   - `completedMode`
   from wallet entries plus backend-issued flags.
3. Keep backward-compatible support only if needed during transition.

**Result:**

- one reward model
- one wallet source of truth
- fewer conflicts with old states

### Task 5: Remove or isolate obsolete single-coupon flow

**Files:**

- `src/App.jsx`

**Changes:**

1. Remove or gate legacy states no longer used by the new UI:
   - `showBestOffer`
   - `showReceipt`
   - `zoomActive`
   - related handlers that no longer render anything
2. Keep game settlement and points animation logic that still contributes to the current experience.

**Result:**

- less confusion
- fewer dead transitions
- easier maintenance

### Task 6: Preserve dev scenes and fallback behavior

**Files:**

- `src/dev/scenes.js`
- `src/dev/couponPacks.js`
- `src/dev/fixtures.js`

**Changes:**

1. Update dev fixtures to reflect:
   - one initial coupon
   - one target pack with the remaining coupons
2. Keep frontend-only mock issuance only in dev scenes.
3. Make `welcome`, `unlocked`, and `completed` scenes mirror the real API-backed flow.

---

## 7. Data mapping rules

These rules should be fixed and documented in code comments/tests.

### Initial reward

- exactly one coupon
- shown on `Welcome`
- code visible before entering `Home`
- written to wallet as source `start`

### Target reward pack

- contains every coupon except the initial reward
- unlock threshold is a single number
- after unlock, all coupons are written to wallet as source `target`

### Wallet

Each wallet entry should include:

- `code`
- `couponId`
- `packId`
- `source`
- `num`
- `value`
- `conditions`
- `expiresAt`
- `status`
- `addedAt`

Deduplication should key by coupon code first, then fall back to `(packId, couponId)` if needed during transition.

---

## 8. Error handling requirements

### Welcome claim failure

- keep user on `Welcome`
- show a blocking error notification
- do not mark welcome complete
- do not write fake wallet data

### Target pack claim failure

- keep user on `Home`
- do not mark pack claimed
- do not open `GiftRevealModal`
- show retry-safe error notification

### Partial backend issuance failure

If backend uses multi-coupon issuance:

- endpoint should be atomic if possible
- frontend should reject partial success responses unless they are explicitly modeled

### Plan refresh race

After any claim:

- refresh plan in background
- preserve wallet entries already returned by claim endpoints
- do not temporarily regress UI to "unclaimed" if the refresh is slower than wallet update

---

## 9. Detailed test checklist

### A. Welcome flow

- [ ] First visit shows `Gift` intro, then `Welcome`.
- [ ] `Welcome` keeps the latest featured ticket design.
- [ ] `Welcome` shows exactly one initial coupon.
- [ ] The initial coupon already has a real code when visible to the user.
- [ ] Clicking continue saves the initial coupon into `My coupons`.
- [ ] Reload after Welcome does not lose the initial coupon.
- [ ] If initial coupon was already issued, Welcome does not create duplicates.

### B. Home flow

- [ ] `Home` keeps the latest redesigned layout.
- [ ] `TargetProgress` shows one target threshold only.
- [ ] Target gift preview excludes the initial coupon.
- [ ] Challenge completion updates points correctly.
- [ ] Reaching threshold does not route user into old receipt/scratch/best-offer flows.

### C. Gift unlock flow

- [ ] When threshold is reached, target pack issuance uses real backend data.
- [ ] `GiftRevealModal` opens with all newly issued remaining coupons.
- [ ] All shown codes match backend response.
- [ ] `GiftRevealModal` copy button works for every coupon.
- [ ] `View my coupons` opens wallet correctly.
- [ ] Closing the modal without opening wallet still keeps all issued coupons.

### D. My coupons

- [ ] Wallet lists the initial coupon plus all unlocked target coupons.
- [ ] No duplicates after refresh, revisit, or repeated API sync.
- [ ] Available / Used / Expired grouping still works.
- [ ] `Completed` mode shows full-reward messaging with the latest design.
- [ ] Wallet survives page reload and revisit.

### E. Idempotency and revisit behavior

- [ ] Revisiting after initial claim shows the coupon still present.
- [ ] Revisiting after target pack unlock does not re-issue coupons.
- [ ] Repeated clicks during network delay do not create duplicates.
- [ ] Refreshing mid-flow does not corrupt wallet state.

### F. Failure and retry

- [ ] Initial claim API failure keeps user on Welcome and shows error.
- [ ] Target pack claim API failure keeps user on Home and shows error.
- [ ] Transient plan refresh failure does not erase already issued wallet coupons.

### G. Dev and fallback

- [ ] `?scene=welcome` reflects one initial coupon.
- [ ] `?scene=unlocked` reflects target pack only.
- [ ] `?scene=completed` reflects full wallet state.
- [ ] Dev fallback still works without backend.

### H. Technical verification

- [ ] `npm run build` passes.
- [ ] No new lint errors in touched files.
- [ ] No console errors in key flows.
- [ ] Responsive layout still works on target viewport.

---

## 10. Success criteria

This task is successful only if all of the following are true:

### Business correctness

1. The user receives exactly one initial coupon as the Welcome reward.
2. The target gift contains every remaining coupon and only those coupons.
3. Unlocking the target gift issues all remaining coupon codes.
4. No old multi-tier upgrade behavior is exposed in the visible user flow.

### UI consistency

5. The latest frontend page visuals remain intact for:
   - `Gift`
   - `Welcome`
   - `Home`
   - `Gift Unlock`
   - `Completed`
   - `My coupons`
6. The old receipt/scratch/zoom/best-offer pages are not part of the live path.

### Data integrity

7. Wallet entries match backend-issued coupon codes exactly.
8. Revisit, refresh, and retry do not duplicate coupons.
9. Already issued coupons stay visible even if plan refresh arrives later.

### Operational readiness

10. There is a documented backend contract for:
    - initial coupon selection
    - initial coupon issuance
    - target pack issuance
    - issued coupon replay on revisit
11. The frontend has a deterministic fallback for dev scenes.
12. The full manual test checklist passes.

---

## 11. Recommended implementation order

1. Finalize backend response shape for `initialReward` and `targetRewardPack`.
2. Add new frontend client methods for initial claim and target-pack claim.
3. Update `mapPlanToViewModel()` to prefer backend pack data.
4. Replace Welcome local issuance with real issuance.
5. Replace target unlock local issuance with real pack issuance.
6. Make wallet the main claimed-state source.
7. Remove or isolate obsolete single-coupon states.
8. Update dev scenes and run full verification.

---

## 12. Notes for execution

- Preserve current page design and copy direction unless product asks for copy changes.
- Avoid reintroducing the old upgrade/receipt/scratch journey.
- Prefer explicit backend pack APIs over stretching the old single-coupon redeem API.
- Keep mock/dev behavior separated from production claim paths.
