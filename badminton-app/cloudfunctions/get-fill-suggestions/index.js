/**
 * get-fill-suggestions 云函数 - 满员缺口 + 建议（05.3）
 * payload: { activityId }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function diff(a, b) { return Math.abs(a - b); }

exports.main = async (event, context) => {
  const { action = 'suggest', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    if (action !== 'suggest') return { success: false, message: '未知 action: ' + action };
    const { activityId } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };

    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data) return { success: false, message: '活动不存在' };
    if (act.data.organizerId !== openid) return { success: false, message: '仅组织者可查看' };

    const type = act.data.type;
    const regs = await db.collection('registrations').where({ activityId }).get();
    const all = regs.data || [];
    const valid = all.filter(r => r.applyStatus === 'active' && r.cancelStatus !== 'approved');
    const validCount = valid.length;
    const currentPlayers = act.data.currentPlayers;

    let pairGap = 0, startGap = 0, waitlist = 0;
    if (type === 'singles') {
      pairGap = (4 - validCount % 4) % 4;
      startGap = 4 - validCount;
      if (startGap < 0) startGap = 0;
      waitlist = Math.max(0, currentPlayers - act.data.maxPlayers);
    } else if (type === 'doubles' || type === 'court-doubles') {
      pairGap = (2 - validCount % 2) % 2;
      startGap = 2 - validCount;
      if (startGap < 0) startGap = 0;
      waitlist = Math.max(0, currentPlayers - act.data.maxPlayers);
    } else if (type === 'fixed-doubles') {
      const hasPartner = valid.filter(r => r.partnerId && valid.some(x => x.userId === r.partnerId)).length;
      pairGap = ((2 - validCount % 2) % 2) + (validCount % 2 === 0 ? 0 : 0);
      pairGap = (2 - validCount % 2) % 2;
      startGap = 2 - hasPartner / 1; // 已固搭对数待补
      startGap = 2 - Math.floor(hasPartner / 2);
      if (startGap < 0) startGap = 0;
      waitlist = Math.max(0, currentPlayers - act.data.maxPlayers);
    }

    const recommendations = [];
    if (pairGap > 0) recommendations.push(`还差 ${pairGap} 人可凑齐一对`);
    if (startGap > 0) recommendations.push(`还差 ${startGap} 人可开赛`);
    if (waitlist > 0) recommendations.push(`有 ${waitlist} 人在等待列表`);

    return {
      success: true,
      data: { activityId, activityName: act.data.name || '', type, validCount, maxPlayers: act.data.maxPlayers || 0, pairGap, startGap, waitlist, recommendations, fullHint: pairGap === 0 && startGap === 0 },
      message: 'ok'
    };
  } catch (err) {
    logger.error('get-fill-suggestions', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '缺口分析失败' };
  }
};
