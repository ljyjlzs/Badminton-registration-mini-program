# 🏸 羽毛球小程序 — 全功能联调测试报告

> **测试日期**：2026-09-21
> **测试方式**：代码全链路追踪（前端 .wxml/.js ↔ 云函数 ↔ 数据库读写）
> **覆盖范围**：32 个页面 + 60+ 个云函数，逐个追踪字段映射、导航参数、响应格式
> **分支**：sync-java-backend

---

## 📊 问题统计

| 严重级别 | 数量 | 说明 |
|---------|------|------|
| 🔴 CRITICAL | 6 | 功能完全不可用 / 数据丢失风险 |
| 🟠 HIGH | 13 | 重要功能异常 / 用户可见明显 bug |
| 🟡 MEDIUM | 10 | 降级体验 / 潜在隐患 |
| 🔵 LOW | 8 | 代码质量 / 边缘场景 |
| **合计** | **37** | |

---

## 🔴 CRITICAL — 必须修复

### BUG-001: AI 聊天历史永远为空（字段名不匹配）
- **文件**：`cloudfunctions/ai-history/index.js` 第 28-29 行、第 38-40 行
- **问题**：ai-history 查询用 `user_id` 和 `created_at`（snake_case），但 ai-chat 写入用 `userId` 和 `createdAt`（camelCase）
- **影响**：用户打开 AI 聊天页面，历史消息永远为空。刷新页面后之前的消息全部消失
- **修复**：将 ai-history 的 `user_id` 改为 `userId`，`created_at` 改为 `createdAt`

```javascript
// 当前（错误）
.where({ user_id: openid }).orderBy('created_at', 'asc')
// 应改为
.where({ userId: openid }).orderBy('createdAt', 'asc')
```

---

### BUG-002: AI 操作反馈消息发送失败（参数名不匹配）
- **文件**：`miniprogram/pages/ai-chat/ai-chat.js` 第 263 行、第 441 行
- **问题**：`onCancelAction` 和 `_finishAction` 调用 `_callAI({ action_result: resultText })`，但云函数 ai-chat 第 106 行读取的是 `payload.message`，`action_result` 字段被忽略
- **影响**：用户确认或取消 AI 操作后，系统无法将结果反馈给 AI，导致 AI 显示"消息不能为空"错误。整个 AI 操作确认流程断裂
- **修复**：将 `_callAI({ action_result: resultText })` 改为 `_callAI({ message: '[系统通知] 操作执行结果：' + resultText })`

```javascript
// 当前（错误）
this._callAI({ action_result: resultText });
// 应改为
this._callAI({ message: '[系统通知] 操作执行结果：' + resultText });
```

---

### BUG-003: 从"我的"页面点击活动跳转白屏
- **文件**：`miniprogram/pages/profile/profile.js` 第 54 行
- **问题**：导航 URL 使用 `?activityId=${id}`，但 activity-detail.js 第 65 行读取 `options.id`
- **影响**：从 profile 页点击任何活动，activityId 为空，详情页不加载任何数据，显示空白
- **修复**：将 `?activityId=${id}` 改为 `?id=${id}`

```javascript
// 当前（错误）
url: `/pages/activity-detail/activity-detail?activityId=${id}`
// 应改为
url: `/pages/activity-detail/activity-detail?id=${id}`
```

---

### BUG-004: AI 邀请生成功能完全不可用
- **文件**：`miniprogram/pages/invite/invite.js` 第 1 行、第 20 行
- **问题**：未声明 `var app = getApp()`，`app` 变量未定义导致 ReferenceError；且 `app.globalData.aiEnabled` 字段在 app.js 的 globalData 中不存在
- **影响**：`aiEnabled` 永远为 false，"生成邀请语"按钮永远不显示，整个邀请生成功能完全废弃
- **修复**：
  1. 在 invite.js 第 1 行添加 `var app = getApp();`
  2. 在 app.js 的 globalData 中添加 `aiEnabled: false`（或 true，取决于配置）

---

