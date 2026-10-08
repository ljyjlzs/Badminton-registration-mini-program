# 羽毛球小程序开发记录

> 入口见仓库根 README.md

> **订正（2026-10-08，ENG-06）**：challenge 系列已下线。以下已删云函数的条目均标注为历史记录，
> 不代表现状：`start-challenge`、`start-final`、`create-challenge-match`、`get-challenge-data`、
> `confirm-score`、`set-team-name`、`start-match`、`update-user-level`、`clear-database`。
> 现行云函数清单见 `docs/云函数清单.md`（`node scripts/gen-fn-doc.js` 生成）。

## 最新修改日期
2026-03-24

## 当前进度

### 最新完成功能

#### 1. 挑战赛和决赛功能（已废弃，历史记录）
- [x] ~~start-challenge 云函数 - 创建挑战赛~~（已删除）
- [x] ~~start-final 云函数 - 创建决赛（新建）~~（已删除）
- [x] ~~confirm-score 积分计算 - 挑战赛胜+10分，决赛胜+15分~~（已删除）
- [x] 前端UI - 开始挑战赛/决赛按钮
- [x] 挑战赛/决赛样式

#### 2. Bug修复
- [x] submit-score 队伍判断逻辑修复
- [x] ~~confirm-score 权限验证修复~~（函数已删除）
- [x] 排名数据去重修复
- [x] 记分页面返回按钮修复
- [x] 排名页面无限循环修复

#### 3. UI优化
- [x] 记分支持手动输入+滑动选择
- [x] 活动详情页分组按钮居中

### 需要部署的云函数

```
cloudfunctions/
├── start-grouping/         # 添加 team1_players, team2_players 字段 / 修复重复队伍问题 / 双打组队逻辑
├── submit-score/          # 修复队伍判断逻辑
└── get-rankings/         # 排名去重修复
```

> ~~confirm-score/ start-challenge/ start-final/~~ 已删除，无需部署。完整清单见 `docs/云函数清单.md`。

### 2026-03-25 样式优化

#### 分组页面 (grouping)
- 添加比赛场次统计
- 优化卡片渐变色和动画效果
- 添加比赛状态标签（待开始/比赛中/待确认/已结束）
- 添加队伍头像显示
- 优化比分展示样式
- 添加闪光动画效果

#### 活动详情页
- 已有完善的渐变样式和动画

#### 记分页面
- 已有完善的暗色主题和动画效果

### Bug修复
- 修复双打比赛重复创建队伍问题
- 双打比赛改为固定组合：a+b vs c+d, a+c vs b+d, a+d vs b+c（4人情况）
- 修复活动列表状态显示英文问题（直接在wxml中使用内联映射）
- 修复时间显示时间戳问题（支持Date对象和多种格式）
- 添加结束活动功能
- 删除按钮在所有状态显示（包括finished）
- 活动结束后可以查看比赛比分和排名
- 修复删除按钮样式文字被压缩问题

### 代码优化
- 清理所有调试日志
- 优化按钮样式（文字居中）
- 添加挑战赛状态徽章样式

### 新功能 - 头像系统
1. 首页点击头像可选择微信头像或上传头像
2. 报名时必须上传头像
3. 所有显示用户头像的地方都已更新（首页、报名列表、排名等）
4. 新增云函数 update-user-avatar

### 活动状态自动计算
- get-activity-detail 和 get-activities 云函数根据比赛状态自动计算活动状态

### 新增云函数
- update-activity-status: 更新活动状态（结束活动）
- **注意**：每创建新云函数后需运行 `npm install` 生成 node_modules

### 功能流程

```
报名中 → 分组中 → 比赛中 → 已结束
```

> 历史流程含挑战赛/决赛（`报名中 → 分组中 → 比赛中 → 挑战赛 → 决赛 → 已结束`），
> 随 challenge 系列下线已废弃。

### 比赛状态
- pending: 待开始
- playing: 比赛中
- confirming: 确认中
- confirmed: 已完成

### 积分规则
- 小组赛：胜者+比分差，败者-比分差
- ~~挑战赛：胜者+10分，败者+0分~~（已废弃，挑战赛已下线）
- ~~决赛：胜者+15分，败者+0分~~（已废弃，决赛已下线）

---

## 历史完成功能

### 单打模式
- [x] 活动创建时可选择 单打/双打
- [x] 单打：3-10人，循环赛
- [x] 双打：4-12人，组队循环赛

### 删除活动
- [x] 组织者可删除"报名中"状态的活动

### 昵称显示
- [x] 报名列表显示报名时填写的昵称
- [x] 比赛安排显示报名时填写的昵称
- [x] 排名页显示报名时填写的昵称

---

## 待测试

### 2026-03-25 代码验证结果

#### 代码审查通过 ✓

1. **云函数验证 (全部通过)**
   - ~~start-challenge: 169行，创建挑战赛逻辑正确~~（函数已删除）
   - ~~start-final: 145行，创建决赛逻辑正确~~（函数已删除）
   - ~~confirm-score: 176行，积分计算逻辑正确~~（函数已删除）
   - submit-score: 141行，队伍判断逻辑已修复
   - get-rankings: 175行，排名去重逻辑已修复
   - start-grouping: 包含 team1_players, team2_players 字段

