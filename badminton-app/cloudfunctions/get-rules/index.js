/**
 * get-rules 云函数 - 读取活动规则
 * 对齐 RulesServiceImpl：读 rules(type='rules')，无则返回 01 附录默认三套规则
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const DEFAULT_SECTIONS = [
  {
    type: 'singles',
    title: '单打',
    match_rules: '21 分制；每人单独对阵；提交即生效；单循环。',
    scoring_rules: '积分=自己分−对手分（例 21-15 胜者+6/败者-6）。',
    common_rules: ''
  },
  {
    type: 'doubles',
    title: '双打轮换',
    match_rules: '21 分制；每场 4 人；每人至少与其他所有人搭档一次；循环轮转；重复组合开赛前提示确认。',
    scoring_rules: '积分同上；排名按每场平均积分（总积分÷场次）。',
    common_rules: ''
  },
  {
    type: 'fixed-doubles',
    title: '双打固搭',
    match_rules: '报名自选搭档全程固定；未配对者赛前按水平自动搭配。',
    scoring_rules: '积分同上；排名按每场平均积分。',
    common_rules: ''
  }
];

exports.main = async (event, context) => {
  const { action = 'get', payload = {} } = event;
  try {
    if (action === 'get') {
      const res = await db.collection('rules').where({ type: 'rules' }).limit(1).get();
      if (res.data && res.data.length > 0) {
        return { success: true, data: { sections: res.data[0].sections || DEFAULT_SECTIONS }, message: 'ok' };
      }
      return { success: true, data: { sections: DEFAULT_SECTIONS }, message: 'ok' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('get-rules', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '获取规则失败' };
  }
};
