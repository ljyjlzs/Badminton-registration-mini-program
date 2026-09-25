# 羽毛球双打活动小程序

微信小程序 + 云开发：组织羽毛球双打活动、报名、分组、记分、排名与 AI 助手。

## 这是什么

面向球友的羽毛球活动组织工具：创建活动、报名取消、均衡分组、实时记分与确认、个人/队伍排名，并内置 AI 对话（报名/取消确认）、活动文案、规则问答、时间推荐等能力。

## 目录结构

```
badminton-app/
├── badminton-app/           # 小程序与云函数主工程
│   ├── miniprogram/         # 小程序前端
│   ├── cloudfunctions/      # 云函数（含 _shared 共享模块、sync-shared.js）
│   ├── docs/                # 工程文档
│   ├── DEVELOPMENT.md       # 开发记录
│   ├── RELEASE.md           # 发布指南
│   └── cloudbaserc.json     # 云开发配置（不入库，见 example）
├── docs/                    # 交接/测试/密钥等文档
├── openspec/                # 规格说明
└── README.md                # 本文件
```

## 快速开始

1. 用微信开发者工具打开 `badminton-app/`（appid 在 `project.config.json`）
2. 在 `miniprogram/config/env.js` 配置云环境 ID
3. 复制 `badminton-app/cloudbaserc.example.json` 为 `cloudbaserc.json` 并填入真实配置（勿提交）
4. 云开发控制台创建数据库集合与索引（见 `cloudfunctions/database-init.js`）
5. 同步共享模块后部署云函数：`node cloudfunctions/sync-shared.js`

## 部署

- **云函数**：先 `node cloudfunctions/sync-shared.js`，再在微信开发者工具「上传并部署：云端安装依赖」
- **发布与回滚**：见 `badminton-app/RELEASE.md`（含云函数发布/回滚与小程序回滚）
- **cloudbaserc 真源**：以 `badminton-app/cloudfunctions/cloudbaserc.json` 为唯一真源，根清单仅兼容保留

## 文档索引

| 文档 | 路径 |
|------|------|
| 开发记录 | `badminton-app/DEVELOPMENT.md` |
| 发布指南 | `badminton-app/RELEASE.md` |
| 数据库初始化/索引清单 | `badminton-app/cloudfunctions/database-init.js` |
| 数据库权限规则 | `badminton-app/database.rules.json` |
| 密钥与安全 | `docs/密钥轮换与安全说明.md` |
| 开发交接清单 | `开发交接清单-问题统计与优化建议.md` |
| 项目交接文档 | `项目交接文档-开发.md` / `项目交接文档-产品架构测试.md` |
| 测试报告 | `docs/` 与根目录 `*报告*.md` |

## 云开发环境

| 项 | 说明 |
|----|------|
| envId | 见本地 `cloudbaserc.json`（不入库）；模板占位在 `cloudbaserc.example.json` |
| runtime | Nodejs20.19 |
| 数据库集合 | users / activities / registrations / teams / matches / scores / photos / photo_comments / rules / ai_messages 等 |
| 索引 | 需在云开发控制台手动创建，清单见 `database-init.js` |
| 权限规则 | 见 `database.rules.json`，需在控制台同步导入 |
