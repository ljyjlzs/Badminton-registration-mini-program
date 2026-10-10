# 云函数与 Java 对齐说明

> 第 10 章完整性复核维度 ③。列出 21 个标注「对齐 *ServiceImpl」的云函数与 Java 侧映射及当前状态。

## 1. 对齐清单

| 云函数 | Java 侧 | 对齐要点 | 状态 |
|---|---|---|---|
| ai-chat | AiServiceImpl.buildUserContext / sanitizeChatReply | 用户上下文 + 防幻觉清洗 | 已对齐（i=107/112/123/154 修复后） |
| cancel-registration | RegistrationServiceImpl.cancelRegistrationInternal | 看 applyStatus，不看比赛状态 | 已对齐 |
| court-config | CourtAssignServiceImpl | 场地配置 | 已对齐 |
| court-matches | GroupingPlanServiceImpl.buildRotatingDoublesPlan + Match 实体 | team1Id/team2Id + team1Score/team2Score | 已对齐 |
| court-submit-score | ScoreServiceImpl.submitScore + RatingServiceImpl.applyMatch | 提交比分 + 积分结算 | 已对齐 |
| create-activity | ActivityServiceImpl.createActivity | 创建活动 | 已对齐 |
| delete-activity | ActivityServiceImpl.deleteActivity | 仅组织者，级联删除 | 已对齐（i=9 补 activity_copy/activity_settings） |
| generate-copy | AiServiceImpl.generateCopy（05.4） | 文案生成 | 已对齐 |
| get-activities | ActivityServiceImpl.getActivities | 活动列表 | 已对齐 |
| get-match-detail | Match 新 schema（team1Id/team2Id + teams 集合） | 比分详情字段映射 | 已对齐（注释为 schema 对齐，非 ServiceImpl 名） |
| get-rankings | RankingServiceImpl（03.4） | 个人场均积分 / 队伍去重累加 | 已对齐 |
| get-rules | RulesServiceImpl | 读 rules，空则回退默认三套 | 已对齐（有兜底） |
| handle-cancel-request | RegistrationServiceImpl | approve 解绑→approved→补位；reject→rejected | 已对齐 |
| init-rules | RulesServiceImpl | 写入默认规则 | 已对齐（但零调用方，见下） |
| invite | InviteServiceImpl（05.7） | listCandidates / generateInvites | 已对齐 |
| parse-activity | AiServiceImpl.parseActivity（05.3） | chatJson + normalizeDraft + fillMissingLocation | 已对齐（i=170 截断） |
| recommend-time | ActivityRecommendServiceImpl（05.6） | 时段推荐 | 已对齐 |
| rules-qa | RulesQaServiceImpl（05.5） | chatJson + 校验 + fallback | 已对齐（但 fallback 不对称，见下） |
| start-grouping | GroupingPlanServiceImpl | 开始分组 | 已对齐 |
| update-user-info | UserSummary / UserServiceImpl | 用户信息 | 已对齐 |
| update-user-level | UserSummary / UserServiceImpl | 用户等级 | 已对齐 |

## 2. 规则写读契约（维度 ② 记录）

跨云函数数据契约问题，不在「ServiceImpl 对齐」本身，但影响规则功能可用性：

| 项 | 结论 | 证据 |
|---|---|---|
| `clear-database` 白名单 | **安全** — `rules` 不在清空列表内，且有注释「'rules' 等配置集合受保护，禁止清空」 | `clear-database/index.js:76-83` |
| `init-rules` 调用方 | **零代码调用方**（D-3 处置 2026-10-10 定案：**保留部署，定位为一次性运维手动工具**）— miniprogram / 其他云函数均无 `callFunction('init-rules')`；调用方式为**管理员在云开发控制台手动执行一次**，可执行步骤见下方「init-rules 手动执行步骤」。满足 D-3 判据三分支中的「文档里的可执行步骤」 | 全仓 grep 零命中 + 手动步骤已文档化 |
| `get-rules` 空回退 | 有兜底 — 读不到 rules 时返回 `DEFAULT_SECTIONS`（单打/双打轮换/双打固搭 三套） | `get-rules/index.js:11-33, 39-43` |
| `rules-qa` 空回退 | **不对称** — `sections` 为空数组时仍把空 ctxText 送 AI；fallback 只给 `sectionId` 且 `quotes:[]`，答案恒为「规则原文未提及」 | `rules-qa/index.js:55-56, 69, 85-92` |

**风险**：`rules` 集合为空时，`get-rules` 展示默认规则（可用），但 `rules-qa` 直接退化为「规则原文未提及」（不可用）。两者对同一空态行为不一致，契约未定义「默认规则应由谁播种」。

**建议**：要么提供一次性的 `init-rules` 手动部署/初始化入口，要么让 `rules-qa` 与 `get-rules` 共用同一份 `DEFAULT_SECTIONS` 兜底。

#### init-rules 手动执行步骤（D-3 判据所称「文档里的可执行步骤」）

> ⚠️ **只跑一次**。`init-rules` 会**整表覆盖** `rules` 集合（BUG-035：不保留自定义规则）。仅在 `rules` 集合为空、或明确要重置为出厂默认时执行；已有自定义规则的环境**禁止重跑**。

