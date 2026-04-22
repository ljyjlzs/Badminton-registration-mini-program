/**
 * 数据库初始化脚本
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
 * 
 * 集合索引配置：
 * 
 * users 集合索引：
 * - _id (主键，默认)
 * - openid 唯一索引
 * 
 * activities 集合索引：
 * - _id (主键，默认)
 * - organizer_id 普通索引
 * - status 普通索引
 * - created_at 普通索引
 * 
 * registrations 集合索引：
 * - _id (主键，默认)
 * - activity_id 普通索引
 * - user_id 普通索引
 * - activity_id + user_id 复合唯一索引
 * 
 * teams 集合索引：
 * - _id (主键，默认)
 * - activity_id 普通索引
 * - captain_id 普通索引
 * 
 * matches 集合索引：
 * - _id (主键，默认)
 * - activity_id 普通索引
 * - round 普通索引
 * - status 普通索引
 * 
 * scores 集合索引：
 * - _id (主键，默认)
 * - activity_id 普通索引
 * - user_id 普通索引
 * - team_id 普通索引
 */

// 数据库安全规则配置 (database-config.json)
{
  "collections": {
    "users": {
      "read": true,
      "create": "doc._openid == auth.openid",
      "update": "doc._openid == auth.openid",
      "delete": "doc._openid == auth.openid"
    },
    "activities": {
      "read": true,
      "create": "doc.organizer_id == auth.openid",
      "update": "doc.organizer_id == auth.openid",
      "delete": "doc.organizer_id == auth.openid"
    },
    "registrations": {
      "read": true,
      "create": "doc.user_id == auth.openid",
      "update": "doc.user_id == auth.openid",
      "delete": false
    },
    "teams": {
      "read": true,
      "create": "doc.captain_id == auth.openid",
      "update": true,
      "delete": true
    },
    "matches": {
      "read": true,
      "create": true,
      "update": true,
      "delete": true
    },
    "scores": {
      "read": true,
      "create": true,
      "update": true,
      "delete": true
    }
  }
}
