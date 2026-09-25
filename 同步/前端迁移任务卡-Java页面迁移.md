# 前端迁移任务卡 —— 从 Java 项目挪页面代码

> **源项目**：`D:\project\badminton-app-java\miniprogram`
> **目标项目**：`D:\project\badminton-app\badminton-app\miniprogram`
> **原则**：以 Java 项目的前端代码为准，直接迁移页面代码（wxml + js + wxss），适配云函数调用方式

---

## 一、页面差异总览

### Java 项目有、小程序缺失的页面（需新建）

| # | 页面 | 功能 | 优先级 |
|---|------|------|--------|
| 1 | `my-summary` | 个人赛季/年度总结（含AI生成文案） | P0 |
| 2 | `schedule` | 比赛顺序调整（上移/下移） | P0 |
| 3 | `activity-report` | 活动战报（AI文案+徽章+分享） | P0 |
| 4 | `invite` | 智能邀约（AI生成邀请语） | P0 |
| 5 | `grouping-preview` | AI分组预览（含AI通俗解释） | P1 |
| 6 | `fill-suggestion` | 补位推荐（候补队列+候选推荐） | P1 |
| 7 | `court-assign` | 场地分配管理（按场地双打专用） | P1 |
| 8 | `ai-feature` | AI精选建议（照片精选） | P2 |
| 9 | `ai-note-preview` | AI小记预览 | P2 |

### Java 项目有、小程序缺失的组件（需新建）

| # | 组件 | 功能 | 优先级 |
|---|------|------|--------|
| 1 | `ai-suggestion` | AI建议卡片（预填确认/还原） | P0 |
| 2 | `match-reminder` | 比赛提醒横幅 | P1 |
| 3 | `score-slider` | 分数滑块（快捷选择+滑动） | P2 |

### 共享页面差异（需覆盖更新）

| 页面 | Java 版本新增功能 | 优先级 |
|------|------------------|--------|
| `create-activity` | AI输入框+ai-suggestion组件+省市区picker+地图选点+智能推荐开赛时间+创建后提示 | P0 |
| `activity-detail` | match-reminder组件+相册入口+容量调整+比赛顺序入口 | P0 |
| `album`（对应 `photo-album`） | AI精选+AI小记+分享海报+评论面板+编辑相册信息 | P1 |
| `activity-list` | 更丰富的筛选交互 | P2 |

---

## 二、逐页面迁移任务

### 任务 1：新建 `my-summary` 页面（个人总结）

