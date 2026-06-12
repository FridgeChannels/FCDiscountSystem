# Shopify Authorization Login PRD

## 1. 功能目标

新增 Shopify 授权登录功能，引导用户绑定 / 登录 Shopify 账号，用于支持后续优惠券状态同步、积分任务、奖励记录和更完整的挑战体验。

该功能的目标不是强制用户登录，而是：

1. 在关键行为发生时提醒用户登录 Shopify。
2. 允许用户跳过，不阻断当前体验。
3. 如果用户一直未登录，则通过首页底部任务卡持续引导。
4. 用户登录成功后，更新登录状态，发放一次性高额积分，并移除登录任务卡。

---

# 2. 核心产品原则

## 2.1 Shopify 登录是 soft gate，不是 hard gate

用户未登录 Shopify 时，系统可以提醒用户登录，但不能强制阻断用户继续体验。

用户在授权页可以选择：

```text
Continue with Shopify
```

也可以选择：

```text
Skip
```

点击 `Skip` 后，用户继续回到首页，并接上当前操作效果。

---

## 2.2 Claim 场景每次提醒

只要用户未登录 Shopify，每次点击首页的 `Claim` 按钮，都展示 Shopify 授权登录页。

用户可以每次都跳过。

`Skip` 只代表跳过本次提醒，不代表以后不再提醒。

---

## 2.3 Get More Off 场景首次提醒

用户首次进入首页后，看到 coupon 圈和两个按钮：

```text
Claim
Get More Off
```

如果用户未登录 Shopify，首次点击 `Claim` 或 `Get More Off`，都可以进入 Shopify 授权登录页。

但后续规则不同：

* `Claim`：未登录时，每次点击都提醒 Shopify 登录。
* `Get More Off`：建议只在首次点击时提醒一次，Skip 后后续不反复打断用户做任务。

原因：
`Claim` 是优惠券使用 / 领取的关键动作，和 Shopify 登录强相关。
`Get More Off` 是赚积分 / 做任务入口，如果每次都打断，会影响游戏体验。

---

## 2.4 底部任务卡长期展示

只要用户未登录 Shopify，首页底部任务区域第一个卡片位置始终展示：

```text
Connect Shopify Account
```

该任务给高额积分奖励。

用户完成 Shopify 登录后，该任务卡消失。

---

# 3. 用户状态定义

## 3.1 Shopify 登录状态

字段：

```text
shopify_auth_status
```

状态值：

| 状态          | 含义                  |
| ----------- | ------------------- |
| unconnected | 用户未登录 / 未授权 Shopify |
| connected   | 用户已完成 Shopify 授权    |
| failed      | 授权失败                |
| expired     | 授权过期，需要重新授权         |

说明：

不使用 `skipped` 作为登录状态。
因为 Skip 不是一种账号状态，只是用户跳过了一次登录提醒。

---

## 3.2 Skip 行为记录

字段：

```text
shopify_auth_skip_count
shopify_auth_last_skipped_at
```

用途：

* 记录用户跳过次数
* 便于后续分析转化
* 不影响 Claim 再次提醒

即使用户 skip 过，只要 `shopify_auth_status != connected`，下次点击 `Claim` 仍然提醒登录。

---

## 3.3 Get More Off 首次提醒状态

字段：

```text
get_more_off_auth_prompt_seen
```

状态值：

```text
true / false
```

规则：

* 初始为 `false`
* 用户首次从 `Get More Off` 进入 Shopify 授权页后，更新为 `true`
* 如果用户 skip，后续点击 `Get More Off` 不再重复弹授权页
* 如果用户从任务卡或 Claim 进入授权页，不影响该字段

---

## 3.4 Shopify 登录任务状态

字段：

```text
shopify_login_task_status
```

状态值：

| 状态         | 含义                    |
| ---------- | --------------------- |
| incomplete | Shopify 登录任务未完成       |
| completed  | Shopify 登录任务已完成，积分已发放 |

