/**
 * 全局业务常量（ENG-11）
 * 纯字面量→常量名，零行为变化。
 * 由 cloudfunctions/sync-shared.js 复制到各云函数目录，必须本地 require('./constants.js')。
 */

// 赛程相邻两场间隔（毫秒）：15 分钟
const MATCH_SLOT_MS = 15 * 60 * 1000;

// 比分合法范围 0-30
const SCORE_MIN = 0;
const SCORE_MAX = 30;

// 活动相关上限
const ACTIVITY_LIMITS = {
  NAME: 40,        // 活动名称长度上限
  MIN_PLAYERS: 4,  // 双打报名人数下限
  MAX_PLAYERS: 100 // 报名人数上限
};

// 列表默认分页大小
const PAGE_SIZE = 20;

// 默认等级（1-10）
const DEFAULT_LEVEL = 5;

module.exports = {
  MATCH_SLOT_MS,
  SCORE_MIN,
  SCORE_MAX,
  ACTIVITY_LIMITS,
  PAGE_SIZE,
  DEFAULT_LEVEL
};
