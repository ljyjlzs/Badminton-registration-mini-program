/**
 * court-assign 云函数 - 场地分配（08.3 autoAssign / move）
 * 动作：autoAssign(round-robin idx%courtCount) / move(targetUserId,toCourtId)
 * payload: { action, activityId, targetUserId?, toCourtId? }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action = 'autoAssign', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    const { activityId, targetUserId, toCourtId } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };
    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data || act.data.type !== 'court-doubles') return { success: false, message: '该活动类型不支持场地划分' };
    if (act.data.organizerId !== openid) return { success: false, message: '仅组织者可分配' };
    if (act.data.status !== 'registering') return { success: false, message: '仅报名阶段可分配' };

    const courts = await db.collection('activity_courts').where({ activityId }).orderBy('courtNo', 'asc').get();
    const courtList = courts.data || [];
    if (courtList.length === 0) return { success: false, message: '请先配置场地' };

    if (action === 'move') {
      if (!targetUserId || !toCourtId) return { success: false, message: 'targetUserId/toCourtId 必填' };
      const validCourtIds = courtList.map(c => c._id);
      if (!validCourtIds.includes(toCourtId)) return { success: false, message: 'toCourtId 不属于该活动的有效场地' };
      const ppc = act.data.playersPerCourt || 4;
      // 校验前置：先算目标场地移入后的容量，不通过则不写库
      const exist = await db.collection('court_assignments').where({ activityId, userId: targetUserId }).limit(1).get();
      const targetRes = await db.collection('court_assignments').where({ activityId, courtId: toCourtId }).get();
      const othersInTarget = (targetRes.data || []).filter(a => a.userId !== targetUserId).length;
      if (othersInTarget + 1 > ppc) {
        return { success: false, message: '有场地人数超过每场人数上限' };
      }
      const reg = await db.collection('registrations').where({ activityId, userId: targetUserId, applyStatus: 'active' }).limit(1).get();
      const registrationId = reg.data && reg.data[0] ? reg.data[0]._id : '';
      if (exist.data && exist.data.length > 0) {
        await db.collection('court_assignments').doc(exist.data[0]._id).update({ data: { courtId: toCourtId, registrationId } });
      } else {
        await db.collection('court_assignments').add({ data: { activityId, courtId: toCourtId, userId: targetUserId, registrationId, createdAt: db.serverDate() } });
      }
      return { success: true, message: 'ok' };
    }

    if (action === 'autoAssign') {
      const regs = await db.collection('registrations').where({ activityId, applyStatus: 'active', cancelStatus: _.neq('approved') }).get();
      const valid = regs.data || [];
      const already = await db.collection('court_assignments').where({ activityId }).get();
      const assigned = new Set((already.data || []).map(a => a.userId));
      const pending = valid.filter(r => !assigned.has(r.userId));
      let i = 0;
      for (const r of pending) {
        const court = courtList[i % courtList.length];
        await db.collection('court_assignments').add({ data: { activityId, courtId: court._id, userId: r.userId, registrationId: r._id, createdAt: db.serverDate() } });
        i++;
      }
      return { success: true, data: { assigned: pending.length }, message: 'ok' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('court-assign', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '分配失败' };
  }
};
