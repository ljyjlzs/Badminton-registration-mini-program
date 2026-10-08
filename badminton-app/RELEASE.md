# 羽毛球报名小程序 - 发布指南

> 入口见仓库根 README.md

## 发布前准备

### 1. 云开发环境配置

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 开通云开发服务
3. 获取云环境 ID
4. 在 `miniprogram/config/env.js` 中配置环境 ID

### 2. 数据库配置

在云开发控制台中创建以下集合：
- `users` - 用户信息
- `activities` - 活动信息
- `registrations` - 报名记录
- `teams` - 队伍信息
- `matches` - 比赛记录
- `scores` - 积分记录

为集合创建必要索引（参考 `cloudfunctions/database-init.js`）

### 3. 云函数部署

使用微信开发者工具：
1. 打开项目 `badminton-app`
2. 右键点击 `cloudfunctions` 文件夹
3. 选择「上传并部署：云端安装依赖」
4. 等待部署完成

需要部署的云函数：
- login
- create-activity
- join-activity
- get-activities
- get-activity-detail
- start-grouping
- submit-score
- get-rankings
- get-match-detail
- delete-activity

> 完整清单见 `docs/云函数清单.md`（`node scripts/gen-fn-doc.js` 生成）。
> 以下函数已删除，不存在也无需部署：`set-team-name`、`confirm-score`、`start-challenge`、
> `create-challenge-match`、`get-challenge-data`、`start-match`、`update-user-level`、`clear-database`。

### 4. 小程序配置检查

在 `project.config.json` 中确认：
- `appid` 已配置
- `compileType` 为 `miniprogram`
- `setting` 中的编译配置正确

在 `miniprogram/app.json` 中确认：
- `pages` 数组包含所有页面
- `window` 配置正确
- `permission` 已配置（如需要）

## 提交审核

### 1. 版本信息

- 版本号：1.0.0
- 版本说明：首次发布
- 功能描述：羽毛球双打活动组织小程序

### 2. 功能说明

核心功能：
- 用户授权登录
- 创建羽毛球活动
- 报名参加活动
- 均衡分组算法
- 实时比分录入
- 小组赛模式（分组后自动建赛程，challenge 系列已下线）
- 个人和队伍排名

### 3. 审核材料准备

- 小程序图标：建议 1024x1024 PNG
- 介绍图片：建议 5 张
- 小程序简介：羽毛球双打活动组织工具
- 标签：体育、运动、羽毛球

### 4. 提交审核步骤

1. 在微信开发者工具中点击「上传」
2. 登录 [微信公众平台](https://mp.weixin.qq.com/)
3. 进入「版本管理」
4. 选择刚上传的版本
5. 填写版本信息
6. 提交审核

### 5. 审核周期

通常 1-7 个工作日

### 6. 常见驳回原因

- 用户隐私协议未配置
- 需添加登录功能说明页
- 云开发资源需完成实名认证

## 上线后检查

- [ ] 登录功能正常
- [ ] 创建活动正常
- [ ] 报名功能正常
- [ ] 分组功能正常
- [ ] 记分功能正常
- [ ] 排名功能正常
- [ ] 分享功能正常

## 云函数发布

> 约定：只在 `master` 上打 tag，且必须在本次改动全部提交之后打（否则 diff 会算错）。

1. 改动全部提交
2. 在 `master` 分支上打 annotated tag（message 里列出本次涉及的云函数）：
   ```bash
   git tag -a v1.2.0 -m "云函数: join-activity, get-activities"
   git push origin v1.2.0
   ```
3. 在 badminton-app/docs/发布记录.md 追加一行
4. 在微信开发者工具按 tag 清单逐个「上传并部署」

## 云函数回滚

```bash
bash badminton-app/scripts/rollback-fn.sh v1.1.0
```
脚本输出从上一个 tag 到目标 tag 之间变更的云函数目录列表，按列表 git checkout 后在微信开发者工具重新上传这几个函数。

## 云函数发布与回滚

### 发布前打 tag

> 约定：只在 `master` 上打 tag。

```bash
git tag -a vYYYYMMDD-n -m "描述"
```

首次启用说明：存量仓库无历史 tag，从当下开始打即可。

### 发布

微信开发者工具对**改动的**云函数右键「上传并部署：云端安装依赖」。

部署前先同步共享模块：

```bash
node cloudfunctions/sync-shared.js
```

### 回滚

1. `git diff <tag> -- cloudfunctions/<fn>/` 得出差异函数清单
2. checkout 旧版本：`git checkout <tag> -- cloudfunctions/<fn>/`
3. 只重传差异的 1-3 个函数（**不要全量 60+ 个**）

### 与小程序端回滚的关系

- 小程序端按下方「回滚操作」章节执行
- 云函数按本节执行，两者可独立回滚

## 回滚操作

如需回滚：
1. 登录微信公众平台
2. 进入「版本管理」
3. 选择历史版本
4. 点击「回退」
