/**
 * 数据库初始化脚本 / 索引说明
 *
 * 在云开发控制台执行以下操作：
 * 1. 进入云数据库
 * 2. 创建以下集合：
 *    - users
 *    - activities
 *    - registrations
 *    - teams
 *    - matches
 *    - scores
 *    - photos
 *    - photo_comments
 *    - rules
 *    - ai_messages
 *    - activity_courts
 *    - court_assignments
 *    - activity_copy
 *    - rating_changes
 *
 * 集合索引配置（camelCase，与云函数查询字段一致）：
 *
 * users 集合索引：
 * - _id (主键，默认)
 * - openid 唯一索引
 *
 * activities 集合索引：
 * - _id (主键，默认)
 * - organizerId 普通索引
 * - status 普通索引
 * - createdAt 普通索引
 * - time 普通索引
 *
 * registrations 集合索引：
 * - _id (主键，默认)
 * - activityId 普通索引
 * - userId 普通索引
 * - activityId + userId 复合唯一索引
 * - applyStatus / cancelStatus 与 activityId 组合查询
 *
 * teams 集合索引：
 * - _id (主键，默认)
 * - activityId 普通索引
 * - captainId 普通索引
 *
 * matches 集合索引：
 * - _id (主键，默认)
 * - activityId 普通索引
 * - roundOrder 普通索引
 * - status 普通索引
 * - team1Id / team2Id 普通索引
 *
 * scores 集合索引：
 * - _id (主键，默认)
 * - activityId 普通索引
 * - userId 普通索引
 * - teamId 普通索引
 * - userId + createdAt（get-user-stats 按用户/时间段查积分记录）
 * - matchId（submit-score / court-submit-score 撤销旧积分）
 *
 * rating_changes 集合索引：
 * - _id (主键，默认)
 * - activityId + matchId（get-rankings 按活动查、按比赛撤销）
 *
 * photos 集合索引：
 * - _id (主键，默认)
 * - activityId 普通索引
 * - createdAt 降序
 * - featured + featuredAt（album 精选相册）
 * - uploadedBy + takenAt（album 我的上传）
 *
 * photo_comments 集合索引：
 * - _id (主键，默认)
 * - photoId + parentCommentId + createdAt（评论分页与楼中楼回复）
 *
 * activity_courts 集合索引：
 * - _id (主键，默认)
 * - activityId + courtNo（court-* 场地定位/排序）
 *
 * court_assignments 集合索引：
 * - _id (主键，默认)
 * - activityId + courtId
 *
 * ai_messages 集合索引：
 * - _id (主键，默认)
 * - userId + createdAt
 *
 * ============================================================
 * 需在云开发控制台手动创建的索引清单（API 不可建索引，必须手动）：
 *
 * 集合 | 索引字段 | 用途
 * activities | {organizerId:1, status:1, time:1} | get-activities
 * registrations | {activityId:1, userId:1} | 报名查询
 * registrations | {activityId:1, applyStatus:1, cancelStatus:1} | 名单
 * matches | {activityId:1, roundOrder:1} | 赛程
 * photos | {activityId:1, createdAt:-1} | 相册
 * photos | {featured:1, featuredAt:-1} | 精选相册
 * photos | {uploadedBy:1, takenAt:-1} | 我的上传
 * photo_comments | {photoId:1, parentCommentId:1, createdAt:1} | 评论/回复
 * users | {openid:1} | 唯一
 * court_assignments | {activityId:1, courtId:1} | 场地
 * activity_courts | {activityId:1, courtNo:1} | 场地定位/排序
 * teams | {activityId:1} | 队伍
 * scores | {userId:1, createdAt:-1} | 用户积分记录
 * scores | {matchId:1} | 撤销旧积分
 * rating_changes | {activityId:1, matchId:1} | 积分变更查询/撤销
 *
 * 权限规则见 badminton-app/database.rules.json（SEC-04），
 * 需在云开发控制台「数据库 → 权限设置」同步导入。
 */