1. 打开腾讯云 CloudBase 控制台 → 选环境 `cloud1-3guy8euw3babaf6d`（套餐恢复后才能操作）。
2. 左侧「云函数」→ 函数列表中找到 **`init-rules`**。
3. 点「测试」→ 新建测试模板，测试事件填 `{}`（空对象即可，函数不读 event 字段）。
4. 点「运行测试」，预期返回 `{ success: true, ... }`。
5. 左侧「数据库」→ 集合 **`rules`**，确认已写入文档（应为单打 / 双打轮换 / 双打固搭 三套 `DEFAULT_SECTIONS`）。
6. 对照验证：小程序端调 `get-rules`，确认能读到规则（不再走空回退）。

**幂等性**：重复执行会用出厂默认**覆盖**现有 `rules` 文档，不合并。因此本步骤是「一次性播种」，不是「日常运维」。

## 2.5 差异清单（未对齐 / 有差异项）

> CH10-6 要求的「差异清单」。**只列有差异的**；§1 标「已对齐」的不再重复。
> ⚠️ Java 侧源码不在本仓，差异以**云函数侧可读行为** + 其他文档记载为准；带「待核」的项**不得宣称已验证**。

| # | 云函数 | 差异点 | 云函数侧现状 | Java 侧记载 | 影响 | 处置 |
|---|---|---|---|---|---|---|
| 1 | `init-rules` | **零代码调用方** | 全仓 `callFunction('init-rules')` = 0 | `RulesServiceImpl` 有对应方法但无人触发 | `rules` 集合播种靠人工 | ✅ 已定案：保留部署 + 手动步骤（§2），不废弃 |
| 2 | `rules-qa` | **空回退不对称** | `sections` 空时仍把空 `ctxText` 送 AI；fallback 只给 `sectionId` 且 `quotes:[]` → 答案恒「规则原文未提及」`rules-qa/index.js:55-56,69,85-92` | `get-rules` 空时返回 `DEFAULT_SECTIONS` 兜底 | 同一空态两函数行为不一致 | **待改**：让 `rules-qa` 与 `get-rules` 共用 `DEFAULT_SECTIONS` 兜底 |
| 3 | `get-match-detail` | **对齐对象是 schema 不是 ServiceImpl** | 字段映射 `team1Id/team2Id` + `teams` 集合 | §1 标注「注释为 schema 对齐，非 ServiceImpl 名」 | 弱对齐，仅数据形状一致 | 可接受，保留 |
| 4 | `ai-chat` | 修复后才对齐 | i=107/112/123/154 修复后 | `AiServiceImpl.buildUserContext / sanitizeChatReply` | 历史差异已修 | ✅ 已闭合 |
| 5 | `delete-activity` | 级联删除范围曾缺 | i=9 补 `activity_copy`/`activity_settings` 后齐 | `deleteActivity` 级联 | 历史差异已修 | ✅ 已闭合 |
| 6 | 全局 | **Java 侧不可现场核** | 本仓无 Java 源码 | 「java｜serviceimpl｜spring 命中待补」占位（交接清单 `:4733`） | 无法双向实测 | 🔴 **不得宣称已验证** — 待 Java 仓接入后逐条复核 |

**核查方法**：§3 已列可执行命令；差异项复核时**先读本表**，再跑 §3 步骤，最后回写「处置」列。

## 3. 核查方法（验证方式）

对齐状态的判定依据与复核步骤：

| 步骤 | 操作 | 判定标准 |
|---|---|---|
| 1. 函数签名比对 | 读云函数 `exports.main` 的 `event.action` 分支，对照 Java `*ServiceImpl` 对应方法的入参/出参 | action 名称、payload 字段名一致 |
| 2. 核心算法抽样 | 选取关键计算逻辑（如 ELO 评分、轮转分组、排名聚合）在两侧对比伪代码 | 算法步骤、边界值处理一致 |
| 3. 数据契约比对 | 对照集合/表字段：云函数 `collection().add/update` 写入的字段 vs Java `@Document` / `@Table` 实体 | 字段名、类型、必填性一致 |
| 4. 权限校验比对 | 检查云函数中的 `organizerId` / `isMember` 等校验 vs Java `@PreAuthorize` / Service 内 check | 权限门禁覆盖一致 |
| 5. 运行时抽测 | 用相同 payload 分别调用云函数与 Java 接口，比对返回 JSON | 关键字段值一致（允许时间戳差异） |

**快捷命令**：
```bash
# 列出云函数 action 分支
grep -n "action ===" cloudfunctions/*/index.js

# 查 Java ServiceImpl 对应方法
grep -rn "public.*(" src/main/java/**/service/impl/*.java
```

## 4. 共享模块（ARCH-01）

- `cloudfunctions/_shared/ai.js` 由 `sync-shared.js` 复制进各云函数目录（不能跨目录 require）。
- `callAI(system, user, opts)` 已支持 `opts.history` 拼入 messages（仅 user/assistant，content 截 2000）。
- 同步命令：`node cloudfunctions/sync-shared.js`（4 个共享模块 × 66 个云函数目录）。
