/**
 * get-activities 云函数 - 活动列表（对齐 ActivityServiceImpl.getActivities）
 * 动作：list
 * payload: { type: 'organized'|'joined'|'available'|'search'|'unavailable', keyword?, page?, pageSize? }
 * 返回 data: { list, total, page, hasMore }（BUG-6/UX-25 分页改造）
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
// ENG-11: 默认分页常量（由 sync-shared.js 复制）
const { PAGE_SIZE } = require('./constants.js');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// ENG-04：查询期投影，避免拉回整文档（project() 仍做 camelCase 映射兜底）
const ACT_FIELDS = {
  name: 1, time: 1, location: 1, province: 1, city: 1, district: 1,
  type: 1, status: 1, maxPlayers: 1, minPlayers: 1, currentPlayers: 1,
  organizerId: 1, courtCount: 1, playersPerCourt: 1
};

function project(a) {
  return {
    id: a._id,
    name: a.name,
    time: a.time,
    location: a.location,
    province: a.province,
    city: a.city,
    district: a.district,
    type: a.type,
    status: a.status,
    maxPlayers: a.maxPlayers,
    minPlayers: a.minPlayers,
    currentPlayers: a.currentPlayers,
    organizerId: a.organizerId,
    courtCount: a.courtCount,
    playersPerCourt: a.playersPerCourt
  };
}

exports.main = async (event) => {
  const { action = 'list', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    if (action !== 'list') return { success: false, message: '未知 action: ' + action };
    const { type = 'available', keyword } = payload;
    // BUG-6: pageSize 默认 20，上限 100
    const page = Math.max(Number(payload.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(payload.pageSize) || PAGE_SIZE, 1), 100);
    const skip = (page - 1) * pageSize;

    let activities = [];
    let total = 0;

    if (type === 'organized') {
      const where = { organizerId: openid };
      // PERF-04: count 与列表查询互不依赖，并行
      const [cnt, r] = await Promise.all([
        db.collection('activities').where(where).count(),
        db.collection('activities').where(where).field(ACT_FIELDS).orderBy('time', 'desc').skip(skip).limit(pageSize).get()
      ]);
      total = cnt.total;
      activities = r.data || [];
    } else if (type === 'joined') {
      // regs 决定 where，保留串行
      const regs = await db.collection('registrations').where({ userId: openid, applyStatus: 'active', cancelStatus: _.neq('approved') }).limit(1000).get();
      const ids = (regs.data || []).map(r => r.activityId);
      if (ids.length > 0) {
        const where = { _id: _.in(ids) };
        // PERF-04: count 与列表查询互不依赖，并行
        const [cnt, r] = await Promise.all([
          db.collection('activities').where(where).count(),
          db.collection('activities').where(where).field(ACT_FIELDS).orderBy('time', 'desc').skip(skip).limit(pageSize).get()
        ]);
        total = cnt.total;
        activities = r.data || [];
      }
    } else if (type === 'available') {
      // BUG-6: 过滤下推到数据库
      // regs 决定 joinedIds，保留串行
      const regs = await db.collection('registrations').where({ userId: openid, applyStatus: 'active' }).limit(1000).get();
      const joinedIds = (regs.data || []).map(x => x.activityId);
      const where = {
        status: 'registering',
        organizerId: _.neq(openid),
        ...(joinedIds.length > 0 ? { _id: _.nin(joinedIds) } : {})
      };
      // PERF-04: count 与列表查询互不依赖，并行
      const [cnt, r] = await Promise.all([
        db.collection('activities').where(where).count(),
        db.collection('activities').where(where).field(ACT_FIELDS).orderBy('time', 'asc').skip(skip).limit(pageSize).get()
      ]);
      total = cnt.total;
      activities = r.data || [];
    } else if (type === 'search') {
      if (!keyword) return { success: true, data: { list: [], total: 0, page, hasMore: false }, message: 'ok' };
      const kw = keyword.trim();
      // BUG-6: 关键字搜索下推到数据库正则
      const searchCond = _.or([
        { name: db.RegExp({ regexp: kw, options: 'i' }) },
        { location: db.RegExp({ regexp: kw, options: 'i' }) }
      ]);
      const fullWhere = _.and([{ status: 'registering' }, searchCond]);
      // PERF-04: count 与列表查询互不依赖，并行
      const [cnt, r] = await Promise.all([
        db.collection('activities').where(fullWhere).count(),
        db.collection('activities').where(fullWhere).field(ACT_FIELDS).orderBy('time', 'asc').skip(skip).limit(pageSize).get()
      ]);
      total = cnt.total;
      activities = r.data || [];
    } else if (type === 'unavailable') {
      const where = { status: _.in(['grouping', 'playing', 'finished']) };
      // PERF-04: count 与列表查询互不依赖，并行
      const [cnt, r] = await Promise.all([
        db.collection('activities').where(where).count(),
        db.collection('activities').where(where).field(ACT_FIELDS).orderBy('time', 'desc').skip(skip).limit(pageSize).get()
      ]);
      total = cnt.total;
      activities = r.data || [];
    } else {
      return { success: false, message: '无效的 type: ' + type };
    }

    // 关键字过滤（非 search 类型的附加过滤，仍走内存——数据量已在 pageSize 内）
    if (keyword && type !== 'search') {
      const kw = keyword.trim();
      activities = activities.filter(a => (a.name && a.name.includes(kw)) || (a.location && a.location.includes(kw)));
    }

    const hasMore = skip + activities.length < total;
    return { success: true, data: { list: activities.map(project), total, page, hasMore }, message: 'ok' };
  } catch (err) {
    logger.error('get-activities', action, { err: err });
    return { success: false, message: err.message || '获取活动列表失败' };
  }
};
