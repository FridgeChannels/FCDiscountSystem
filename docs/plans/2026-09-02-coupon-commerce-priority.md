# Coupon Commerce Priority Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让立即可用的 Coupon 在购买 CTA 前提供价值，让需要任务解锁的 Coupon 位于 CTA 后，同时保证 Coupon 永远不阻断 Amazon 购买路径。

**Architecture:** 将 Landing 中分散的 Coupon 与 Amazon CTA 渲染逻辑收敛为一个 `PurchaseBlock`。领域层先验证 Coupon 与商品的 Seller、ASIN、Amazon Destination 三元绑定，再把可用优惠分成 `immediateCoupons` 和 `gatedCoupons`，UI 只负责按状态矩阵渲染。复制 Code 与打开 Amazon 的组合动作由购买区统一管理，复制失败也不得阻止跳转。

**Tech Stack:** React 19、Vite、CSS、Node.js test runner、Playwright 移动端视觉验收

---

## Product rules

| 状态 | CTA 前 | 主 CTA | CTA 后 |
|---|---|---|---|
| 无 Coupon | 无 | `Buy again on Amazon` | 无 |
| 单个立即可用 Coupon | 折扣、Code、Copy、关键条件、Details | `Use coupon on Amazon` | 无 |
| 单个 Survey Coupon | 无 | `Buy again on Amazon` | `Want 15% off? Answer 3 quick questions` |
| 多个立即可用 Coupon | 聚合摘要与 `View coupons` | `Buy again on Amazon` | 无 |
| 立即可用与 Survey Coupon 混合 | 仅聚合立即可用 Coupon | `Buy again on Amazon` | Survey Coupon 轻量入口 |
| Coupon 不匹配、过期、用尽、加载失败 | 无 | `Buy again on Amazon` | 无 |

主 CTA 始终是页面唯一 Filled Button。Copy、Details、View coupons 和 Survey 入口只能是文字按钮、透明行或描边 Secondary Button。

### Task 1: Enforce Seller + ASIN + Destination binding

**Files:**
- Modify: `src/reorder/fixtures.js`
- Modify: `src/reorder/domain.js`
- Test: `src/reorder/domain.test.js`

**Step 1: Write failing binding tests**

为商品和 Coupon fixture 增加稳定的 `sellerId` 与 `eligibleAsins`。新增测试覆盖：Seller 不同、ASIN 不同、Coupon Amazon URL 指向不同 ASIN、非 Amazon HTTPS URL；四种情况均不得进入可见 Coupon。

**Step 2: Run the focused test**

Run: `npm test`

Expected: 新增绑定测试失败，现有测试继续通过。

**Step 3: Implement the binding predicate**

在 `domain.js` 增加：

```js
export function amazonAsin(value) {
  if (!isSafeAmazonUrl(value)) return '';
  const pathname = new URL(value).pathname;
  return pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase() || '';
}

export function isCouponBoundToProduct(coupon, product) {
  if (!coupon || !product) return false;
  const couponAsin = amazonAsin(coupon.amazonUrl);
  return coupon.sellerId === product.sellerId
    && coupon.eligibleAsins?.includes(product.asin)
    && couponAsin === product.asin;
}
```

将 `isCouponEligible` 与 `selectEligibleCoupons` 从接收 `productId` 改为接收完整 `product`，先验证三元绑定，再验证状态、时间和 Code Pool。

**Step 4: Run tests**

Run: `npm test`

Expected: Seller、ASIN、Destination 任一不匹配时 Coupon 被过滤；有效 Coupon 保持可见。

### Task 2: Separate immediate and gated Coupon states

**Files:**
- Modify: `src/reorder/domain.js`
- Test: `src/reorder/domain.test.js`

**Step 1: Write failing placement tests**

新增测试，要求 `composeConsumerModules` 返回：

```js
{
  immediateCoupons: [],
  gatedCoupons: [],
  showVoluntarySurvey: false,
  surveyActive: true
}
```

直接 Coupon 进入 `immediateCoupons`；需要 Survey 且 Survey 有效的 Coupon 进入 `gatedCoupons`；过期、用尽、绑定错误或 Survey 不可用的 Coupon 不进入任一数组。

**Step 2: Implement the state split**

保留现有 fallback 行为，但 fallback 成为直接 Coupon 时只能进入 `immediateCoupons`。删除 Landing 对通用 `modules.coupons` 顺序的依赖。

**Step 3: Run tests**

Run: `npm test`

Expected: 所有状态矩阵测试通过，排序仍按 `priority` 稳定输出。

### Task 3: Introduce a single PurchaseBlock

**Files:**
- Modify: `src/reorder/ReorderApp.jsx`
- Modify: `src/reorder/reorder.css`
- Test: `src/reorder/domain.test.js`

**Step 1: Extract presentation components**

新增或重命名以下组件：

- `PurchaseBlock`：唯一决定 Coupon 与 Amazon CTA 顺序的组件；
- `ImmediateCouponOffer`：折扣、Code、Copy、关键条件、Details；
- `GatedCouponOffer`：`Want {benefit}?` 与问卷耗时，整行可点击；
- `CouponSummary`：多个立即可用 Coupon 的聚合摘要；
- `AmazonCta`：唯一 Filled Button。

**Step 2: Render exact state order**

`PurchaseBlock` 的顺序固定为：

```jsx
<ImmediateCouponArea />
<AmazonCta />
<AmazonReassurance />
<GatedCouponArea />
```

当对应数组为空时不渲染区域。当前 `LinkedCouponCard` 必须从 Amazon CTA 上方移动到下方，并改为：

