/**
 * court-list 云函数 - 场地布局查看（08.2 getLayout）
 * payload: { activityId }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action = 'get', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    const { activityId } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };
    // PERF-04: activities/报名名单/参与计数互不依赖，并行查询
    const round1 = await Promise.all([
      db.collection('activities').doc(activityId).get(),
      db.collection('registrations').where({ activityId, applyStatus: 'active', cancelStatus: _.neq('approved') }).get(),
      db.collection('registrations').where({ activityId, userId: openid }).count()
    ]);
    const act = round1[0];
    if (!act.data) return { success: false, message: '活动不存在' };
    const regs = round1[1];
    const part = round1[2];
    const regMap = {}; (regs.data || []).forEach(r => regMap[r.userId] = r);
    if (act.data.organizerId !== openid && part.total === 0) return { success: false, message: '无权查看' };

    // PERF-04: 场地/用户/分配互不依赖（userId 列表已就绪），并行查询
    const userIds = (regs.data || []).map(r => r.userId);
    const round2 = await Promise.all([
      db.collection('activity_courts').where({ activityId }).orderBy('courtNo', 'asc').get(),
      userIds.length > 0 ? db.collection('users').where({ openid: _.in(userIds) }).get() : Promise.resolve({ data: [] }),
      db.collection('court_assignments').where({ activityId }).get()
    ]);
    const courts = round2[0];
    const users = round2[1];
    const allAsg = round2[2];
    const umap = {}; (users.data || []).forEach(u => umap[u.openid] = u);

    const courtsOut = [];
    const assignedIds = new Set();
    const mapByCourt = {};
    (allAsg.data || []).forEach(a => { (mapByCourt[a.courtId] = mapByCourt[a.courtId] || []).push(a); });
    for (const c of courts.data || []) {
      const asg = mapByCourt[c._id] || [];
      const members = asg.map(a => {
        assignedIds.add(a.userId);
        const u = umap[a.userId] || {};
        return { userId: a.userId, registrationId: a.registrationId, nickname: u.nickname || '球友', level: u.level || 5 };
      });
      courtsOut.push({ courtId: c._id, courtNo: c.courtNo, label: c.label, capacity: c.capacity, members });
    }
    const unassigned = (regs.data || []).filter(r => !assignedIds.has(r.userId))
      .map(r => { const u = umap[r.userId] || {}; return { userId: r.userId, nickname: u.nickname || '球友', level: u.level || 5 }; });
    return { success: true, data: { courts: courtsOut, unassigned, isOrganizer: act.data.organizerId === openid }, message: 'ok' };
  } catch (err) {
    logger.error('court-list', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '查看场地失败' };
  }
};