**源文件**：`D:\project\badminton-app-java\miniprogram\pages\my-summary\`

**迁移内容**：
- `my-summary.wxml` — 赛季/年度切换、统计卡片、亮点、徽章、AI文案、复制/分享
- `my-summary.js` — 调用 `/user/summary` 接口，需适配为云函数调用
- `my-summary.wxss` — 样式直接复制

**适配要点**：
- Java 用 `get('/user/summary', params)` → 改为 `callFunction('get-rankings', 'user-summary', params)`
- Java 用 `app.globalData.aiEnabled` → 保留
- 分享功能 `open-type="share"` + `onShareAppMessage` 保留

**app.json 注册**：添加 `"pages/my-summary/my-summary"`

**验收标准**：
- 赛季/年度切换正常
- 统计卡片显示（活动场次/比赛局数/胜率/场均净胜分/最高连胜/水平分变化）
- 亮点显示（最佳搭档/最大分差胜利/常去场地）
- 徽章显示
- AI文案显示+复制+分享

---

### 任务 2：新建 `schedule` 页面（比赛顺序）

**源文件**：`D:\project\badminton-app-java\miniprogram\pages\schedule\`

**迁移内容**：
- `schedule.wxml` — 比赛列表+上移/下移+保存
- `schedule.js` — 调用 `/match/order` 接口
- `schedule.wxss` — 样式直接复制

**适配要点**：
- Java 用 `get('/match/order')` → 改为 `callFunction('get-match-detail', 'order', { activityId })`
- Java 用 `put('/match/order', { matchIds })` → 改为 `callFunction('get-match-detail', 'save-order', { activityId, matchIds })`
- Java 用 `require('../../utils/utils')` 的 `getTeamDisplayName` / `formatMemberNames` → 需在小程序 utils 中实现或内联

**app.json 注册**：添加 `"pages/schedule/schedule"`

**验收标准**：
- 比赛列表正确显示（队伍名/成员/状态）
- 上移/下移操作正常
- 保存顺序成功
- 已锁定状态不可编辑

---

### 任务 3：新建 `activity-report` 页面（活动战报）

**源文件**：`D:\project\badminton-app-java\miniprogram\pages\activity-report\`

**迁移内容**：
- `activity-report.wxml` — 战报状态（生成中/失败/完成/无）+徽章+跳转个人总结
- `activity-report.js` — 调用 `/activity/{id}/report` + `/activity/{id}/badges`
- `activity-report.wxss` — 样式直接复制

**适配要点**：
- Java 用 `get('/activity/${id}/report')` → 改为 `callFunction('generate-copy', 'report', { activityId })`
- Java 用 `get('/activity/${id}/badges')` → 改为 `callFunction('get-rankings', 'badges', { activityId })`
- Java 用 `post('/activity/${id}/report/regenerate')` → 改为 `callFunction('generate-copy', 'regenerate-report', { activityId })`
- 跳转 `my-summary` 页面保留

**app.json 注册**：添加 `"pages/activity-report/activity-report"`

**验收标准**：
- 战报状态正确显示（生成中/失败/完成/无）
- 战报内容可复制
- 徽章列表显示
- 组织者可重新生成
- 跳转个人总结正常

---

### 任务 4：新建 `invite` 页面（智能邀约）

**源文件**：`D:\project\badminton-app-java\miniprogram\pages\invite\`

**迁移内容**：
- `invite.wxml` — 候选球友列表+选择+生成邀请语+复制
- `invite.js` — 调用 `/activity/{id}/invite-candidates` + `/ai/invite`
- `invite.wxss` — 样式直接复制

**适配要点**：
- Java 用 `get('/activity/${id}/invite-candidates')` → 改为 `callFunction('invite-candidates', 'list', { activityId })`
- Java 用 `post('/ai/invite', { activityId, candidateIds })` → 改为 `callFunction('invite', 'generate', { activityId, candidateIds })`
- `app.globalData.aiEnabled` 保留

**app.json 注册**：添加 `"pages/invite/invite"`

**验收标准**：
- 候选球友列表显示（头像/昵称/等级/水平分/推荐理由）
- 最多选择10人
- 生成邀请语成功
- 复制邀请语成功
- AI未开启时提示

---

### 任务 5：新建 `grouping-preview` 页面（AI分组预览）

**源文件**：`D:\project\badminton-app-java\miniprogram\pages\grouping-preview\`

**迁移内容**：
- `grouping-preview.wxml` — 分组规则+分组理由+AI通俗解释+队伍方案+确认分组
- `grouping-preview.js` — 调用分组预览接口
- `grouping-preview.wxss` — 样式直接复制

**适配要点**：
- Java 用 `get('/activity/${id}/grouping-preview')` → 改为 `callFunction('start-grouping', 'preview', { activityId })`
- Java 用 `post('/activity/${id}/grouping/confirm')` → 改为 `callFunction('start-grouping', 'confirm', { activityId })`
- AI通俗解释 toggle 保留

**app.json 注册**：添加 `"pages/grouping-preview/grouping-preview"`

**验收标准**：
- 分组规则显示
- 分组理由显示
- AI通俗解释可展开/收起
- 队伍方案显示（成员/水平分/等级）
- 确认分组成功
- 搭档重复提示

---

### 任务 6：新建 `fill-suggestion` 页面（补位推荐）

**源文件**：`D:\project\badminton-app-java\miniprogram\pages\fill-suggestion\`

**迁移内容**：
- `fill-suggestion.wxml` — 概况卡片+AI提示+候补队列+候选推荐
- `fill-suggestion.js` — 调用补位推荐接口
- `fill-suggestion.wxss` — 样式直接复制

**适配要点**：
- Java 用 `get('/activity/${id}/fill-suggestion')` → 改为 `callFunction('get-fill-suggestions', 'list', { activityId })`
- 候选推荐复制功能保留

**app.json 注册**：添加 `"pages/fill-suggestion/fill-suggestion"`

**验收标准**：
- 概况卡片显示（当前人数/候补人数/配对缺口/开赛缺口）
- 候补队列显示
- 候选推荐显示（水平分/推荐理由/最近参与）
- 复制候选信息成功

---

### 任务 7：新建 `court-assign` 页面（场地分配）

**源文件**：`D:\project\badminton-app-java\miniprogram\pages\court-assign\`

**迁移内容**：
- `court-assign.wxml` — 场地配置+场地列表+成员分配+移动+自动分配+就绪检查+开始分组
- `court-assign.js` — 调用场地相关接口
- `court-assign.wxss` — 样式直接复制

**适配要点**：
- Java 用 `get('/activity/${id}/courts')` → 改为 `callFunction('court-list', 'list', { activityId })`
- Java 用 `post('/activity/${id}/courts')` → 改为 `callFunction('court-add', 'add', { activityId })`
- Java 用 `put('/court/${id}/members')` → 改为 `callFunction('court-assign', 'assign', { courtId, userIds })`
- Java 用 `post('/activity/${id}/court-auto-assign')` → 改为 `callFunction('court-assign', 'auto', { activityId })`
- Java 用 `post('/activity/${id}/court-check-ready')` → 改为 `callFunction('court-ready', 'check', { activityId })`
- Java 用 `post('/activity/${id}/court-start-grouping')` → 改为 `callFunction('court-start', 'start', { activityId })`

**app.json 注册**：添加 `"pages/court-assign/court-assign"`

**验收标准**：
- 场地配置（每场人数）正常
- 场地列表显示
- 成员分配/移动正常
- 自动分配正常
- 就绪检查正常
- 开始分组正常

---

### 任务 8：新建 `ai-feature` 页面（AI精选建议）

**源文件**：`D:\project\badminton-app-java\miniprogram\pages\ai-feature\`

**迁移内容**：
- `ai-feature.wxml` — 精选建议列表+勾选+一键采用
- `ai-feature.js` — 调用 `/activity/{id}/album/ai-feature`
- `ai-feature.wxss` — 样式直接复制

**适配要点**：
- Java 用 `post('/activity/${id}/album/ai-feature')` → 改为 `callFunction('photo-feature', 'ai-suggest', { activityId })`
- Java 用 `post('/activity/${id}/album/apply-features', { photoIds })` → 改为 `callFunction('photo-feature', 'apply', { activityId, photoIds })`
- 图片URL拼接 `app.globalData.baseUrl` → 改为云存储 URL

**app.json 注册**：添加 `"pages/ai-feature/ai-feature"`

**验收标准**：
- 生成精选建议成功
- 建议列表显示（缩略图+推荐理由）
- 勾选/取消勾选正常
- 一键采用成功

---

### 任务 9：新建 `ai-note-preview` 页面（AI小记预览）

**源文件**：`D:\project\badminton-app-java\miniprogram\pages\ai-note-preview\`

**迁移内容**：
- `ai-note-preview.wxml` — 标题+内容+来源+采用/不用/重试+复制
- `ai-note-preview.js` — 调用 AI 小记接口
- `ai-note-preview.wxss` — 样式直接复制

**适配要点**：
- Java 用 `post('/activity/${id}/album/ai-note')` → 改为 `callFunction('photo-ai-note', 'generate', { activityId })`
- 采用/重试逻辑保留

**app.json 注册**：添加 `"pages/ai-note-preview/ai-note-preview"`

**验收标准**：
- AI小记生成成功
- 来源显示（AI生成/模板）
- 采用/不用/重试正常
- 复制文案成功

---

### 任务 10：新建 3 个组件

**源文件**：`D:\project\badminton-app-java\miniprogram\components\`

#### 10.1 `ai-suggestion` 组件
- `ai-suggestion.wxml` — 骨架屏+AI卡片（图标+标题+描述+确认/取消按钮）
- `ai-suggestion.js` — 组件逻辑
- `ai-suggestion.wxss` — 样式
- `ai-suggestion.json` — 组件声明

#### 10.2 `match-reminder` 组件
- `match-reminder.wxml` — 提醒横幅（圆点+标题+内容+箭头）
- `match-reminder.js` — 组件逻辑
- `match-reminder.wxss` — 样式
- `match-reminder.json` — 组件声明

#### 10.3 `score-slider` 组件
- `score-slider.wxml` — 快捷分数按钮+滑动条+输入框+分数说明
- `score-slider.js` — 组件逻辑
- `score-slider.wxss` — 样式
- `score-slider.json` — 组件声明

**验收标准**：
- 组件可正常引入和使用
- 事件传递正确

---

### 任务 11：更新 `create-activity` 页面

**源文件**：`D:\project\badminton-app-java\miniprogram\pages\create-activity\`

**需迁移的功能**：
1. **AI 输入框** — 顶部 AI 输入框 + 发送按钮
2. **ai-suggestion 组件** — AI 预填确认/还原
3. **省市区 picker** — `mode="region"` 选择省/市/区
4. **地图选点** — `wx.chooseLocation` 获取经纬度
5. **智能推荐开赛时间** — 调用 `/activity/recommend-time`
6. **court-doubles 人数配置** — 每场人数输入
7. **"创建后会发生什么"提示** — 底部提示文案

**适配要点**：
- Java 用 `post('/ai/parse-activity', { message })` → 改为 `callFunction('parse-activity', 'parse', { message })`
- Java 用 `get('/activity/recommend-time', params)` → 改为 `callFunction('recommend-time', 'recommend', params)`
- Java 用 `post('/activity', payload)` → 改为 `callFunction('create-activity', 'create', payload)`
- `require('../../utils/request')` 的 `post/get` → 改为 `callFunction`

**验收标准**：
- AI 输入框显示+解析正常
- ai-suggestion 组件显示+确认/还原正常
- 省市区 picker 正常
- 地图选点正常
- 智能推荐开赛时间正常
- court-doubles 每场人数配置正常
- "创建后会发生什么"提示显示

---

### 任务 12：更新 `activity-detail` 页面

**需迁移的功能**：
1. **match-reminder 组件** — 比赛提醒横幅
2. **相册入口** — 显示相册照片数量+跳转
3. **容量调整** — 组织者可调整报名人数上限
4. **比赛顺序入口** — 跳转 schedule 页面

**适配要点**：
- 相册入口调用 `callFunction('photo-upload', 'count', { activityId })`
- 容量调整调用 `callFunction('update-activity-status', 'update-capacity', { activityId, maxPlayers })`
- 比赛顺序跳转 `/pages/schedule/schedule?activityId=xxx`

**验收标准**：
- match-reminder 组件显示
- 相册入口显示照片数量
- 容量调整正常
- 比赛顺序跳转正常

---

### 任务 13：更新 `album` 页面（对应 `photo-album`）

**需迁移的功能**：
1. **AI 精选** — 跳转 ai-feature 页面
2. **AI 小记** — 跳转 ai-note-preview 页面
3. **分享海报** — Canvas 生成海报+保存/分享
4. **评论面板** — 评论列表+输入+删除
5. **编辑相册信息** — 标题+描述编辑
6. **精选/全部 tab** — 筛选照片

**验收标准**：
- AI 精选跳转正常
- AI 小记跳转正常
- 分享海报生成+保存正常
- 评论功能正常
- 编辑相册信息正常

---

## 三、执行顺序

| 阶段 | 任务 | 预估工时 |
|------|------|---------|
| 第一天 | 任务 10（3个组件）+ 任务 1（my-summary） | 4h |
| 第二天 | 任务 2（schedule）+ 任务 3（activity-report）+ 任务 4（invite） | 6h |
| 第三天 | 任务 5（grouping-preview）+ 任务 6（fill-suggestion）+ 任务 7（court-assign） | 6h |
| 第四天 | 任务 8（ai-feature）+ 任务 9（ai-note-preview）+ 任务 11（create-activity更新） | 5h |
| 第五天 | 任务 12（activity-detail更新）+ 任务 13（album更新）+ 自测 | 5h |

**总计约 26 人时（5 天）**

---

## 四、注意事项

1. **云函数调用方式**：Java 用 `get/post` → 统一改为 `callFunction(name, action, data)`
2. **URL 拼接**：Java 用 `app.globalData.baseUrl + path` → 小程序用云函数不需要
3. **图片 URL**：Java 用相对路径 → 小程序用云存储 fileID
4. **utils 依赖**：Java 的 `require('../../utils/utils')` → 需检查小程序 utils 是否有对应函数
5. **app.json 注册**：每个新页面必须注册
6. **组件注册**：每个新组件必须在页面的 json 中声明
