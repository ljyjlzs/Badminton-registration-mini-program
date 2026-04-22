/**
 * 云开发环境配置文件
 * 
 * 使用说明：
 * 1. 在微信开发者工具中开通云开发
 * 2. 创建云环境（建议创建两个环境，一个用于开发，一个用于生产）
 * 3. 将环境 ID 填入下方配置
 * 4. 在 project.config.json 中填写 appid
 */

module.exports = {
  // 开发环境
  env: {
    development: 'cloud1-3guy8euw3babaf6d',  // 在微信开发者工具点击云开发→环境ID复制到这里
    production: 'cloud1-3guy8euw3babaf6d',
  },
  
  // 默认环境
  defaultEnv: 'development',
  
  // 云开发配置
  cloud: true,
  
  // 数据库集合列表（需要手动在云控制台创建）
  collections: {
    users: 'users',           // 用户表
    activities: 'activities', // 活动表
    registrations: 'registrations', // 报名表
    teams: 'teams',           // 队伍表
    matches: 'matches',       // 比赛表
    scores: 'scores',         // 积分表
  }
};