规则：

* 用户未登录 Shopify：`incomplete`
* 用户授权成功后：`completed`
* completed 后不再展示任务卡
* 积分只发放一次

---

# 4. 首页入口

首页 coupon 圈下方有两个核心按钮：

```text
Claim
Get More Off
```

底部任务区域有任务卡片列表。

Shopify 登录相关入口共三处：

```text
1. Claim 按钮：未登录时每次提醒
2. Get More Off 按钮：未登录时首次提醒
3. 底部任务卡：未登录时长期展示
```

可选管理入口：

```text
Profile / Settings / Account
```

用于展示 Shopify 连接状态，不作为主要转化入口。

---

# 5. Claim 按钮逻辑

## 5.1 用户已登录 Shopify

条件：

```text
shopify_auth_status = connected
```

用户点击：

```text
Claim
```

系统直接进入正常 Claim 流程。

---

## 5.2 用户未登录 Shopify

条件：

```text
shopify_auth_status != connected
```

用户每次点击：

```text
Claim
```

系统都展示：

```text
Shopify Authorization Page
```

说明：

* 不管用户之前是否看过授权页
* 不管用户之前是否点击过 Skip
* 不管用户已经跳过多少次
* 只要用户未登录 Shopify，每次点击 Claim 都提醒一次

这是 soft gate，用户仍然可以 Skip。

---

## 5.3 Claim 进入授权页时记录来源

字段：

```text
auth_entry_source = claim
return_action = claim
```

作用：

授权成功或 Skip 后，系统知道用户原本是从 Claim 进入的，可以回到首页并接上 Claim 后的效果。

---

# 6. Get More Off 按钮逻辑

## 6.1 用户已登录 Shopify

条件：

```text
shopify_auth_status = connected
```

用户点击：

```text
Get More Off
```

系统直接进入赚积分 / 任务区域 / challenge task flow。

---

## 6.2 用户未登录 Shopify，且首次点击 Get More Off

条件：

```text
shopify_auth_status != connected
AND get_more_off_auth_prompt_seen = false
```

用户点击：

```text
Get More Off
```

系统展示：

```text
Shopify Authorization Page
```

同时记录：

```text
auth_entry_source = get_more_off
return_action = get_more_off
get_more_off_auth_prompt_seen = true
```

---

## 6.3 用户未登录 Shopify，但已从 Get More Off 看过授权页

条件：

```text
shopify_auth_status != connected
AND get_more_off_auth_prompt_seen = true
```

用户点击：

```text
Get More Off
```

系统不再重复弹授权页，直接进入赚积分 / 任务区域。

底部任务卡仍然展示 Shopify 登录任务。

---

# 7. Shopify Authorization Page

## 7.1 页面定位

页面名称：

```text
Shopify Authorization Page
```

中文：

```text
Shopify 授权登录页
```

页面性质：

```text
登录软引导页 / soft gate page
```

该页面只做一件事：

> 引导用户登录 Shopify 账号。

---

## 7.2 页面结构

页面从上到下包含：

```text
[Title]

[Description]

[Primary CTA: Continue with Shopify]

[Small Skip]
```

不需要其他入口。
不需要二次确认。
不需要解释太多规则。

---

## 7.3 高保真原型文案

英文版：

```text
Connect your Shopify account

Log in with Shopify to sync your coupon status, track your rewards, and earn more points.

[Continue with Shopify]

Skip
```

中文理解版：

```text
连接你的 Shopify 账号

登录 Shopify 后，你可以同步优惠券状态、记录奖励，并获得更多积分。

[使用 Shopify 登录]

跳过
```

---

# 8. 授权页操作逻辑

## 8.1 点击 Continue with Shopify

用户点击：

```text
Continue with Shopify
```

系统执行：

