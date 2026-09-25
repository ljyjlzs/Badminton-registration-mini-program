# 全量 UI 入口 + 功能缺失清单

> 审计时间：2026-09-05
> 方法：逐页对比 Java 项目 WXML 与当前小程序 WXML 的 bindtap 按钮数量和功能

---

## 一、activity-detail 页面（活动详情）— 缺失最多

**Java 版本：63 个 bindtap | 当前版本：51 个 bindtap | 缺失：12 个入口**

### 缺失的 UI 入口（必须补）

| # | 按钮功能 | 对应方法 | 应该放在哪里 | 优先级 |
|---|---------|---------|------------|-------|
| 1 | **帮人报名入口** | `openAgentModal` | "我的状态"区域，报名按钮下方，添加一个"帮人报名"按钮 | P0 |
| 2 | **AI 文案按钮** | `openAiCopy` | 组织者操作区域，AI 助手区域之前，添加"AI 文案"按钮 | P1 |
| 3 | **智能邀约按钮** | `goToInvite` | 组织者操作区域，nav-buttons 旁边，添加"智能邀约"按钮 | P1 |
| 4 | **天气刷新按钮** | `refreshWeather` | 天气卡片右上角，添加"刷新"文字按钮 | P2 |
| 5 | **取消候补按钮** | `cancelWaitlist` | "我的状态"区域，已报名且是候补状态时显示 | P1 |
| 6 | **解绑搭档按钮** | `unbindPartner` | 固搭模式下，已报名且有搭档时显示 | P1 |
| 7 | **代报人修改等级** | `showAgentLevelPicker` | 代报名单中，每条记录可点击修改等级 | P2 |
| 8 | **取消代报按钮** | `cancelAgentRegistration` | 代报名单中，每条记录可取消 | P1 |
| 9 | **语音确认按钮** | `confirmVoiceScore` | 语音填分弹窗中 | P1 |
| 10 | **语音取消按钮** | `closeVoicePanel` | 语音填分弹窗中 | P1 |
| 11 | **容量调整确认** | `submitCapacity` | 容量调整弹窗中 | P0 |
| 12 | **容量弹窗关闭** | `closeCapacityModal` | 容量调整弹窗中 | P0 |

### 缺失的 JS 方法（必须补）

| # | 方法名 | 功能 | 说明 |
|---|--------|------|------|
| 1 | `openAgentModal` | 打开代报弹窗 | WXML 中有弹窗但无触发按钮 |
| 2 | `openAiCopy` | 打开 AI 文案弹窗 | 复制活动文案 |
| 3 | `refreshWeather` | 刷新天气 | 天气卡片刷新 |
| 4 | `cancelWaitlist` | 取消候补 | 候补人员退出 |
| 5 | `unbindPartner` | 解绑搭档 | 固搭模式解绑 |
| 6 | `showAgentLevelPicker` | 代报等级修改 | 代报列表中修改等级 |
| 7 | `cancelAgentRegistration` | 取消代报 | 代报列表中取消报名 |
| 8 | `confirmVoiceScore` | 语音确认记分 | 语音识别后确认 |
| 9 | `closeVoicePanel` | 关闭语音面板 | 语音识别后取消 |
| 10 | `submitCapacity` | 提交容量调整 | 确认调整人数上限 |
| 11 | `closeCapacityModal` | 关闭容量弹窗 | 取消调整 |
| 12 | `copyCopyText` | 复制 AI 文案 | AI 文案弹窗中复制 |
| 13 | `regenerateCopy` | 重新生成文案 | AI 文案弹窗中重新生成 |
| 14 | `switchCopyTab` | 切换文案 Tab | 公告/分享/邀请切换 |

---

## 二、match-score 页面（记分页）

**Java 版本：4 个 bindtap | 当前版本：10 个 bindtap | 缺失：2 个入口**

### 缺失的 UI 入口

| # | 按钮功能 | 对应方法 | 应该放在哪里 | 优先级 |
|---|---------|---------|------------|-------|
| 1 | **同步现场比分** | `updateLiveScore` | 比赛进行中时，比分输入区域下方 | P1 |
| 2 | **清除现场比分** | `clearLiveScore` | 有现场比分时显示 | P1 |

### 缺失的 JS 方法

| # | 方法名 | 功能 |
|---|--------|------|
| 1 | `updateLiveScore` | 同步现场比分（不影响正式成绩） |
| 2 | `clearLiveScore` | 清除现场比分 |

