# UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将羽毛球小程序现有页面统一为“清爽运动工具风”，在不改变业务流程的前提下提升整体质感、信息层级和页面一致性。

**Architecture:** 先收敛全局样式基座，再分批改造首页/列表页、详情/表单页、排名/赛事页。实现以 `app.wxss` 的设计令牌和通用组件规则为核心，页面层只做必要的结构调整与样式落地，尽量不触碰业务逻辑。

**Tech Stack:** 微信小程序原生页面（`wxml`、`wxss`、`js`）、微信云开发现有数据接口、手动视觉回归验证

---

## File Structure

本次实现涉及的主要文件与职责如下：

- `miniprogram/app.wxss`
  - 定义全局颜色、阴影、圆角、卡片、按钮、状态标签、空状态、页面头部等统一视觉规则。
- `miniprogram/app.json`
  - 统一导航栏和 tabBar 的品牌色与页面整体基调。
- `miniprogram/pages/index/index.wxml`
  - 重组登录页、首页欢迎区、快捷入口和活动分区结构。
- `miniprogram/pages/index/index.wxss`
  - 首页与登录页的视觉实现。
- `miniprogram/pages/index/index.js`
  - 仅补充轻量展示字段或分组辅助数据，避免改动业务流程。
- `miniprogram/pages/activity-list/activity-list.wxml`
  - 统一搜索区、Tab、活动卡片信息顺序和空状态结构。
- `miniprogram/pages/activity-list/activity-list.wxss`
  - 列表页视觉统一与卡片规范落地。
- `miniprogram/pages/activity-detail/activity-detail.wxml`
  - 将详情页拆分为概览、报名、用户操作、组织者操作、比赛安排等模块。
- `miniprogram/pages/activity-detail/activity-detail.wxss`
  - 详情页模块化视觉体系与赛事区块强化。
- `miniprogram/pages/create-activity/create-activity.wxml`
  - 统一表单分组、提示区和提交区结构。
- `miniprogram/pages/create-activity/create-activity.wxss`
  - 表单页面视觉统一。
- `miniprogram/pages/ranking/ranking.wxml`
  - 收敛排名页结构，优化头部、列表项和前三高亮。
- `miniprogram/pages/ranking/ranking.wxss`
  - 排名页和荣誉态样式统一。

说明：

- 本次计划不改动云函数。
- 本次计划不新增测试框架；验证以手动页面回归为主。
- 如果某一步需要少量 `js` 适配，应限制为展示层辅助字段，不扩散到业务规则。

### Task 1: 建立全局视觉基座

**Files:**
- Modify: `miniprogram/app.wxss`
- Modify: `miniprogram/app.json`

- [ ] **Step 1: 写一份全局视觉验收清单，先定义“失败标准”**

在本地记录并执行以下验收点，当前版本应至少有 4 项不满足：

```text
1. 首页、列表页、详情页的卡片圆角、阴影、边框是否统一
2. 主按钮、次按钮、危险按钮是否有稳定规则
3. 状态标签在不同页面是否同语义同形态
4. 背景层级是否统一为“页面底色 + 白卡片 + 少量强调卡片”
5. 导航栏和 tabBar 是否与页面主视觉一致
```

- [ ] **Step 2: 先读取当前全局样式并确认要替换的令牌范围**

Run: `Get-Content miniprogram\app.wxss`

Expected: 能看到现有 `--primary-color`、`--shadow-*`、`.btn-*`、`.card`、`.status-*` 等定义，说明全局基座可以直接扩展，而不是另起一套样式。

- [ ] **Step 3: 在 `app.wxss` 中统一设计令牌和通用规则**

将全局变量和通用类向下列方向收敛：

```css
page {
  background:
    radial-gradient(circle at top, #f3fbf8 0%, #eef4f2 24%, #f7f9f8 58%, #f5f7f6 100%);
  --primary-color: #0ea56b;
  --primary-dark: #0a7b50;
  --primary-light: #e8f7f0;
  --primary-contrast: #ffffff;
  --surface-page: rgba(255, 255, 255, 0.78);
  --surface-card: #ffffff;
  --surface-muted: #f4f7f6;
  --surface-strong: linear-gradient(135deg, #f5fffb 0%, #eef8f5 100%);
  --text-primary: #17332a;
  --text-secondary: #4b625a;
  --text-tertiary: #7e938c;
  --border-light: rgba(16, 73, 52, 0.08);
  --shadow-card: 0 12rpx 36rpx rgba(15, 65, 47, 0.08);
  --shadow-strong: 0 18rpx 42rpx rgba(14, 77, 57, 0.12);
}

.card {
  background: var(--surface-card);
  border-radius: 28rpx;
  border: 1rpx solid var(--border-light);
  box-shadow: var(--shadow-card);
}

.btn-primary {
  background: linear-gradient(135deg, #11b574 0%, #0f9e66 100%);
  box-shadow: 0 12rpx 28rpx rgba(17, 181, 116, 0.24);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.92);
  color: var(--primary-dark);
  border: 2rpx solid rgba(14, 165, 107, 0.18);
}

.btn-danger {
  background: rgba(255, 244, 244, 0.96);
  color: #d64545;
  border: 2rpx solid rgba(214, 69, 69, 0.14);
}
```