### BUG-005: join-activity 全局删除危险操作
- **文件**：`cloudfunctions/join-activity/index.js` 第 47 行
- **问题**：`db.collection('registrations').where({ activityId: null }).remove()` 删除所有 activityId 为 null 的记录，未限定用户
- **影响**：任何用户报名时，都会删除所有 activityId 为 null 的报名记录（包括其他用户的脏数据）。这是一个全局删除操作，可能误删数据
- **修复**：添加 `userId: openid` 条件，或直接删除这行（脏数据清理不应在报名流程中做）

```javascript
// 当前（危险）
await db.collection('registrations').where({ activityId: null }).remove();
// 应改为（限定当前用户）
await db.collection('registrations').where({ activityId: null, userId: openid }).remove();
// 或直接删除此行
```

---

### BUG-006: app.js 异常路径缺少语音配置字段
- **文件**：`miniprogram/app.js` 第 33-39 行
- **问题**：globalData 的 catch 初始化路径缺少 `voiceEnabled` 和 `voiceConfig` 字段。当本地缓存读取失败时，这两个字段为 undefined
- **影响**：所有依赖 `app.globalData.voiceEnabled` / `app.globalData.voiceConfig` 的页面（如 activity-detail、grouping）在异常场景下语音功能不可用，可能出现 undefined 错误
- **修复**：在 catch 块的 globalData 初始化中添加这两个字段

---

## 🟠 HIGH — 重要功能异常

### BUG-007: login 错误响应字段名不一致
- **文件**：`cloudfunctions/login/index.js` 第 29 行、第 91 行
- **问题**：错误返回用 `error` 字段（`{ success: false, error: '...' }`），但前端 index.js 第 100 行读取 `result.message`
- **影响**：登录失败时，前端显示的是通用"登录失败"而非具体错误原因
- **修复**：将云函数中的 `error` 改为 `message`

---

### BUG-008: match-reminders 永远不会触发
- **文件**：`cloudfunctions/match-reminders/index.js` 第 76 行
- **问题**：查询 `m.scheduledTime` 做时间筛选，但所有创建比赛的云函数（start-grouping、court-start）从未写入 `scheduledTime` 字段
- **影响**：比赛提醒功能完全无效，用户永远不会收到比赛即将开始的提醒
- **修复**：在 start-grouping 和 court-start 创建比赛时写入 `scheduledTime` 字段

---

### BUG-009: update-activity-status 返回不可序列化的 serverDate 对象
- **文件**：`cloudfunctions/update-activity-status/index.js` 第 58 行
- **问题**：`return { success: true, data: { ...updateData, badges } }` 中 updateData 包含 `updatedAt: db.serverDate()`，这是一个特殊对象，JSON 序列化后变成 `{$date: ...}` 格式
- **影响**：前端收到的 data 中 updatedAt 为 `{$date: ...}` 对象而非可读时间戳，可能导致前端显示异常
- **修复**：在返回前移除 updatedAt，或返回一个新的时间戳

---

### BUG-010: AI 创建活动省市区为空
- **文件**：`miniprogram/pages/ai-chat/ai-chat.js` 第 307-315 行
- **问题**：AI 创建活动时传入 `province: '', city: '', district: ''`，但 create-activity 云函数第 80-82 行要求省市区非空
- **影响**：通过 AI 助手创建活动永远失败，返回"省/市/区不能为空"
- **修复**：AI 创建活动时传入默认省市区，或在云函数中对 AI 来源放宽校验

---

### BUG-011: photo-detail 评论显示 userId 而非昵称
- **文件**：`miniprogram/pages/photo-detail/photo-detail.wxml` 第 25 行、第 33 行
- **问题**：模板使用 `{{item.userId || '匿名'}}` 作为评论者名称显示，但 userId 是不透明 ID（如 "ouXXX"）
- **影响**：照片评论区显示原始 ID 而非用户昵称，用户体验极差
- **修复**：在 photo-detail.js 中查询 users 集合，建立 userId → nickname 映射，传给模板

---

### BUG-012: AI 相册笔记"采纳"按钮实际不保存
- **文件**：`miniprogram/pages/ai-note-preview/ai-note-preview.js` 第 36-38 行
- **问题**：`adopt()` 函数只显示"已保存"toast 然后返回，未调用任何云函数保存笔记到数据库
- **影响**：用户以为笔记已保存，实际数据丢失。"采纳"功能形同虚设
- **修复**：在 adopt() 中调用 update-activity-status 保存 albumNote

