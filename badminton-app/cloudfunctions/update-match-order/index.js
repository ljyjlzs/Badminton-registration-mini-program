/**
 * update-match-order 云函数 - 比赛排序
 * 支持 action: get（获取比赛排序） | save（保存比赛排序）
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action = 'get', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  try {
    if (action === 'get') return await getMatchOrder(payload, openid);
    if (action === 'save') return await saveMatchOrder(payload, openid);
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('update-match-order', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '操作失败' };
  }
};

// 获取比赛排序
async function getMatchOrder(payload, openid) {
  const { activityId } = payload;
  if (!activityId) return { success: false, message: 'activityId 不能为空' };
  
  // 查询比赛列表
  const matches = await db.collection('matches')
    .where({ activityId })
    .orderBy('roundOrder', 'asc')
    .get();
  
  // 查询队伍信息
  const teamIds = new Set();
  matches.data.forEach(m => {
    if (m.team1Id) teamIds.add(m.team1Id);
    if (m.team2Id) teamIds.add(m.team2Id);
  });
  
  const teams = await db.collection('teams')
    .where({ _id: _.in([...teamIds]) })
    .get();
  
  const teamsMap = {};
  teams.data.forEach(t => {
    teamsMap[t._id] = t;
  });
  
  // 查询活动信息，判断是否是组织者
  const actRes = await db.collection('activities').doc(activityId).get();
  const isOrganizer = actRes.data && (actRes.data.organizerId === openid || actRes.data._openid === openid);
  
  const matchList = matches.data.map(m => ({
    matchId: m._id,
    roundOrder: m.roundOrder || 0,
    team1Name: teamsMap[m.team1Id]?.name || '队伍1',
    team2Name: teamsMap[m.team2Id]?.name || '队伍2',
    status: m.status || 'pending',
    team1Score: m.team1Score,
    team2Score: m.team2Score,
    scheduledTime: m.scheduledTime
  }));
  
  return {
    success: true,
    data: {
      matches: matchList,
      isOrganizer: isOrganizer
    }
  };
}

// 保存比赛排序
async function saveMatchOrder(payload, openid) {
  const { activityId, matchOrders } = payload;
  if (!activityId) return { success: false, message: 'activityId 不能为空' };
  if (!matchOrders || !Array.isArray(matchOrders) || matchOrders.length === 0) {
    return { success: false, message: 'matchOrders 不能为空' };
  }
  
  // 验证是否是组织者
  const actRes = await db.collection('activities').doc(activityId).get();
  if (!actRes.data) return { success: false, message: '活动不存在' };
  
  const isOrganizer = actRes.data.organizerId === openid || actRes.data._openid === openid;
  if (!isOrganizer) {
    return { success: false, message: '只有组织者可以调整比赛顺序' };
  }

  // 状态校验：比赛开始后（playing/finished）不允许再调整顺序
  const actStatus = actRes.data.status;
  if (actStatus === 'playing' || actStatus === 'finished') {
    return { success: false, message: '比赛已开始，无法调整顺序' };
  }

  // 校验 matchId 归属：所有比赛必须属于传入的 activityId
  const matchIds = matchOrders.map(item => item && item.matchId).filter(Boolean);
  if (matchIds.length === 0) {
    return { success: false, message: 'matchOrders 缺少有效 matchId' };
  }
  const ownedRes = await db.collection('matches')
    .where({ _id: _.in(matchIds), activityId })
    .get();
  const ownedIds = new Set((ownedRes.data || []).map(m => m._id));
  const invalidIds = matchIds.filter(id => !ownedIds.has(id));
  if (invalidIds.length > 0) {
    return { success: false, message: '存在不属于该活动的比赛: ' + invalidIds.join(', ') };
  }
  // locked 校验：已结束/确认中的比赛不允许改顺序
  const lockedMatches = (ownedRes.data || []).filter(m => m.status === 'finished' || m.status === 'confirming' || m.status === 'playing');
  if (lockedMatches.length > 0) {
    return { success: false, message: '存在已开始或已结束的比赛，无法调整顺序' };
  }

  // 校验 order：必须为整数且在 1..matchOrders.length 范围内
  for (const item of matchOrders) {
    const order = item && item.order;
    if (!Number.isInteger(order) || order < 1 || order > matchOrders.length) {
      return { success: false, message: `比赛顺序必须是1到${matchOrders.length}之间的整数` };
    }
  }

  // 批量更新比赛顺序
  const updatePromises = matchOrders.map(item => {
    if (!item.matchId || item.order === undefined) return Promise.resolve();

    return db.collection('matches').doc(item.matchId).update({
      data: {
        roundOrder: item.order,
        updatedAt: db.serverDate()
      }
    });
  });
  
  await Promise.all(updatePromises);
  
  return {
    success: true,
    message: '保存成功'
  };
}