```text
Want 15% off?
Answer 3 quick questions · About 15 seconds  ›
```

不再提前展示有效期、叠加规则等完整条款；这些信息在 Coupon 获得后进入详情。

**Step 3: Remove the visible load-error block**

删除 Landing 上的 `coupon-load-error` 文案。Coupon 加载失败只记录 telemetry，正常显示购买 CTA，不让优惠异常制造购买焦虑。

**Step 4: Apply visual hierarchy**

- Amazon CTA：深色 Filled Button，至少 56px 高；
- 立即可用 Coupon：浅背景或轻描边，不使用大标题；
- Survey Coupon：透明扁平行，位于 CTA 后；
- Copy / Details / View coupons：Secondary 样式，至少 44px 点击区域；
- 页面内不得出现第二个 Filled Button。

### Task 4: Combine Copy and Amazon navigation without gating commerce

**Files:**
- Modify: `src/reorder/ReorderApp.jsx`
- Modify: `src/reorder/reorderService.js`

**Step 1: Lift copy state into PurchaseBlock**

立即可用且必须输入 Code 时，`PurchaseBlock` 统一持有 `code`、`copied` 与 `copy()`，避免 Coupon 卡片与 CTA 各自维护状态。

**Step 2: Implement the combined CTA**

主按钮初始文案：

```text
Use coupon on Amazon
```

辅助文案：

```text
Copies MORROW10 and opens Amazon
```

点击顺序为复制 Code、显示 `Code copied ✓`、记录事件、打开 Amazon。复制失败时记录 `coupon_copy_failed`，但仍继续打开 Amazon；Coupon 不能成为购买门槛。

用户单独点击 Copy 后，主按钮恢复为：

```text
Buy again on Amazon
```

辅助文案变为：

```text
Code copied · Opens Amazon
```

**Step 3: Keep destination copy truthful**

只有实际配置并验证了 App deep link + Web fallback 时才显示 `Opens Amazon app`；当前普通 HTTPS 跳转继续显示 `Opens Amazon`，避免承诺未实现的行为。

### Task 5: Add progressive Coupon details

**Files:**
- Modify: `src/reorder/ReorderApp.jsx`
- Modify: `src/reorder/reorder.css`

**Step 1: Limit Landing details**

Landing 仅显示：折扣、Code、当前规格、有效期和 Details 入口。Seller、使用次数、叠加规则放入详情页。

**Step 2: Reuse or generalize the existing reveal screen**

将 `CouponRevealScreen` 拆成可复用的 `CouponDetailsScreen`，支持：

- 直接 Coupon：标题为 `Coupon details`；
- Survey 完成后的 Coupon：保留 `Your coupon is ready` 成功状态；
- 两者共享 Code、Seller、ASIN/商品、有效期、使用限制、叠加规则和 Amazon CTA。

### Task 6: Correct multiple-Coupon behavior

**Files:**
- Modify: `src/reorder/ReorderApp.jsx`
- Modify: `src/reorder/reorder.css`
- Modify: `src/reorder/fixtures.js`

**Step 1: Make the Landing summary factual**

摘要显示数量和折扣组合，例如 `10% off · $5 off 2 packs`，不显示 `Best coupon`。

**Step 2: Keep Coupon list actions secondary**

列表项显示折扣、最低购买条件与 `Use this coupon` 描边按钮。选择后返回 Landing、展示被选 Coupon，并让唯一 Filled CTA 执行 Copy + Amazon；列表内不增加 Filled Button。

### Task 7: Add conversion-oriented telemetry

**Files:**
- Modify: `src/reorder/reorderService.js`
- Modify: `src/reorder/ReorderApp.jsx`

**Step 1: Add diagnostic events**

记录 `fc_landing_viewed`、`coupon_impression`、`coupon_code_copied`、`coupon_copy_failed`、`amazon_navigation_started`，每个事件携带 `fcId`、`sellerId`、`asin`、`couponId` 和 destination。

**Step 2: Define the north-star metric outside the client**

最终指标为：

```text
Amazon attributed purchases / unique FC landing views
```

前端事件只能支持漏斗诊断，不能把 Copy Rate 或 Survey Completion 当作成功指标。Amazon attributed purchase 需要后端或 Amazon Attribution 回传，不能由当前前端自行推断。

### Task 8: Verify every state at mobile widths

**Files:**
- Test: `src/reorder/domain.test.js`
- Output: `output/playwright/coupon-commerce-priority-*.png`

**Step 1: Run automated verification**

Run: `npm test`

Expected: 所有领域状态与绑定测试通过。

Run: `npm run build`

Expected: Vite production build succeeds without warnings or errors.

**Step 2: Run visual verification**

在 375×812 和 430×932 视口分别检查：无 Coupon、直接 Coupon、Survey Coupon、多 Coupon、Coupon unavailable。

**Step 3: Acceptance criteria**

- 立即 Coupon 位于 CTA 前；Survey Coupon 位于 CTA 后；
- 页面只有一个 Filled Button；
- 无论复制、Survey、Details 或 Coupon 加载是否成功，Amazon CTA 始终可用；
- Coupon 与 CTA 的 Seller、ASIN、Destination 完全一致；
- 文字在 375px 下无横向溢出；
- Copy、Details、Survey 和次级按钮点击区域不小于 44px；
- 无 Coupon、过期、用尽、绑定错误和加载失败状态均不显示 Coupon；
- CTA 文案描述购物任务，不使用 `Go to Amazon`。