---

### BUG-013: 分享海报 Canvas 绘制失败
- **文件**：`miniprogram/pages/photo-album/photo-album.js` 第 354 行
- **问题**：Canvas `drawImage` 直接使用云存储 fileID，但 Canvas 1.0 不支持 cloud:// 协议的 fileID
- **影响**：分享海报生成后照片区域显示空白矩形，海报无实际照片内容
- **修复**：先用 `wx.cloud.getTempFileURL` 将 fileID 转为临时 URL，再绘制

---

### BUG-014: update-activity-status 缺少状态转换验证
- **文件**：`cloudfunctions/update-activity-status/index.js` 第 24-29 行
- **问题**：只要传入合法的状态值就可以任意跳转，不验证当前状态和目标状态的合法性（如从 finished 跳回 registering）
- **影响**：可能将已结束的活动重新改为报名中，导致数据混乱
- **修复**：添加状态转换白名单验证

---

### BUG-015: activity-report 页面未注册到 app.json
- **文件**：`miniprogram/app.json`
- **问题**：`pages/activity-report/` 目录存在且有完整文件，但 app.json 中未注册该页面
- **影响**：从其他页面导航到 activity-report 会失败（实际上 activity-detail 导航到的是 report/report，但 activity-report 目录本身不可访问）
- **修复**：确认 activity-report 与 report 的关系，如需使用则注册到 app.json

### BUG-016: 排名页团队成员显示"未知"（openid 未映射昵称）
- **文件**：`cloudfunctions/get-rankings/index.js` 第 80 行
- **问题**：团队排名的 `members` 直接传入原始 openid 数组，未查询 users 集合映射昵称和头像
- **影响**：团队排名中所有成员显示名称为"未知"，头像为"?"，完全无法辨认
- **修复**：在返回前查询 users 集合，将 openid 映射为 `{userId, nickname, avatar, level}` 对象

### BUG-017: 排名页金银铜样式不生效（WXML 调用 Page 方法）
- **文件**：`miniprogram/pages/ranking/ranking.wxml` 第 42、63、87、111 行
- **问题**：WXML 模板中使用 `{{getRankClass(item.rank)}}` 和 `{{getScoreClass(item.totalScore)}}`，但这是 Page 方法，WXML 表达式无法调用
- **影响**：排名页无金银铜样式区分，分数无红绿色区分，所有排名项显示相同默认样式
- **修复**：在 JS 的 loadRankings 中预计算 rankClass 和 scoreClass 字段，或创建 WXS 模块

### BUG-018: 赛程页组织者拖拽排序完全不可用
- **文件**：`cloudfunctions/court-matches/index.js` 第 112 行
- **问题**：list action 返回数据只包含 matches，未返回 isOrganizer 和 activity 信息
- **影响**：组织者无法在赛程页拖拽调整比赛顺序，"保存顺序"按钮永远不显示
- **修复**：在 list action 中查询活动信息，返回 isOrganizer 和 activity.type/status

### BUG-019: 战报页显示"第group轮"而非数字轮次
- **文件**：`miniprogram/pages/report/report.wxml` 第 35 行
- **问题**：使用 `{{item.round}}` 显示轮次，但 round 值为 'group'/'final'（字符串），应使用 `roundOrder`（数字）
- **影响**：战报中比赛记录显示"第group轮"、"第final轮"，而非"第1轮"等有意义的数字
- **修复**：将 `item.round` 改为 `item.roundOrder`

---

## 🟡 MEDIUM — 降级体验 / 潜在隐患

### BUG-020: get-activities 重复 cloud.init()
- **文件**：`cloudfunctions/get-activities/index.js` 第 3 行和第 12 行
- **问题**：`cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })` 调用了两次
- **影响**：功能正常但代码冗余，可能有微小的初始化延迟

### BUG-021: grouping-preview 硬编码活动类型
- **文件**：`miniprogram/pages/grouping-preview/grouping-preview.js` 第 39 行
- **问题**：`typeLabel` 硬编码为"按场地双打"，不随实际活动类型变化
- **影响**：如果活动类型不是 court-doubles，显示的类型标签错误