- [ ] **Step 4: 在 `app.json` 中同步导航栏和 tabBar 主题**

目标是让导航栏和 tabBar 不再是单独一层“老样式绿”，而是跟页面统一。

```json
{
  "window": {
    "backgroundTextStyle": "dark",
    "navigationBarBackgroundColor": "#f5f8f7",
    "navigationBarTitleText": "羽毛球",
    "navigationBarTextStyle": "black"
  },
  "tabBar": {
    "color": "#73867f",
    "selectedColor": "#0ea56b",
    "backgroundColor": "#fbfcfc",
    "borderStyle": "black"
  }
}
```

- [ ] **Step 5: 手动检查全局基座是否生效**

Run: 打开微信开发者工具并重新编译首页、活动列表页

Expected:

```text
1. 页面底色更轻、更通透
2. 默认卡片阴影和边框已经更统一
3. 导航栏与 tabBar 的颜色明显收敛，不再突兀
```

- [ ] **Step 6: Commit**

```bash
git add miniprogram/app.wxss miniprogram/app.json
git commit -m "style: unify global visual foundation"
```

### Task 2: 改造首页与活动列表页

**Files:**
- Modify: `miniprogram/pages/index/index.wxml`
- Modify: `miniprogram/pages/index/index.wxss`
- Modify: `miniprogram/pages/index/index.js`
- Modify: `miniprogram/pages/activity-list/activity-list.wxml`
- Modify: `miniprogram/pages/activity-list/activity-list.wxss`

- [ ] **Step 1: 定义首页和列表页的页面级验收点**

```text
1. 登录页是否像产品欢迎页，而不是模板页
2. 首页是否形成“欢迎卡 + 快捷入口 + 活动分区”三段结构
3. 活动列表卡片是否能 1 秒看清名称、状态、时间地点和人数
4. 搜索栏和 Tab 是否更精致、层级更稳
```

- [ ] **Step 2: 重构首页 `index.wxml` 的结构**

首页目标结构如下：

```xml
<view class="home-shell">
  <view class="hero-card">...</view>
  <view class="action-grid">...</view>
  <view class="section-card">...</view>
  <view class="section-card">...</view>
  <view class="section-card">...</view>
</view>
```

登录页目标结构如下：

```xml
<view class="login-shell">
  <view class="login-hero">...</view>
  <view class="login-value-list">...</view>
  <button class="btn-login">微信授权登录</button>
</view>
```

- [ ] **Step 3: 在 `index.wxss` 中落地首页和登录页视觉**

重点实现以下规则：

```css
.hero-card {
  background: linear-gradient(145deg, #103c31 0%, #18614f 55%, #1f7f67 100%);
  color: #ffffff;
  border-radius: 36rpx;
  box-shadow: 0 20rpx 48rpx rgba(16, 60, 49, 0.22);
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24rpx;
}

.action-item {
  background: rgba(255, 255, 255, 0.94);
  border: 1rpx solid rgba(14, 165, 107, 0.08);
  box-shadow: 0 10rpx 28rpx rgba(22, 78, 58, 0.08);
}
```

- [ ] **Step 4: 仅在必要时补充首页展示层辅助字段**

如果需要展示欢迎副标题或活动数量摘要，只在 `index.js` 增加轻量派生数据，例如：

```js
const myCount = (res.result.data || []).length;
this.setData({
  myActivities: res.result.data || [],
  myActivityCount: myCount
});
```

限制：

- 不改动登录流程
- 不改动活动查询参数
- 不改动页面跳转逻辑

- [ ] **Step 5: 重构活动列表页结构与卡片信息顺序**

列表卡片应稳定成以下顺序：

```xml
<view class="activity-card">
  <view class="card-top">
    <text class="activity-name">{{item.name}}</text>
    <view class="status-badge ...">...</view>
  </view>
  <view class="meta-row">时间 / 地点 / 类型</view>
  <view class="progress-row">人数进度</view>
</view>
```

空状态建议统一为：

```xml
<view class="empty-tip">
  <text class="empty-icon">🏸</text>
  <text class="empty-text">暂无相关活动</text>
  <text class="empty-desc">试试切换标签或创建一场新活动</text>
</view>
```

- [ ] **Step 6: 在 `activity-list.wxss` 中统一搜索栏、Tab 和卡片**

