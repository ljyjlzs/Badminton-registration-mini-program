## Context

羽毛球双打活动组织通常依赖微信群，存在以下痛点：
- 人工统计报名、人工分组，效率低
- 比分记录分散，无法实时共享
- 积分计算依赖人工，容易出错
- 活动结束后没有历史记录和排名

本项目基于微信小程序 + 云开发，提供完整的活动管理方案。

## Goals / Non-Goals

**Goals:**
- 提供从创建活动到最终排名的完整闭环
- 实现公平的均衡分组算法
- 确保比分记录的公正性（双方确认机制）
- 支持实时状态同步（多人同时查看）
- 提供流畅的移动端体验

**Non-Goals:**
- 不支持原生 App，仅限微信小程序
- 不支持自定义赛制（仅限单场21分制）
- 不支持历史活动查询（本版本仅单次活动）
- 不支持自动等级评估（用户自填）

## Decisions

### 1. 微信原生开发 vs 跨端框架

**决定：微信原生开发**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 微信原生 | 性能最佳、API最全、调试方便 | 代码复用性差 |
| Taro/uni-app | 跨端复用 | 增加复杂度、性能损耗 |

微信小程序有特殊 API（云开发、订阅消息等），原生开发能获得最佳体验和完整能力支持。

---

### 2. 云开发 vs 自建后端

**决定：微信云开发**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 云开发 | 免服务器、免费额度够用、实时数据库原生支持 | 生态锁定、并发有限制 |
| 自建后端 | 灵活性高 | 需要运维、成本高 |

12人活动的并发量极低，云开发免费额度（云函数100万次/月、数据库2GB）完全足够。

---

### 3. 分组算法设计

**决定：贪心均衡算法**

```
算法步骤：
1. 按等级降序排列12人
2. 每次取最高+最低组成一队，循环直到所有人分配完毕
3. 将6支队伍按总等级降序排列
4. 头尾配对、中段配对

示例：
输入：[10,9,8,7,6,5,4,3,3,2,2,1]

Step 1 组队：
- [10+1], [9+2], [8+2], [7+3], [6+3], [5+4]

Step 2 排序：
- [11]: [10+1]
- [11]: [9+2]
- [10]: [8+2]
- [10]: [7+3]
- [9]:  [6+3]
- [9]:  [5+4]

Step 3 配对（场次）：
- 场地A: [10+1] vs [11]    差1
- 场地B: [9+3]  vs [10]    差2
- 场地C: [9+4]  vs [10]    差3
```

---

### 4. 数据库模型

```
Collection: users
├── _id: string (微信openid)
├── nickname: string
├── avatar: string
└── level: number (1-10)

Collection: activities
├── _id: string
├── name: string
├── time: number (timestamp)
├── location: string
├── organizer_id: string (ref: users)
├── status: string ('registering' | 'grouping' | 'playing' | 'finished')
├── min_players: number (8)
├── max_players: number (12)
└── created_at: number (timestamp)

Collection: registrations
├── _id: string
├── activity_id: string (ref: activities)
├── user_id: string (ref: users)
├── level: number
├── team_id: string (ref: teams, null if not grouped)
└── is_eliminated: boolean

Collection: teams
├── _id: string
├── activity_id: string (ref: activities)
├── name: string
├── captain_id: string (ref: users)
├── members: string[] (user_ids)
├── total_level: number
└── challenge_score: number (挑战赛积分，初始0)

Collection: matches
├── _id: string
├── activity_id: string (ref: activities)
├── round: string ('group' | 'challenge')
├── venue: string
├── team1_id: string (ref: teams)
├── team2_id: string (ref: teams)
├── team1_score: number (null if not started)
├── team2_score: number
├── status: string ('pending' | 'confirming' | 'confirmed')
├── score_submitter: string (user_id)
├── team1_confirmed: boolean
├── team2_confirmed: boolean
└── completed_at: number (timestamp)

Collection: scores
├── _id: string
├── activity_id: string (ref: activities)
├── user_id: string (ref: users)
├── team_id: string (ref: teams)
├── match_id: string (ref: matches)
├── score_change: number
└── source: string ('group' | 'challenge')
```

---

### 5. 实时同步方案

使用云开发实时数据库（RTDB）监听关键数据变更：

```
监听范围：
├── activity/{id}/status - 活动状态变化
├── matches/{activity_id}/* - 比分更新
└── scores/{activity_id}/* - 排名实时更新

客户端监听：
onSnapshot(collection('matches'), where('activity_id', '==', id), ...)
```

---

### 6. 比分确认流程

```
记分员录入比分
       │
       ▼
   双方确认 ◀────────────┐
       │                 │
   ┌───┴───┐             │
   ▼       ▼             │
 是     否（拒绝）         │
   │       │             │
结束   重新录入 ◀─────────┘
```

---

### 7. 挑战赛规则细化

```
小组赛结束后：
1. 计算各队伍积分总和
2. 积分最高的2队晋级
3. 淘汰者自由组队（2人一队）
4. 组织者确认挑战赛开始
5. 同普通比赛流程

积分计算：
- 晋级队胜：每人+10分
- 晋级队负：每人-10分
- 淘汰队胜：每人+10分
- 淘汰队负：每人-10分
```

---

## Risks / Trade-offs

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 云开发免费额度超限 | 服务不可用 | 监控用量，优化查询 |
| 比分确认僵持 | 比赛无法继续 | 超时（如5分钟）自动确认 |
| 组织者中途离开 | 无人管理 | 支持转移组织者权限 |
| 等级填写虚假 | 分组不公平 | 本版本信任用户，后续可加入申诉机制 |

## Open Questions

1. **挑战赛淘汰者组队规则**：最多允许几队参与挑战赛？是否需要限制？
2. **活动过期处理**：报名后多久不开始算过期？是否需要自动取消？
3. **积分历史**：本版本不保存历史，是否后续需要？
