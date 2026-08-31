# Independent Coupon and Survey Modules Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support Coupon-only, Survey-only, and combined Coupon + Survey configurations.

**Architecture:** Replace the recommendation-oriented Finder dependency with a configurable Survey module. Coupon eligibility remains product-bound; a relationship flag decides whether it is direct or unlocked by a named Survey. The landing renderer composes Coupon, Buy Again, and voluntary Survey independently.

**Tech Stack:** React, Vite, browser storage, Node test runner.

---

### Task 1: Define Coupon and Survey module configuration

**Files:**
- Modify: `src/reorder/fixtures.js`
- Modify: `src/reorder/domain.js`
- Test: `src/reorder/domain.test.js`

Add `survey.enabled`, a maximum-three-question survey definition, `coupon.requiresSurvey`, and fallback flags. Add a pure composition function that returns the Coupon mode and the voluntary Survey state for the five supported combinations.

### Task 2: Build the five-state Landing composition

**Files:**
- Modify: `src/reorder/ReorderApp.jsx`
- Modify: `src/reorder/reorder.css`

Render direct Coupon content on Landing, preserve Buy Again as the only filled primary action, and place a voluntary Survey card after Buy Again. Show a linked Coupon card only when the Coupon and its linked Survey are valid.

### Task 3: Implement standalone Survey flow

**Files:**
- Modify: `src/reorder/ReorderApp.jsx`
- Modify: `src/reorder/reorderService.js`

Reuse the question UI without recommendation ranking. Persist anonymous answers with FC, product, brand, survey, and optional Coupon context. Route voluntary completion to a Thank-you screen and linked completion to Coupon Reveal.

### Task 4: Restore multiple Coupon selection

**Files:**
- Modify: `src/reorder/ReorderApp.jsx`
- Modify: `src/reorder/reorder.css`

When more than one eligible Coupon exists, show an aggregate entry, let the consumer select a Coupon, label direct and linked modes, then route to the appropriate flow.

### Task 5: Verify state and failure matrix

**Files:**
- Modify: `src/reorder/domain.test.js`

Cover no modules, Coupon Only, Survey Only, Independent, Linked, unavailable Coupon, unavailable Survey, and configured fallbacks. Run the full test suite and production build.
