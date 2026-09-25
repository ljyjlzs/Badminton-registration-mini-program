/**
 * court-ready 云函数 - 开工校验（08.7 checkReady）
 * payload: { activityId }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { payload = {} } = event;
  try {
    const { activityId } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };
    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data) return { success: false, message: '活动不存在' };
    const ppc = act.data.playersPerCourt || 4;

    const courts = await db.collection('activity_courts').where({ activityId }).get();
    const courtList = courts.data || [];
    const regs = await db.collection('registrations').where({ activityId, applyStatus: 'active', cancelStatus: _.neq('approved') }).get();
    const valid = regs.data || [];

    const messages = [];
    const userCourts = {};
    let totalAssigned = 0;
    const allAsg = await db.collection('court_assignments').where({ activityId }).get();
    const mapByCourt = {};
    (allAsg.data || []).forEach(a => { (mapByCourt[a.courtId] = mapByCourt[a.courtId] || []).push(a); });
    for (const c of courtList) {
      const asg = mapByCourt[c._id] || [];
      const n = asg.length;
      totalAssigned += n;
      asg.forEach(a => { (userCourts[a.userId] = userCourts[a.userId] || []).push(c.label); });
      if (n === 0) { messages.push(`${c.label} 无人在场`); continue; }
      if (n > 0 && n < 4) messages.push(`${c.label}仅 ${n} 人，至少需 4 人（或删除该场地）`);
      if (n > ppc) messages.push(`${c.label}有 ${n} 人，超过每场人数上限 ${ppc} 人`);
    }
    Object.keys(userCourts).forEach(u => { if (userCourts[u].length > 1) messages.push('存在重复分配到多个场地的用户（需一人一场）'); });
    const unassignedCount = valid.filter(r => !(userCourts[r.userId])).length;
    if (unassignedCount > 0) messages.push(`有 ${unassignedCount} 人未分配场地`);

    const ready = messages.length === 0 && courtList.length > 0;
    return { success: true, data: { ready, messages, totalAssigned, unassignedCount }, message: 'ok' };
  } catch (err) {
    logger.error('court-ready', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '校验失败' };
  }
};
