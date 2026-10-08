/**
 * init-rules 云函数 - 初始化活动规则（幂等）
 * 对齐 RulesServiceImpl：把 01 附录默认规则写入 rules（存在则更新）
 * 安全：前端无调用（死代码收口），仅供管理员初始化；入口强制 action=init + 管理员白名单校验，
 * 且身份校验必须先于任何 db 操作（update/add 分支在校验之后）。
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 管理员白名单：优先读 process.env.ADMIN_OPENIDS（逗号分隔），也可在 HARDCODED_ADMIN_LIST 追加硬编码 openid。
// 注意 fail-closed：白名单为空时拒绝所有调用（未配置即无人可初始化，防止无鉴权写库）。
const HARDCODED_ADMIN_LIST = [];
const adminList = [
  ...HARDCODED_ADMIN_LIST,
  ...String(process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
];

function isAdmin(openid) {
  return !!openid && adminList.length > 0 && adminList.includes(openid);
}

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
  const { action = 'init', payload = {} } = event;
  // 身份校验：必须在任何 db 操作之前
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    // 此函数仅供管理员初始化规则使用，前端无调用（死代码收口）
    if (action !== 'init') return { success: false, message: '此函数仅供管理员初始化规则使用' };
    if (!openid) return { success: false, message: '此函数仅供管理员初始化规则使用' };
    if (!isAdmin(openid)) return { success: false, message: '此函数仅供管理员初始化规则使用' };
    // update/add 分支均在身份校验之后
    const existing = await db.collection('rules').where({ type: 'rules' }).limit(1).get();
    if (existing.data && existing.data.length > 0) {
      await db.collection('rules').doc(existing.data[0]._id).update({
        data: { sections: DEFAULT_SECTIONS, updatedAt: db.serverDate() }
      });
    } else {
      await db.collection('rules').add({
        data: { type: 'rules', title: '默认规则', sections: DEFAULT_SECTIONS, createdAt: db.serverDate(), updatedAt: db.serverDate() }
      });
    }
    return { success: true, data: { sections: DEFAULT_SECTIONS }, message: '规则初始化成功' };
  } catch (err) {
    logger.error('init-rules', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '初始化规则失败' };
  }
};