```css
.search-bar {
  background: transparent;
  padding: 24rpx 24rpx 8rpx;
}

.search-input-wrap {
  background: rgba(255, 255, 255, 0.92);
  border: 1rpx solid rgba(18, 74, 54, 0.08);
  box-shadow: 0 10rpx 24rpx rgba(20, 72, 54, 0.06);
}

.tab-header {
  background: rgba(255, 255, 255, 0.9);
  border-radius: 24rpx;
}

.activity-card {
  border-radius: 28rpx;
  background: rgba(255, 255, 255, 0.96);
}
```

- [ ] **Step 7: 手动验证首页和活动列表页**

Run: 在微信开发者工具中打开 `pages/index/index`、`pages/activity-list/activity-list`

Expected:

```text
1. 登录页像产品欢迎页，按钮和文案聚焦
2. 首页三段结构清晰，欢迎卡最强、列表分区次之
3. 列表卡片扫读更快，搜索栏和 Tab 更稳
4. 空状态和进度区与全局风格统一
```

- [ ] **Step 8: Commit**

```bash
git add miniprogram/pages/index/index.wxml miniprogram/pages/index/index.wxss miniprogram/pages/index/index.js miniprogram/pages/activity-list/activity-list.wxml miniprogram/pages/activity-list/activity-list.wxss
git commit -m "style: refresh home and activity list pages"
```

### Task 3: 改造活动详情页与创建活动页

**Files:**
- Modify: `miniprogram/pages/activity-detail/activity-detail.wxml`
- Modify: `miniprogram/pages/activity-detail/activity-detail.wxss`
- Modify: `miniprogram/pages/activity-detail/activity-detail.js`
- Modify: `miniprogram/pages/create-activity/create-activity.wxml`
- Modify: `miniprogram/pages/create-activity/create-activity.wxss`

- [ ] **Step 1: 先定义详情页和表单页的验收目标**

```text
1. 详情页是否从“内容堆叠”变成“信息分组”
2. 当前用户相关状态是否优先可见
3. 组织者操作是否有清楚边界
4. 创建活动页是否更像引导式表单，而不是一串输入项
```

- [ ] **Step 2: 重组 `activity-detail.wxml` 的模块边界**

按以下模块排列：

```xml
<view class="detail-shell">
  <view class="overview-card">...</view>
  <view class="section-card registration-section">...</view>
  <view class="section-card action-section">...</view>
  <view class="section-card organizer-section">...</view>
  <view class="section-card matches-section">...</view>
  <view class="section-card ranking-entry">...</view>
</view>
```

要求：

- 用户相关按钮紧跟报名信息
- 组织者按钮单独放入组织者区
- 比赛安排区保留赛事感，但不与基础信息混杂

- [ ] **Step 3: 在 `activity-detail.wxss` 中统一详情页模块和赛事区块**

```css
.overview-card {
  background: linear-gradient(145deg, #f9fffc 0%, #eff8f4 100%);
  border: 1rpx solid rgba(14, 165, 107, 0.12);
  box-shadow: 0 18rpx 40rpx rgba(16, 74, 54, 0.08);
}

.section {
  border-radius: 28rpx;
  background: rgba(255, 255, 255, 0.96);
}

.match-card {
  border-radius: 30rpx;
  overflow: hidden;
}
```

同时收敛以下内容：

- 删除按钮改为危险按钮语义
- 报名状态、取消状态、待确认状态统一标签规则
- 比赛进行中和待确认只保留轻量动效

- [ ] **Step 4: 只在 `activity-detail.js` 中添加必要的展示辅助，不碰业务规则**

若需要补充展示字段，只允许类似：

```js
const registrationCount = (data.registrations || []).length;
this.setData({
  registrations: data.registrations || [],
  registrationCount
});
```

不允许：

- 修改比赛流转条件
- 修改报名逻辑
- 修改任何云函数参数语义

- [ ] **Step 5: 重构 `create-activity.wxml` 为引导式表单结构**

结构目标：

```xml
<view class="page-shell">
  <view class="form-hero">...</view>
  <view class="form-section">基础信息</view>
  <view class="form-section">时间与地点</view>
  <view class="tip-section">创建说明</view>
  <view class="submit-bar">...</view>
</view>
```

- [ ] **Step 6: 在 `create-activity.wxss` 中统一控件和表单层级**

```css
.form-section {
  border-radius: 28rpx;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 12rpx 32rpx rgba(15, 70, 51, 0.08);
}

.type-btn.active {
  background: linear-gradient(135deg, #effbf5 0%, #e5f6ee 100%);
  border-color: rgba(14, 165, 107, 0.28);
}

.btn-submit {
  border-radius: 999rpx;
}
```

- [ ] **Step 7: 手动验证详情页和创建活动页**

Run: 打开 `pages/activity-detail/activity-detail` 和 `pages/create-activity/create-activity`

