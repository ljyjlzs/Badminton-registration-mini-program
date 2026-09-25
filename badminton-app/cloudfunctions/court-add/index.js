/**
 * court-add 云函数 - 新增场地（08.1 addCourt）
 * payload: { activityId }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
// ARCH-04: courtLabel 统一到 _shared/validate.js
const { courtLabel } = require('./validate.js');

exports.main = async (event) => {
  const { payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    const { activityId } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };
    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data || act.data.type !== 'court-doubles') return { success: false, message: '该活动类型不支持场地划分' };
    if (act.data.organizerId !== openid) return { success: false, message: '仅组织者可加场' };
    if (act.data.status !== 'registering') return { success: false, message: '仅报名阶段可加场' };

    const courts = await db.collection('activity_courts').where({ activityId }).get();
    const list = courts.data || [];
    const nextNo = list.length + 1;
    const ppc = act.data.playersPerCourt || 4;
    const newMax = nextNo * ppc;
    // 改写 maxPlayers 前校验不能低于已报名人数（加场一般会提高上限，此处保持一致校验）
    const validCount = await db.collection('registrations')
      .where({ activityId, applyStatus: 'active', cancelStatus: _.neq('approved') })
      .count();
    if (newMax < validCount.total) {
      return { success: false, message: `人数上限（${newMax}）不能低于当前已报名人数（${validCount.total}人）` };
    }
    await db.collection('activity_courts').add({ data: { activityId, courtNo: nextNo, label: courtLabel(nextNo), capacity: ppc, createdAt: db.serverDate() } });
    const courtCount = nextNo;
    await db.collection('activities').doc(activityId).update({ data: { courtCount, maxPlayers: courtCount * ppc } });
    return { success: true, data: { courtCount, maxPlayers: courtCount * ppc, label: courtLabel(nextNo) }, message: 'ok' };
  } catch (err) {
    logger.error('court-add', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '加场失败' };
  }
};