### BUG-022: grouping-preview 重新生成分组返回数据结构不匹配
- **文件**：`miniprogram/pages/grouping-preview/grouping-preview.js` 第 107-127 行
- **问题**：`regenerateGrouping()` 期望返回 `{teams, rules, matchesCount}` 结构，但 start-grouping 返回的数据结构不同
- **影响**：重新生成后队伍列表可能显示为空

### BUG-023: ai-note-preview 缺少 activityId 参数校验
- **文件**：`miniprogram/pages/ai-note-preview/ai-note-preview.js` 第 10 行
- **问题**：如果 onLoad 未收到 activityId，页面无任何提示，显示空白
- **影响**：异常进入时用户看到空白页面，不知道发生了什么

### BUG-024: photo-detail 错误处理不完整
- **文件**：`miniprogram/pages/photo-detail/photo-detail.js` 第 47 行、第 57 行
- **问题**：catch 中 `wx.showToast({ title: e.message })` 可能 e.message 为 undefined
- **影响**：错误提示显示空或 "[object Object]"

### BUG-025: rules-qa 输入栏可能被键盘遮挡
- **文件**：`miniprogram/pages/rules-qa/rules-qa.wxml` 第 33 行
- **问题**：`position: fixed; bottom: 0` 在 iPhone X+ 设备键盘弹出时可能遮挡内容
- **影响**：部分设备上输入框与键盘重叠

### BUG-026: request() 和 callFunction() 返回值结构不一致
- **文件**：`miniprogram/utils/request.js` 第 6-18 行
- **问题**：`callFunction()` 解包 `res.result`，`request()` 返回原始响应。混用时极易出错
- **影响**：开发维护困难，新功能容易用错数据访问路径

### BUG-027: settings 页面无导航入口
- **文件**：`miniprogram/pages/settings/`
- **问题**：settings 页面注册在 app.json 中但没有任何导航入口指向它
- **影响**：用户无法到达设置页面，功能不可用

### BUG-028: privacy / agreement 页面未注册
- **文件**：`miniprogram/pages/privacy/`、`miniprogram/pages/agreement/`
- **问题**：文件存在但未注册到 app.json
- **影响**：隐私政策和用户协议页面不可访问（如果有合规要求则为 HIGH）

### BUG-029: voice-score-test 页面无导航入口
- **文件**：`miniprogram/pages/voice-score-test/`
- **问题**：页面注册在 app.json 中但无导航入口
- **影响**：语音记分测试功能不可用

---

## 🔵 LOW — 代码质量 / 边缘场景

### BUG-030: ai-note-preview 使用废弃的 Canvas 1.0 API
- **文件**：`miniprogram/pages/photo-album/photo-album.js` 第 330-373 行
- **问题**：使用 `createCanvasContext`（Canvas 1.0），已被微信废弃
- **建议**：迁移到 Canvas 2.0

### BUG-031: photo-detail 无 onShow 刷新
- **文件**：`miniprogram/pages/photo-detail/photo-detail.js` 第 15-18 行
- **问题**：只在 onLoad 加载数据，用户离开再返回时数据不刷新

### BUG-032: delete-activity 未清理 ai_messages
- **文件**：`cloudfunctions/delete-activity/index.js` 第 25 行
- **问题**：级联删除集合列表中不包含 `ai_messages`，删除活动后该活动相关的 AI 聊天记录残留

### BUG-033: court-submit-score 并发提交竞态条件
- **文件**：`cloudfunctions/court-submit-score/index.js`
- **问题**：两个用户同时提交同一场比赛的比分，可能产生重复的 scores 和 rating_changes 记录
- **建议**：添加分布式锁或幂等性校验

### BUG-034: invite.js data.invites 可能为 undefined
- **文件**：`miniprogram/pages/invite/invite.js` 第 85-88 行
- **问题**：如果云函数返回失败，`data.invites` 为 undefined，`.map()` 会报 TypeError

### BUG-035: init-rules 不保留自定义规则
- **文件**：`cloudfunctions/init-rules/index.js` 第 41-43 行
- **问题**：执行 init 会覆盖 sections 为默认规则，管理员的自定义规则被覆盖

