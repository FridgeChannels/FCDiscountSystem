# FC Reorder Document-Complete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement every consumer-side combination, state transition, and edge case defined in the FC Reorder product background and UI/UX documents.

**Architecture:** Keep the existing Vite/React shell, but split FC Reorder into a pure domain layer, a replaceable local service layer, and React screens. Domain functions own eligibility, module composition, recommendation, versioned persistence keys, and URL validation; the service simulates FC Resolve, idempotent code allocation, and telemetry until real backend endpoints are connected.

**Tech Stack:** React 19, Vite 6, browser storage, Node built-in test runner, CSS.

---

### Task 1: Domain decision table

**Files:**
- Create: `src/reorder/domain.js`
- Create: `src/reorder/domain.test.js`
- Modify: `package.json`

1. Write tests for all six rows of the document module-combination matrix.
2. Add Coupon state/eligibility partitions: active, scheduled, paused, ended, exhausted, error, current-product-only, recommendation-only, no-code.
3. Add Finder validity tests: 0/1/2 valid alternatives, missing image, missing Amazon URL, unpublished rules, incomplete questions.
4. Add Amazon URL validation and recommendation tie/fallback tests.
5. Run `npm test` and confirm the initial failure.
6. Implement the pure functions and rerun until all tests pass.

### Task 2: FC Resolve and persistence service

**Files:**
- Replace: `src/reorder/fixtures.js`
- Create: `src/reorder/reorderService.js`

1. Define FC → batch → brand → product → variant → ASIN → Attribution URL fixtures.
2. Provide document-defined scenarios through `?scenario=` without exposing debug UI.
3. Implement asynchronous resolve with invalid, discontinued, missing URL, and image-failure results.
4. Implement telemetry storage for CTA attempted/succeeded/failed events.
5. Implement `FC ID + Coupon ID` idempotent code assignment.
6. Implement Finder progress and `FC ID + Finder Version` result persistence.

### Task 3: Config-driven Landing and Amazon CTA

**Files:**
- Modify: `src/reorder/ReorderApp.jsx`
- Modify: `src/reorder/reorder.css`

1. Replace query-selected screens with a resolving application state.
2. Render Standard, With Finder, With Coupon, and With Coupon + Finder from domain composition.
3. Keep only one current-product Inline Coupon above the primary CTA.
4. Implement Idle → Pressed → Opening Amazon → Navigation and Error → Retry.
5. Add missing-URL disabled state, configured brand fallback, Copy link, repeat-click prevention, and browser-return restoration.

### Task 4: Product Finder state machine

**Files:**
- Modify: `src/reorder/ReorderApp.jsx`

1. Hide Finder unless its configuration is valid.
2. Restore versioned in-session progress and provide Start over.
3. Use answer/tag scoring, exclude the original product, apply stable tie priority, and produce answer-derived reasons.
4. Implement calculating, result, fallback result, see another option, original product, and retake actions.
5. Change the returning-user entry to See your match and invalidate old results on Finder version changes.

### Task 5: Inline Coupon state machine

**Files:**
- Modify: `src/reorder/ReorderApp.jsx`
- Modify: `src/reorder/reorder.css`

1. Implement eligible Coupon direct display with its code visible; no user reveal step.
2. Implement no-code Coupon, unavailable/exhausted filtering, direct copy, and non-blocking Amazon CTA.
3. Show recommendation-only Coupon exclusively on Result Page.
4. Remove the prototype-only multi-Coupon list and independent Coupon detail screens.

### Task 6: Boundary states and verification

**Files:**
- Modify: `src/reorder/ReorderApp.jsx`
- Modify: `src/reorder/reorder.css`
- Create: `src/reorder/reorder.integration.test.js` if needed

1. Implement structured resolving skeleton without blocking resolved text/CTA on image load.
2. Implement invalid FC, safe brand fallback, discontinued replacement, image placeholder, missing Attribution URL, incomplete Finder, exhausted Coupon, and Coupon error states.
3. Run `npm test` and `npm run build`.
4. Exercise all scenario URLs at 365px, 390px, and 430px.
5. Verify white background, no horizontal overflow, no broken images, correct module visibility, and every valid state transition.