```text
1. 跳转到 Shopify 授权登录链接
2. 用户在 Shopify 完成登录 / 授权
3. Shopify callback 回到系统
4. 后端校验 callback
5. 后端使用 code 换取 access token
6. 更新 shopify_auth_status = connected
7. 更新 shopify_login_task_status = completed
8. 如果任务积分未发放，则发放一次性登录积分
9. 回到首页
10. 首页刷新 coupon / points / task 状态
11. 底部 Shopify 登录任务卡消失
12. 根据 return_action 接上用户原本动作
```

---

## 8.2 点击 Skip

用户点击：

```text
Skip
```

系统执行：

```text
1. 记录 shopify_auth_skip_count +1
2. 更新 shopify_auth_last_skipped_at
3. 关闭 / 离开 Shopify Authorization Page
4. 回到首页
5. shopify_auth_status 保持 unconnected
6. 底部任务区继续展示 Shopify 登录任务卡
7. 根据 return_action 接上用户原本动作
```

说明：

`Skip` 不代表登录完成。
`Skip` 不代表以后不提醒。
如果用户下次再次点击 `Claim`，仍然再次展示 Shopify 授权登录页。

---

# 9. 底部任务区 Shopify 登录任务卡

## 9.1 展示条件

只要用户未登录 Shopify，就展示任务卡：

```text
shopify_auth_status != connected
```

适用状态：

```text
unconnected
failed
expired
```

---

## 9.2 展示位置

固定展示在首页底部游戏 / 任务区域的第一个卡片位置。

优先级高于其他任务。

登录成功后，该卡片消失，第一个位置恢复展示其他正常任务。

---

## 9.3 任务卡文案

英文版：

```text
Connect Shopify Account

Log in once and earn a big points boost.

+500 pts

[Connect]
```

中文理解版：

```text
连接 Shopify 账号

登录一次，即可获得高额积分奖励。

+500 积分

[去登录]
```

---

## 9.4 点击任务卡后的逻辑

用户点击：

```text
Connect
```

系统进入：

```text
Shopify Authorization Page
```

记录来源：

```text
auth_entry_source = task_card
return_action = task_card
```

如果登录成功：

```text
1. 更新 shopify_auth_status = connected
2. 更新 shopify_login_task_status = completed
3. 发放一次性高额积分
4. 回到首页
5. 刷新积分和 coupon 进度
6. 移除 Shopify 登录任务卡
```

如果点击 Skip：

```text
1. 回到首页
2. 任务卡继续展示
3. shopify_auth_status 保持 unconnected
4. 下次点击 Claim 仍然再次提醒登录
```

---

# 10. 登录成功后的首页反馈

用户完成 Shopify 授权后，回到首页需要有轻反馈：

```text
Shopify connected
+500 pts earned
```

中文理解：

```text
Shopify 已连接
获得 +500 积分
```

如果积分影响当前 coupon 进度，首页需要同步刷新：

```text
points
current_coupon
target_coupon
challenge_progress
task_list
```

---

# 11. 授权失败 / 用户取消授权

## 11.1 授权失败

如果 Shopify 授权失败，系统更新：

```text
shopify_auth_status = failed
```

提示：

```text
Connection failed. Please try again.
```

底部任务卡继续展示。

用户下次点击 Claim，仍然展示授权页。

---

## 11.2 用户在 Shopify 页面取消授权

如果用户在 Shopify 页面取消授权，系统回到首页。

状态保持：

```text
shopify_auth_status = unconnected
```

底部任务卡继续展示。

用户下次点击 Claim，仍然展示授权页。

---

## 11.3 授权过期

如果后续检测到 Shopify 授权失效，系统更新：

```text
shopify_auth_status = expired
```

首页底部任务区重新展示 Shopify 登录任务卡。

任务文案可调整为：

```text
Reconnect Shopify Account
```

---

# 12. 数据与安全规则

## 12.1 Shopify code 不存本地

Shopify callback 返回的 code 是一次性临时 code。

前端不保存 code。
后端负责完成：

```text
code → access token
```

前端只接收最终状态：

```text
connected / failed / expired
```