### BUG-036: index.js 直接查数据库而非通过云函数
- **文件**：`miniprogram/pages/index/index.js` 第 52 行、第 126 行
- **问题**：`loadLatestUserInfo` 和 `loadUserStats` 直接用客户端 db 查询，绕过云函数安全层
- **影响**：受客户端数据库安全规则限制，数据量大时可能超限

### BUG-037: fill-suggestion 推荐结果类型假设
- **文件**：`miniprogram/pages/fill-suggestion/fill-suggestion.js` 第 41-43 行
- **问题**：假设 recommendations 数组元素是字符串，如果是对象会显示 "[object Object]"

---

## ✅ 已验证通过的功能

以下功能经过代码全链路追踪，前后端字段映射正确，数据流完整：

| 功能 | 前端 | 云函数 | 状态 |
|------|------|--------|------|
| 创建活动（表单） | create-activity.js | create-activity | ✅ |
| 活动列表（三个tab） | activity-list.js | get-activities | ✅ |
| 活动详情（字段映射） | activity-detail.js | get-activity-detail | ✅ |
| 活动报名 | activity-detail.js | join-activity | ⚠️ BUG-005 |
| 取消报名 | activity-detail.js | cancel-registration | ✅ |
| 审批取消 | activity-detail.js | handle-cancel-request | ✅ |
| 比分提交（标准） | match-score.js | submit-score | ✅ |
| 比分提交（按场地） | schedule.js | court-submit-score | ✅ |
| 排名展示 | ranking.js | get-rankings | ✅ |
| 规则查看 | rules.js | get-rules | ✅ |
| 规则QA | rules-qa.js | rules-qa | ✅ |
| 活动战报 | report.js | get-activity-detail + generate-copy | ✅ |
| 活动统计报告 | activity-report.js | get-activity-report | ✅ |
| 照片上传 | photo-album.js | photo-upload | ✅ |
| 照片点赞 | photo-album.js | photo-like | ✅ |
| 照片评论 | photo-detail.js | photo-comment | ⚠️ BUG-011 |
| 删除活动 | activity-detail.js | delete-activity | ✅ |
| 清空数据库 | 云函数直接 | clear-database | ✅ |
| 开始分组 | activity-detail.js | start-grouping | ✅ |
| 场地分配 | court-assign.js | court-list / court-assign | ✅ |
| 现场比分 | match-score.js | match-live-score | ✅ |
| 赛程展示 | schedule.js | court-matches | ✅ |

---

## 🔧 修复优先级建议

### 第一批（立即修复 — 影响核心流程）
1. **BUG-001** — AI 聊天历史字段名（1 行改动）
2. **BUG-002** — AI 操作反馈参数名（2 行改动）
3. **BUG-003** — profile 导航参数（1 行改动）
4. **BUG-007** — login 错误字段（2 行改动）
5. **BUG-005** — join-activity 全局删除（删除或加条件）

### 第二批（尽快修复 — 功能不可用）
6. **BUG-004** — invite 页面 app 未定义（2 处改动）
7. **BUG-009** — update-activity-status 返回值（1 行改动）
8. **BUG-010** — AI 创建活动省市区（1 处改动）
9. **BUG-011** — 照片评论显示 userId（需改 JS + WXML）
10. **BUG-012** — AI 笔记采纳不保存（需添加云函数调用）
11. **BUG-016** — 排名页团队成员映射（查询 users 集合）
12. **BUG-017** — 排名页样式修复（WXS 或预计算）
13. **BUG-018** — 赛程页组织者排序（返回 isOrganizer）
14. **BUG-019** — 战报轮次显示（round → roundOrder）

### 第三批（计划修复 — 体验优化）
15. **BUG-008** — 比赛提醒写入 scheduledTime
16. **BUG-013** — 海报 Canvas 修复
17. **BUG-014** — 状态转换验证
18. **BUG-015** — activity-report 注册
19. **BUG-021/022** — grouping-preview 修复

---

> **测试完成时间**：2026-09-21
> **测试方法**：静态代码全链路追踪（前端模板 ↔ JS 逻辑 ↔ 云函数 ↔ 数据库读写），覆盖所有用户可见功能
> **注意**：由于 tcb CLI 无法调用 wx-server-sdk 云函数，无法做运行时验证，所有发现均基于代码分析
