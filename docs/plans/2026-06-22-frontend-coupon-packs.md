# Frontend Coupon Packs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a fully functional frontend-only flow for claiming a multi-coupon start gift and a multi-coupon target gift, then managing every issued coupon in My Coupons.

**Architecture:** Keep the existing reward plan and backend adapters intact, but introduce deterministic development gift-pack data as a frontend fallback. Treat start and target rewards as pack objects, issue all mock coupon codes atomically into the local wallet, and render the same coupon summaries across Welcome, target progress, claim results, and My Coupons.

**Tech Stack:** React 19, Vite, localStorage, existing CSS design system.

---

### Task 1: Add frontend pack fixtures and helpers

**Files:**
- Create: `src/dev/couponPacks.js`
- Modify: `src/api/cache.js`

1. Define current and target pack fixtures with stable IDs, thresholds, coupon details, and mock codes.
2. Add a helper that normalizes plan-derived coupons and uses fixtures only when pack data is absent.
3. Store `packId`, `source`, and coupon metadata when adding issued coupons to the wallet.
4. Verify helpers with a production build.

### Task 2: Replace the single-coupon Welcome ritual

**Files:**
- Modify: `src/App.jsx`
- Modify: `fc-coupon-wallet.css`

1. Pass the complete current pack to the Welcome surface.
2. Render all included discounts before claim.
3. Claim the pack locally in one action and persist every coupon.
4. Remove Claim Now/Get More OFF and old zoom/scratch behavior from the frontend mock path.

### Task 3: Complete the target pack home flow

**Files:**
- Modify: `src/App.jsx`
- Modify: `fc-coupon-wallet.css`

1. Show the target pack’s coupon contents while locked.
2. Keep one target threshold and one progress bar.
3. Claim every target coupon together when unlocked.
4. Switch the CTA to My Coupons after claim.

### Task 4: Show issued coupons immediately

**Files:**
- Modify: `src/App.jsx`
- Modify: `fc-coupon-wallet.css`

1. Upgrade the gift result modal to list each issued coupon.
2. Support copy per coupon from the result modal.
3. Keep My Coupons grouped by available, used, and expired.
4. Rename coupon usage actions to Shop now so “claim” only means issuing a gift.

### Task 5: Verify the complete frontend path

**Files:**
- Verify: `src/App.jsx`
- Verify: `src/dev/couponPacks.js`
- Verify: `fc-coupon-wallet.css`

1. Run `npm run build`.
2. Open `?scene=welcome`, confirm the start pack and all included coupons appear.
3. Claim the start pack and confirm every coupon appears in the result and wallet.
4. Open an unlocked target scene, claim the target pack, and confirm all target coupons are added without duplicates.
5. Check browser console errors and responsive layout.