---

## 三、grouping 页面（分组页）

**Java 版本：11 个 bindtap | 当前版本：7 个 bindtap | 缺失：4 个入口**

### 缺失的 UI 入口

| # | 按钮功能 | 对应方法 | 应该放在哪里 | 优先级 |
|---|---------|---------|------------|-------|
| 1 | **全局横幅点击** | `onGlobalBannerTap` | 横幅本身 | P1 |
| 2 | **语音填分按钮** | `startVoiceInput`/`stopVoiceInput` | 比赛列表下方 | P1 |
| 3 | **语音取消按钮** | `closeVoicePanel` | 语音填分弹窗中 | P1 |
| 4 | **语音确认按钮** | `confirmVoiceScore` | 语音填分弹窗中 | P1 |

### 缺失的 JS 方法

| # | 方法名 | 功能 |
|---|--------|------|
| 1 | `startGlobalReminder` | 启动全局横幅轮询 |
| 2 | `stopGlobalReminder` | 停止全局横幅轮询 |
| 3 | `loadGlobalReminder` | 加载全局横幅数据 |
| 4 | `buildGlobalText` | 构建横幅文本 |
| 5 | `onGlobalBannerTap` | 横幅点击跳转 |
| 6 | `loadVoiceConfig` | 加载语音配置 |
| 7 | `prepareRecorder` | 准备录音器 |
| 8 | `startVoiceInput` | 开始录音 |
| 9 | `doStartRecord` | 执行录音 |
| 10 | `stopVoiceInput` | 停止录音 |
| 11 | `uploadActivityVoice` | 上传语音文件 |
| 12 | `closeVoicePanel` | 关闭语音面板 |
| 13 | `confirmVoiceScore` | 确认语音记分 |

---

## 四、activity-report 页面（战报页）

**Java 版本：3 个 bindtap | 当前版本：4 个 bindtap | 缺失：1 个入口**

### 缺失的 UI 入口

| # | 按钮功能 | 对应方法 | 应该放在哪里 | 优先级 |
|---|---------|---------|------------|-------|
| 1 | **复制战报全文** | `copyReport` | 战报内容下方，添加"复制全文"按钮 | P1 |

### 缺失的 JS 方法

| # | 方法名 | 功能 |
|---|--------|------|
| 1 | `copyReport` | 复制战报全文到剪贴板 |

---

## 五、schedule 页面（赛程页）

**Java 版本：3 个 bindtap | 当前版本：1 个 bindtap | 缺失：2 个入口**

### 缺失的 UI 入口

| # | 按钮功能 | 对应方法 | 应该放在哪里 | 优先级 |
|---|---------|---------|------------|-------|
| 1 | **上移按钮** | `moveUp` | 非 court-doubles 模式下，每场比赛左侧 | P2 |
| 2 | **下移按钮** | `moveDown` | 非 court-doubles 模式下，每场比赛右侧 | P2 |
| 3 | **保存顺序按钮** | `saveOrder` | 页面底部，添加"保存顺序"按钮 | P1 |

### 缺失的 JS 方法

| # | 方法名 | 功能 |
|---|--------|------|
| 1 | `moveUp` | 比赛上移 |
| 2 | `moveDown` | 比赛下移 |
| 3 | `saveOrder` | 保存比赛顺序 |

---

## 六、my-summary 页面（个人数据页）

**Java 版本：3 个 bindtap | 当前版本：3 个 bindtap | 缺失：0 个入口**

✅ 入口完整，无缺失。

---

## 七、create-activity 页面（创建活动页）

**Java 版本：10 个 bindtap | 当前版本：15 个 bindtap | 缺失：0 个入口**

✅ 入口完整，当前版本比 Java 版本多（AI 对话框是额外功能）。

---

## 八、全部缺失汇总

### 按优先级排序

#### P0 — 必须修复（功能不可用）

| # | 页面 | 缺失 | 类型 |
|---|------|------|------|
| 1 | activity-detail | 帮人报名入口按钮 | WXML 按钮 |
| 2 | activity-detail | 容量调整确认按钮 | WXML 按钮 |
| 3 | activity-detail | 容量弹窗关闭按钮 | WXML 按钮 |

#### P1 — 重要功能缺失