Expected:

```text
1. 活动概览、报名、用户操作、组织者操作、比赛安排的分组清楚
2. 删除和取消类操作明显与主操作区分
3. 表单输入、切换、选择器的样式统一
4. 说明区和提交区视觉关系清楚，不喧宾夺主
```

- [ ] **Step 8: Commit**

```bash
git add miniprogram/pages/activity-detail/activity-detail.wxml miniprogram/pages/activity-detail/activity-detail.wxss miniprogram/pages/activity-detail/activity-detail.js miniprogram/pages/create-activity/create-activity.wxml miniprogram/pages/create-activity/create-activity.wxss
git commit -m "style: refresh detail and create activity pages"
```

### Task 4: 改造排名页与赛事视觉收口

**Files:**
- Modify: `miniprogram/pages/ranking/ranking.wxml`
- Modify: `miniprogram/pages/ranking/ranking.wxss`
- Modify: `miniprogram/pages/ranking/ranking.js`

- [ ] **Step 1: 定义排名页收口验收点**

```text
1. 前三名是否有荣誉感但不过分跳脱
2. 普通名次是否更像统一的工具型列表
3. 分数、等级、成员信息是否更清楚
4. 排名页是否与首页、列表页、详情页属于同一产品
```

- [ ] **Step 2: 调整 `ranking.wxml` 的结构与信息顺序**

个人榜结构目标：

```xml
<view class="ranking-item">
  <view class="rank-badge">...</view>
  <view class="ranking-avatar">...</view>
  <view class="user-info">昵称 / 等级</view>
  <view class="score-info">总分 / 分项</view>
</view>
```

队伍榜结构目标：

```xml
<view class="ranking-item team-item">
  <view class="rank-badge">...</view>
  <view class="team-info-full">队名 / 成员</view>
  <view class="team-score">总分</view>
</view>
```

- [ ] **Step 3: 在 `ranking.wxss` 中收敛奖牌态和普通态**

```css
.ranking-section {
  background: rgba(255, 255, 255, 0.96);
  border-radius: 28rpx;
}

.ranking-item.gold {
  background: linear-gradient(135deg, #fffaf0 0%, #fff2cf 100%);
  border-color: rgba(232, 186, 54, 0.42);
}

.ranking-item:not(.gold):not(.silver):not(.bronze) {
  background: rgba(247, 250, 249, 0.98);
}
```

要求：

- 前三名高亮继续存在，但边框、阴影和色彩比当前更克制
- 普通名次不再像另一套页面风格

- [ ] **Step 4: 仅在 `ranking.js` 中保留必要展示逻辑**

如果要增加头部说明或空状态判断，只允许使用现有数据做轻量派生：

```js
const hasTeamRanking = (data.teamRankings || []).length > 0;
this.setData({
  teamRankings: data.teamRankings || [],
  hasTeamRanking
});
```

禁止修改：

- 排名计算规则
- 监听逻辑语义
- `get-rankings` 云函数的输入输出契约

- [ ] **Step 5: 执行全链路手动回归**

Run: 在微信开发者工具中依次验证：

```text
pages/index/index
pages/activity-list/activity-list
pages/activity-detail/activity-detail
pages/create-activity/create-activity
pages/ranking/ranking
```

Expected:

```text
1. 页面共享同一套圆角、阴影、文字层级和按钮语义
2. 比赛和排名仍有竞技感，但没有压过全局工具属性
3. 主要业务入口能正常点击和跳转
4. 没有明显布局错位、文本遮挡、按钮不可点
```

- [ ] **Step 6: Commit**

```bash
git add miniprogram/pages/ranking/ranking.wxml miniprogram/pages/ranking/ranking.wxss miniprogram/pages/ranking/ranking.js
git commit -m "style: polish ranking and competition visuals"
```

## Self-Review

### 1. Spec coverage

已覆盖规格中的以下部分：

- 全局视觉语言：Task 1
- 首页/登录页：Task 2
- 列表页：Task 2
- 详情页：Task 3
- 创建活动页：Task 3
- 排名页与赛事场景：Task 4
- 动效收敛：Task 3、Task 4
- 不改业务流程：所有任务的限制项已显式声明

未发现遗漏的规格段落。

### 2. Placeholder scan

已检查计划中的任务描述，没有使用 `TBD`、`TODO`、`后续再补`、`写测试` 之类无内容占位语。

### 3. Type consistency

计划中使用的文件路径、页面路径、云函数名称与当前代码库一致：

- `pages/index/index`
- `pages/activity-list/activity-list`
- `pages/activity-detail/activity-detail`
- `pages/create-activity/create-activity`
- `pages/ranking/ranking`
- `get-activities`
- `get-activity-detail`
- `get-rankings`

未引入新的业务接口名。

