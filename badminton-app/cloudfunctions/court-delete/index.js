/**
 * court-delete 云函数 - 删除场地（08.1 deleteCourt）
 * payload: { activityId, courtNo }
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
    const { activityId, courtNo } = payload;
    if (!activityId || !courtNo) return { success: false, message: 'activityId/courtNo 必填' };
    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data || act.data.organizerId !== openid) return { success: false, message: '仅组织者可删除场地' };
    if (act.data.status !== 'registering') return { success: false, message: '仅报名阶段可删场' };

    const courts = await db.collection('activity_courts').where({ activityId, courtNo: Number(courtNo) }).limit(1).get();
    if (!courts.data || courts.data.length === 0) return { success: false, message: '场地不存在' };
    const court = courts.data[0];
    const ppc = act.data.playersPerCourt || 4;
    // 删除场地会降低 maxPlayers，先校验不能低于已报名人数
    const remainBefore = await db.collection('activity_courts').where({ activityId }).count();
    const newCourtCount = Math.max(remainBefore.total - 1, 0);
    const newMax = newCourtCount * ppc;
    const validCount = await db.collection('registrations')
      .where({ activityId, applyStatus: 'active', cancelStatus: _.neq('approved') })
      .count();
    if (newMax < validCount.total) {
      return { success: false, message: `删场后人数上限（${newMax}）不能低于当前已报名人数（${validCount.total}人）` };
    }

    await db.collection('court_assignments').where({ activityId, courtId: court._id }).remove();
    await db.collection('activity_courts').doc(court._id).remove();

    const remain = await db.collection('activity_courts').where({ activityId }).get();
    const courtCount = remain.data.length;
    await db.collection('activities').doc(activityId).update({ data: { courtCount, maxPlayers: courtCount * ppc } });
    return { success: true, data: { courtCount, maxPlayers: courtCount * ppc }, message: 'ok' };
  } catch (err) {
    logger.error('court-delete', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '删场失败' };
  }
};
