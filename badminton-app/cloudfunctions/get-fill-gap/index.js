/**
 * get-fill-gap 云函数 - 满员缺口补充（轻量版，05.3）
 * @deprecated 前端暂无调用方（死代码），保留仅作兼容；已补权限校验防止未授权探测
 * payload: { activityId }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    if (!openid) return { success: false, message: '未登录' };
    const { activityId } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };
    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data) return { success: false, message: '活动不存在' };
    // 权限校验：仅组织者或已报名参与者可查询缺口
    if (act.data.organizerId !== openid) {
      const myReg = await db.collection('registrations').where({ activityId, userId: openid }).count();
      if (myReg.total === 0) return { success: false, message: '无权限查询该活动缺口' };
    }
    const regs = await db.collection('registrations').where({ activityId }).get();
    const valid = (regs.data || []).filter(r => r.applyStatus === 'active' && r.cancelStatus !== 'approved');
    const vc = valid.length;
    const type = act.data.type;
    let startGap, pairGap;
    if (type === 'fixed-doubles') {
      // BUG-37: 与 get-fill-suggestions 保持一致的搭档口径
      const hasPartner = valid.filter(r => r.partnerId && valid.some(x => x.userId === r.partnerId)).length;
      pairGap = (2 - vc % 2) % 2;
      startGap = Math.max(0, 2 - Math.floor(hasPartner / 2));
    } else {
      const need = (type === 'singles') ? 4 : 2;
      startGap = Math.max(0, need - vc);
      pairGap = (need - vc % need) % need;
    }
    const waitlist = Math.max(0, act.data.currentPlayers - act.data.maxPlayers);
    return { success: true, data: { activityId, validCount: vc, pairGap, startGap, waitlist, full: startGap === 0 }, message: 'ok' };
  } catch (err) {
    logger.error('get-fill-gap', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '缺口计算失败' };
  }
};
