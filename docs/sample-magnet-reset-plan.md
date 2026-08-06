# Sample Magnet Reset — Implementation Plan

**Overall Progress:** `100%`

## TLDR

结算等待页在 `sample=1` 时只显示 Reset。点击后清引擎 `magnet_coupon_wallet`、重置 magnet 进度，同会话播礼盒并进入首轮；不走 `cycle/renew`。

## Critical Decisions

| 决策 | 选择 |
|------|------|
| `sample` 数据源 | 库表已有列，代码同步 |
| 清券边界 | 仅删 `magnet_coupon_wallet` |
| Reset 后落地 | 同会话礼盒 → welcome → 首轮 |
| 结算页 CTA | sample 仅 Reset |
| 全部奖励页 | sample 也显示 Reset（活动未结束、催用券） |
| 鉴权 | UI：`sample = 1` 才显示 Reset；API：`POST /cycle/sample-reset` 不校验 sample（含 5× logo） |

## Tasks

- [x] 🟩 **Step 1: 同步 `sample` 字段**
  - [x] 🟩 domain / mapper / `MagnetBrandParamView.isSample` / frontend `isSampleMagnetParam`
- [x] 🟩 **Step 2: Repository 清 wallet**
  - [x] 🟩 `deleteCouponWalletByMagnet` (supabase + in-memory)
- [x] 🟩 **Step 3: 引擎 `sampleResetMagnet` + BFF**
  - [x] 🟩 `POST /cycle/sample-reset` → `POST /api/fc/cycle/sample-reset`
- [x] 🟩 **Step 4: 结算页 UI**
  - [x] 🟩 sample 仅 Reset；`startSampleResetFlow` 礼盒首轮
  - [x] 🟩 「全部奖励」completed 页也显示 Reset（sample）
  - [x] 🟩 Reset 与 Start Next Challenge 共用礼盒/欢迎壳；intro 期间屏蔽 allRewardsClaimed 副作用
- [x] 🟩 **Step 5: 测试**
  - [x] 🟩 `cycle-sample-reset.test.ts` + wallet delete test
