/**
 * 全局常量（ENG-04）
 * 等级文案统一维护在此，各页面从这里引用，避免多处副本漂移。
 */

// 等级 1-10 文案（数组下标 = 等级 - 1）
var LEVEL_DESC = [
  '萌新·娱乐场',
  '新手·养生球',
  '新手·进阶',
  '初学者提高',
  '熟手·小对抗',
  '中级爱好者',
  '中高级玩家',
  '高级爱好者',
  '高手·大对抗',
  '专业水平'
];

// 默认等级（1-10）——与云函数 _shared/constants.js 的 DEFAULT_LEVEL 保持一致
var DEFAULT_LEVEL = 5;

module.exports = {
  LEVEL_DESC: LEVEL_DESC,
  DEFAULT_LEVEL: DEFAULT_LEVEL
};