2. **前端代码验证 (全部通过)**
   - activity-detail.js: 456行，包含 startChallenge/startFinal 函数
   - match-score.js: 290行，包含 goBack 返回按钮，分数输入范围 0-21
   - activity-detail.wxml: 232行，包含挑战赛/决赛按钮显示逻辑

3. **积分计算逻辑验证 (正确)**
   - 小组赛：胜者+比分差，败者-比分差
   - ~~挑战赛：胜者+10分，败者+0分~~（已废弃）
   - ~~决赛：胜者+15分，败者+0分~~（已废弃）

### 待实际部署测试

1. [ ] 部署 start-grouping 云函数到微信云开发环境
2. [ ] 测试单打队伍数量（3人应为3队）
3. [ ] 测试双打队伍数量（4人应为2队）
4. [ ] 测试小组赛流程
5. ~~测试挑战赛流程~~（已废弃）
6. ~~测试决赛流程~~（已废弃）
7. [ ] 验证排名数据正确

---

## 数据库集合

```
activities      # 活动
registrations  # 报名记录
teams          # 队伍
matches        # 比赛
scores         # 积分
users          # 用户
```

---

## 文件改动清单

### 前端修改
- `miniprogram/pages/activity-detail/activity-detail.js` - 添加挑战赛/决赛函数
- `miniprogram/pages/activity-detail/activity-detail.wxml` - 添加挑战赛/决赛UI
- `miniprogram/pages/activity-detail/activity-detail.wxss` - 挑战赛/决赛样式
- `miniprogram/pages/match-score/match-score.js` - 添加 goBack，修复比分选择
- `miniprogram/pages/match-score/match-score.wxml` - 显示比赛轮次
- `miniprogram/pages/ranking/ranking.js` - 修复无限循环

### 后端修改
- `cloudfunctions/start-grouping/index.js` - 添加 team1_players, team2_players
- `cloudfunctions/submit-score/index.js` - 修复队伍判断
- ~~`cloudfunctions/confirm-score/index.js` - 挑战赛积分计算~~（文件已删除）
- ~~`cloudfunctions/start-challenge/index.js` - 创建挑战赛~~（文件已删除）
- ~~`cloudfunctions/start-final/index.js` - 创建决赛（新建）~~（文件已删除）
- `cloudfunctions/get-rankings/index.js` - 排名去重

---

## 常用命令

在 `badminton-app/` 目录下执行：

```bash
# ESLint 静态检查（配置见 eslint.config.js，只报错不改风格）
npm run lint          # = eslint .

# 五项静态检查（构建期，纯本地无网络；有错误退出码为 1）
npm test              # = node scripts/check-static.js
#   检查项：WXML 语法 / require 相对路径存在 / usingComponents 路径存在 /
#           JSON 格式 / JS 语法（逐文件 node --check）

# 云函数运行时冒烟（只读 action，校验 success/data/message 包络）
npm run smoke         # = node scripts/smoke-fn.js
#   未安装 @cloudbase/node-sdk 时仅打印用例列表；
#   npm i -D @cloudbase/node-sdk 并设置 TCB_ENV_ID 后发起真实调用
```

另有组件声明一致性校验：`npm run check:components`（BUG-81，wxml 自定义标签与本页 json 的 usingComponents 逐页比对）。

---

## 部署方法

0. **部署前先同步共享模块**（必做）：`node cloudfunctions/sync-shared.js`
   （把 `_shared/rateLimit.js`、`validate.js`、`ai.js` 等复制进各函数目录；云函数打包不支持跨目录 require。）
1. 右键点击云函数文件夹
2. 选择「上传并部署：云端安装依赖」
3. 等待部署完成

### cloudbaserc 唯一真源

以 `cloudfunctions/cloudbaserc.json` 为**唯一真源**，根清单 `badminton-app/cloudbaserc.json` 仅兼容保留（供 CloudBase CLI 从子目录调用），函数集以真源为准。

### AI 密钥安全与轮换

**当前状态**：`cloudbaserc.json` 中的 `AI_API_KEY` 已置空，密钥须通过微信云开发控制台注入，不得写入任何配置文件或代码。

**部署前配置步骤**：
1. 登录[微信云开发控制台](https://console.cloud.tencent.com/tcb) → 云函数 → 环境变量
2. 为以下 8 个 AI 云函数分别设置环境变量：
   - `ai-chat`、`ai-history`、`generate-copy`、`invite`、`parse-activity`、`photo-ai-note`、`recommend-time`、`rules-qa`
3. 每个函数设置：`AI_API_KEY`（密钥）、`AI_BASE_URL`（网关地址）、`AI_MODEL`（模型名）

**密钥轮换要求**：历史上曾有密钥泄露到 git 提交记录（`9e456ea`→`9d59216`→`1945480`），**必须立即到 Mimo 开放平台轮换该 API Key**，旧密钥已不可信。轮换后更新控制台环境变量即可，无需改代码。

**禁止事项**：
- 禁止将密钥写入 `cloudbaserc.json`、代码、文档或任何 git 跟踪文件
- 禁止在日志中输出完整密钥（如需排查，只打前 7 位：`key.slice(0,7)`）
- 提交前检查：`git diff --cached | grep -i 'api[_-]key\|tp-[a-z0-9]'` 应为空
