/**
 * court-config 云函数 - 场地配置（08.1，对齐 CourtAssignServiceImpl）
 * 动作：config(单场地人数配置，自动建首场地/同步容量)
 * payload: { action:'config', activityId, playersPerCourt }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
// ARCH-04: courtLabel 统一到 _shared/validate.js
const { courtLabel } = require('./validate.js');

exports.main = async (event) => {
  const { action = 'config', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    const { activityId, playersPerCourt } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };
    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data) return { success: false, message: '活动不存在' };
    if (act.data.type !== 'court-doubles') return { success: false, message: '该活动类型不支持场地划分' };
    if (act.data.organizerId !== openid) return { success: false, message: '仅组织者可配置' };
    if (act.data.status !== 'registering') return { success: false, message: '仅报名阶段可配置场地' };

    const ppc = Number(playersPerCourt);
    if (!(ppc >= 4)) return { success: false, message: '每场人数至少4人' };

    // 改写 maxPlayers 前校验不能低于已报名人数（对齐 update-max-players）
    const validCount = await db.collection('registrations')
      .where({ activityId, applyStatus: 'active', cancelStatus: _.neq('approved') })
      .count();

    const courts = await db.collection('activity_courts').where({ activityId }).get();
    const list = courts.data || [];
    const newMaxPreview = list.length === 0 ? ppc : list.length * ppc;
    if (newMaxPreview < validCount.total) {
      return { success: false, message: `人数上限（${newMaxPreview}）不能低于当前已报名人数（${validCount.total}人）` };
    }
    if (list.length === 0) {
      await db.collection('activity_courts').add({ data: { activityId, courtNo: 1, label: courtLabel(1), capacity: ppc, createdAt: db.serverDate() } });
      await db.collection('activities').doc(activityId).update({ data: { courtCount: 1, playersPerCourt: ppc, maxPlayers: ppc } });
      return { success: true, data: { courtCount: 1, playersPerCourt: ppc, maxPlayers: ppc }, message: 'ok' };
    }
    // 校验新容量不小于当前人数最多的场地
    const allAsg = await db.collection('court_assignments').where({ activityId }).get();
    const cntByCourt = {};
    (allAsg.data || []).forEach(a => { cntByCourt[a.courtId] = (cntByCourt[a.courtId] || 0) + 1; });
    for (const c of list) {
      const n = cntByCourt[c._id] || 0;
      if (ppc < n) return { success: false, message: '每场人数不可小于当前人数最多的场地' };
    }
    for (const c of list) {
      await db.collection('activity_courts').doc(c._id).update({ data: { capacity: ppc } });
    }
    const courtCount = list.length;
    await db.collection('activities').doc(activityId).update({ data: { playersPerCourt: ppc, maxPlayers: courtCount * ppc } });
    return { success: true, data: { courtCount, playersPerCourt: ppc, maxPlayers: courtCount * ppc }, message: 'ok' };
  } catch (err) {
    logger.error('court-config', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '场地配置失败' };
  }
};
