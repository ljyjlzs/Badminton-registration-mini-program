# 羽毛球小程序 · Java 后端能力同步到云函数 · 开发交付说明

> 阅读对象：接手本项目的开发同学。
> 目标：把 `badminton-app-java`（Spring Boot，P0–P7 全量功能）用 `badminton-app` 现有的「微信云函数 + 小程序」架构重写一遍，终态体验与 Java 版一致（单一赛制，无挑战赛）。
> 配套详细规格在同级 `同步/` 目录（00–10 共 11 份）。

---

## 0. 本次交付方式：一次性完成（重要）

**不要按模块停下等我**——一口气做到 M8，最后拿 `10` 的验收清单来对齐。中间只在「文档与源码矛盾、缺字段定义」这类真卡点时找我。

**执行顺序**（按 00 里程碑，全程只读 Java 后端做对照、只改 `D:\project\badminton-app\badminton-app`）：

1. **M0 基础**：建 `miniprogram/utils/request.js` 的 `callFunction(name, action, data)` 封装（00 §4 / 09 §9.1）；配环境变量（00 §3，不入库）。
2. **M1 数据模型**：按 `01` 扩展集合与字段，跑 `init-rules` 写默认规则。
3. **M2 核心闭环**：02 活动报名 + 03 分组赛程排名 → create-activity / join / cancel / cancel-review / group / start-grouping / submit-score / ranking。
4. **M3 AI**：05 → parse-activity / generate-copy / invite / rules-qa / recommend-time / invite-candidates / ai-chat，**prompt 逐字照搬 05**（要改去后端改、走我审批）。
5. **M4 相册**：06 → album / photo-upload / like / feature / ai-note / comments。
6. **M5 语音天气**：07 → voice-score-config / voice-score-parse / weather / match-reminders / match-live-score。
7. **M6 按场地双打**：08 → court-* 系列（复用 03 通用端点）。
8. **M7 前端改造 + 清理 challenge**：09 §9.2/§9.3 搬页面 + 调用层改造；删除 challenge 系列云函数与前端页面（00 §2）。
9. **M8 验收**：对照 `10` 跑通端到端闭环。

**铁律**：
1. 只动 `D:\project\badminton-app\badminton-app`，**绝不碰** `D:\project\badminton-app-java`。
2. `同步/00–10` 是契约，后端 `service/impl` 是真相；冲突以源码为准并回头改对应文档。
3. 每个云函数对照 00 §5 / 09 §9.2 的映射，别自造路由。
4. **Java 后端标记为必填的字段，云函数与前端一律不得放松成可空蒙混**：如 `province/city/district`（Activity `@NotBlank`）。前端若只采到经纬度，由 `create-activity` 云函数用 `AMAP_KEY` 做逆地理编码反查省市区再入库，不要默认空串，否则破坏与 Java 的契约并连累战报按地区统计（04 `TopLocationVO`）。

---

## 1. 四条已经拍板、不能改的红线
1. **分支**：所有改动只在 `badminton-app` 仓库的 `sync-java-backend` 分支（已建好并推送到远端）。不要引入任何 Java 文件，不要合并 Java 项目的提交历史。
2. **移除 challenge（挑战赛）**：保持单一赛制。删除 4 个云函数 + 前端 challenge 页面（见 §4）。
3. **语音识别用腾讯 ASR**。
4. **云数据库用「多次查询 + 内存关联」**，不要写联表查询。