| # | 页面 | 缺失 | 类型 |
|---|------|------|------|
| 4 | activity-detail | AI 文案按钮 + 弹窗 | WXML + JS |
| 5 | activity-detail | 智能邀约按钮 | WXML |
| 6 | activity-detail | 取消候补按钮 | WXML |
| 7 | activity-detail | 解绑搭档按钮 | WXML |
| 8 | activity-detail | 取消代报按钮 | WXML |
| 9 | activity-detail | 语音确认/取消按钮 | WXML |
| 10 | activity-detail | copyCopyText/regenerateCopy/switchCopyTab 方法 | JS |
| 11 | match-score | 同步现场比分按钮 | WXML + JS |
| 12 | match-score | 清除现场比分按钮 | WXML + JS |
| 13 | grouping | 全局横幅 + 点击跳转 | WXML + JS |
| 14 | grouping | 语音填分完整流程 | WXML + JS |
| 15 | activity-report | 复制战报全文按钮 | WXML + JS |
| 16 | schedule | 保存顺序按钮 | WXML + JS |

#### P2 — 增强功能

| # | 页面 | 缺失 | 类型 |
|---|------|------|------|
| 17 | activity-detail | 天气刷新按钮 | WXML + JS |
| 18 | activity-detail | 代报人修改等级 | WXML + JS |
| 19 | schedule | 上移/下移按钮 | WXML + JS |

---

## 九、修复指令汇总（给开发）

### 指令 1：activity-detail.wxml 补按钮

在 "我的状态" 区域（报名按钮下方）添加帮人报名和取消候补按钮：

```xml
<!-- 帮人报名 -->
<view wx:if="{{activity.status === 'registering'}}" style="margin-top: 16rpx;">
  <button class="btn-secondary" bindtap="openAgentModal">帮人报名</button>
</view>

<!-- 取消候补（当用户是候补状态时显示） -->
<view wx:if="{{userRegistration && userRegistration.applyStatus === 'waiting'}}">
  <button class="btn-cancel-reg" bindtap="cancelWaitlist">取消候补</button>
</view>
```

在组织者操作区域添加 AI 文案按钮：

```xml
<button class="btn-ai-copy" bindtap="openAiCopy">AI 文案</button>
```

### 指令 2：activity-detail.js 补方法

从 Java 项目复制以下方法，改造为 `callFunction` 调用：
- `openAgentModal`
- `openAiCopy` + `loadAiCopy` + `switchCopyTab` + `copyCopyText` + `regenerateCopy` + `closeAiCopy`
- `refreshWeather`
- `cancelWaitlist`
- `unbindPartner`
- `showAgentLevelPicker` + `cancelAgentRegistration`
- `confirmVoiceScore` + `closeVoicePanel`
- `submitCapacity` + `closeCapacityModal`

### 指令 3：match-score.wxml 补按钮

在比分提交按钮下方添加：

```xml
<button wx:if="{{match && match.status !== 'finished'}}" class="btn-secondary" bindtap="updateLiveScore">同步现场比分</button>
<button wx:if="{{match && match.status !== 'finished'}}" class="btn-cancel-reg" bindtap="clearLiveScore">清除现场比分</button>
```

### 指令 4：match-score.js 补方法

添加 `updateLiveScore` 和 `clearLiveScore` 方法，调用 `match-live-score` 云函数。

### 指令 5：grouping.wxml 补全局横幅和语音

在页面顶部添加全局横幅：

```xml
<view wx:if="{{globalBannerVisible}}" class="global-banner">
  <view wx:if="{{globalCurrentText}}" class="global-banner-row live" bindtap="onGlobalBannerTap">
    <view class="banner-dot"></view>
    <text class="banner-text">{{globalCurrentText}}</text>
  </view>
  <view wx:if="{{globalNextText}}" class="global-banner-row">
    <view class="banner-dot"></view>
    <text class="banner-text">{{globalNextText}}</text>
  </view>
</view>
```

在比赛列表下方添加语音填分按钮和弹窗（参考 Java 版本 grouping.wxml:46-68 和 128-148）。

### 指令 6：activity-report.wxml 补复制按钮

在战报内容下方添加：

```xml
<button wx:if="{{report && report.content}}" class="btn-copy-report" bindtap="copyReport">复制全文</button>
```

### 指令 7：schedule.wxml 补保存按钮

在页面底部添加：

```xml
<button wx:if="{{isOrganizer && !locked && matches.length > 0}}" class="btn-primary" bindtap="saveOrder">保存顺序</button>
```

---

*v1 — 全量 UI 入口 + 功能缺失清单*