---

## 12.2 登录状态以服务端为准

前端可以缓存登录状态，但不能只依赖本地缓存。

每次进入首页时，建议从服务端拉取：

```text
shopify_auth_status
shopify_login_task_status
points
current_coupon
target_coupon
challenge_progress
task_list
```

---

## 12.3 登录任务积分只发放一次

Shopify 登录任务是一次性任务。

规则：

```text
if shopify_login_task_status != completed:
    grant points
    mark completed
else:
    do not grant again
```

防止用户重复登录刷积分。

---

# 13. 完整用户流程

## 13.1 未登录用户点击 Claim

```text
用户进入首页
↓
点击 Claim
↓
系统判断 shopify_auth_status != connected
↓
展示 Shopify Authorization Page
↓
用户选择 Continue with Shopify 或 Skip
```

---

## 13.2 Claim 场景下用户选择登录

```text
Continue with Shopify
↓
跳转 Shopify 授权链接
↓
授权成功
↓
回到首页
↓
更新 shopify_auth_status = connected
↓
发放登录任务积分
↓
移除底部 Shopify 登录任务卡
↓
刷新 coupon / points / challenge 状态
↓
接上 Claim 后的当前效果
```

---

## 13.3 Claim 场景下用户选择 Skip

```text
Skip
↓
回到首页
↓
shopify_auth_status 保持 unconnected
↓
底部任务区继续展示 Connect Shopify Account
↓
接上 Claim 后的当前效果
↓
用户下次点击 Claim 时，再次展示 Shopify Authorization Page
```

---

## 13.4 未登录用户首次点击 Get More Off

```text
用户点击 Get More Off
↓
系统判断 shopify_auth_status != connected
AND get_more_off_auth_prompt_seen = false
↓
展示 Shopify Authorization Page
↓
用户选择 Continue with Shopify 或 Skip
```

---

## 13.5 用户之后再次点击 Get More Off

```text
用户点击 Get More Off
↓
如果 shopify_auth_status != connected
AND get_more_off_auth_prompt_seen = true
↓
不再弹授权页
↓
直接进入赚积分 / 任务区域
↓
底部 Shopify 登录任务卡继续展示
```

---

## 13.6 用户通过任务卡登录

```text
用户在首页底部任务区看到 Connect Shopify Account
↓
点击 Connect
↓
进入 Shopify Authorization Page
↓
点击 Continue with Shopify
↓
完成 Shopify 授权
↓
回到首页
↓
发放高额积分
↓
刷新 coupon 进度
↓
移除 Shopify 登录任务卡
```

---

# 14. 最终规则总结

最终产品规则为：

```text
1. 用户未登录 Shopify 时，每次点击 Claim，都展示 Shopify 授权登录页。
2. 用户可以 Skip，本次继续当前 Claim 效果。
3. Skip 不改变登录状态，也不阻止下次 Claim 再次提醒。
4. 用户未登录 Shopify 时，首次点击 Get More Off，可展示 Shopify 授权登录页。
5. Get More Off 被 Skip 后，后续不反复弹授权页，避免打断任务体验。
6. 首页底部任务区始终展示 Connect Shopify Account 任务卡，直到用户登录成功。
7. 用户登录成功后，更新登录状态，发放一次性高额积分，移除任务卡。
8. Shopify code 不存本地，登录状态以服务端为准。
```

---

# 15. 最终入口规划

Shopify 登录入口分三层：

```text
第一层：Claim soft gate
未登录时每次点击 Claim 都提醒登录。

第二层：Get More Off first-time soft gate
首次点击时提醒一次，Skip 后不反复打断。

第三层：首页底部任务卡
未登录时长期展示，给高额积分激励。

第四层：Profile / Settings
低频管理入口，用于查看连接状态或重新连接。
```

优先级最高的是：

```text
Claim soft gate + 底部任务卡
```

因为 Claim 是强相关场景，底部任务卡是长期不打扰入口。