## 2. 怎么把工程跑起来
- 仓库根目录实际在子目录里：`D:\project\badminton-app\badminton-app\`（`cloudfunctions/`、`miniprogram/` 在这里）。
- 切分支：`git checkout sync-java-backend`。
- 云函数环境变量（在云开发控制台配置，**不要提交到仓库**）：
  - `AI_API_KEY`(→`ai.api-key`)、`AI_BASE_URL`(→`ai.api-url`)、`AI_MODEL`(默认 `mimo-v2.6-pro`，→`ai.model`)
  - `TENCENT_ASR_SECRET_ID`、`TENCENT_ASR_SECRET_KEY`
  - `AMAP_KEY`(→`weather.amap.key`)、`WEATHER_PROVIDER`(默认 `amap`，→`weather.provider`)
- 先跑一次 `init-rules` 云函数，写入默认规则。

## 3. 最重要的一条：先读现有云函数，再动手（不要新建重复逻辑）
目标仓库里**大部分能力已经实现了**。下面是「规格文档里的模块名 ↔ 你要在哪个真实云函数里扩展」的映射表。请先打开这些函数看现状，再把 `同步/` 文档里的逻辑并进去。

| 规格文档里的叫法 | 你要改的真实云函数（已存在） | 动作 |
|---|---|---|
| 创建活动 | `create-activity` | 扩展 |
| 报名 | `join-activity` | 扩展（加固定搭档/自报水平/候补状态） |
| 取消报名 | `cancel-registration` + `handle-cancel-request` | 扩展（区分开赛前后、加审批） |
| 规则 | `get-rules` / `init-rules` | 扩展 |
| 活动详情 | `get-activity-detail` | 扩展 |
| 分组预览/落库 | `start-grouping` | 扩展（加分组理由 reasons） |
| 比赛/比分 | `start-match` / `get-match-detail` / `submit-score` / `confirm-score` | 扩展 |
| 排名 | `get-rankings` | 扩展 |
| 用户资料 | `update-user-info` / `update-user-level` / `update-user-avatar` | 扩展 |
| AI 对话 | `ai-chat` / `ai-history` | 扩展 |

**需要你新建的云函数**（规格文档里是新建）：
`parse-activity`、`generate-copy`、`invite`、`recommend-time`、`invite-candidates`、`photo-upload`、`photo-list`、`photo-like`、`photo-feature`、`photo-ai-note`、`photo-comment-add`、`photo-comment-list`、`photo-comment-delete`、`voice-score-config`、`voice-score-parse`、`weather`、`match-reminders`、`match-live-score`、`court-list`、`court-save`、`court-start`、`court-reset`、`court-delete`、`court-matches`、`court-submit-score`、`court-rank`。

## 4. 要删除的东西（challenge 系列）
- 云函数：`create-challenge-match`、`start-challenge`、`start-final`、`get-challenge-data`
- 前端页面：`pages/challenge/*` 及 `app.json` 中的 challenge 路由

> **页面范围防踩坑**：本迁移真实前端页面只有 11 个——`index / ai-chat / activity-list / create-activity / activity-detail / grouping / match-score / ranking / agreement / privacy / rules`（`app.json` 为准）。`profile`、`my-activities`、`match-management`、`login/register` **在仓库里不存在、也不在本次范围**（来自原小程序或规划），勿去找、勿新建；其能力已并入上述页面（my-activities→activity-list、match-management→grouping/match-score）。
> `app.json` 若仍残留 `pages/challenge/challenge` 一行，必须删除（否则编译报错），与上方「移除 challenge」一致。

## 5. 详细规格去哪看
`同步/` 目录（与本文同级）：
- `00-总体方案与执行说明.md` — 架构/分支/里程碑
- `01-数据模型对齐.md` — 云数据库集合与字段（**权威定义，字段名以此为准**）
- `02-活动与报名模块.md`
- `03-分组赛程排名模块.md`
- `04-水平分战报徽章模块.md`
- `05-AI能力模块.md` — 含 ai-chat / parse-activity / generate-copy 的 **system prompt 原文**
- `06-相册照片评论模块.md`
- `07-语音天气提醒模块.md`
- `08-按场地双打模块.md`
- `09-前端改造与页面清单.md` — 页面映射 + 调用层改造
- `10-验收标准与测试计划.md` — 门禁与测试用例

每个模块文档都按「云函数 / 入参 / 步骤 / 校验 / 降级」结构写，照着实现即可。

## 6. 建议的开工顺序
1. **M1 数据模型**：按 `01` 扩展集合字段，跑 `init-rules`。
2. **M2 核心闭环**：`02`+`03`，扩展现有函数，打通「创建→报名→分组→比分→排名」。
3. **M3 AI**：`05`。
4. **M4 相册**：`06`。
5. **M5 语音/天气/提醒**：`07`。
6. **M6 按场地双打**：`08`。
7. **M7 前端**：`09`（搬页面 + `request.js` 统一 `callFunction`）。
8. **M8 验收**：按 `10` 跑通核心闭环真机演示。

## 7. 已从 Java 源码提取并回填的精确算法（务必照此实现，勿凭直觉）
以下原文档“以 Java 为准”的坑**已全部回填**到对应 `同步/` 文档，实现时严格对照：

- **分组（03.1）按 `activity.type` 分四种**：`singles`（全循环）、`doubles`（圆桌轮转，每人搭档所有人）、`fixed-doubles`（固搭优先+高分配低分）、`court-doubles`（按场地轮转）。排序按 `teamTotalLevel` 升序；reasons 文案见 03.1。AI 分组解释仅返回 `{summary≤150}`。
- **排名（03.4）按“场均积分”**：`scoreChange = myScore - opponentScore`；`avgScore = ΣscoreChange / 参赛场数`；排序 `avgScore↓ → totalScore↓ → 昵称↑`。**不是胜场数、不是 wins*3**（旧直觉已删）。
- **水平分（04.1）K=32+分差权重**：`expected=1/(1+10^((avgOpp-avgOwn)/400))`，`weight=1+min(diff,15)/15*0.3`，`delta=max(round(32*(1-expected)*weight),1)`；默认 rating `1000+(level-5)*80`。
- **徽章（04.2）5 类**：`mvp / best_partner / streak_king / hard_worker / biggest_win`，按活动生成（非“首胜/高手”）。
- **候补（02.2）**：`有效人数 ≥ maxPlayers` 才进候补；取消看 `applyStatus`（候补即批、有效则 pending 需审批），**不看比赛是否开赛**。
- **水平 level 是数字 1–10**（默认 5），非“新手/高手”文案。
- **相册限额（06）**：单文件 10MB、每活动 500 张、精选 9 张、jpg/png；候补可浏览不可上传。
- **语音（07.1）**：配额 10/30/200（滚动 1 小时），`needReview` 阈值 0.85（<0.60 标“重点核对”），仅 mp3，识别不可用统一“请手动输入”。
- **默认规则（01 附录）**：三套（单打/双打轮换/双打固搭），`init-rules` 种子写入。

> 源码：`D:\project\badminton-app-java\src\main\java\com\badminton\service\impl\` 下 `GroupingPlanServiceImpl / RankingServiceImpl / RatingServiceImpl / BadgeServiceImpl / ReportStatsServiceImpl / RegistrationServiceImpl / VoiceScoreServiceImpl / PhotoServiceImpl / CommentServiceImpl / RulesServiceImpl`。

## 8. 通用约定（所有云函数遵守）
- 入参：`event = { action, payload }`；返回：`{ success, data, message }`。
- 鉴权：云函数内 `cloud.getWXContext().OPENID` 关联 `users._openid`。
- 降级：AI / 天气 / ASR 不可用时必须返回确定性结果或隐藏入口，**绝不能抛错阻塞主流程**。
- 权限：组织者操作校验 `activity.creatorOpenid === openid`。

---
有任何对不齐的地方，以 `同步/` 规格文档为准；文档之间冲突以 `01 数据模型` 字段定义为准。
