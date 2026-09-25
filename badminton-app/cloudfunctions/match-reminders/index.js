/**
 * match-reminders 云函数 - 比赛提醒
 * 支持 action: get（获取比赛提醒） | preview（预览提醒内容） | send（发送提醒）
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const { isSyntheticId } = require('./idPrefixes.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  // UX-02：定时触发器入口（config.json triggers）；无 openid 时走批量扫描
  if (event && (event.triggers || event.Type === 'timer' || event.action === 'cron')) {
    try {
      return await sendUpcomingReminders();
    } catch (err) {
    logger.error('match-reminders', (typeof action !== 'undefined' ? action : '-'), { err: err });
      return { success: false, message: err.message || '定时提醒失败' };
    }
  }
  const { action = 'get', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    // UX-02：模板 ID 配置下发（与 process.env 同源，供小程序申请订阅时使用）
    if (action === 'config') {
      return {
        success: true,
        data: { matchReminder: process.env.MATCH_REMINDER_TEMPLATE_ID || '' },
        message: 'ok'
      };
    }
    if (action === 'get') return await getReminders(payload, openid);
    if (action === 'preview') return await previewReminders(payload, openid);
    if (action === 'send') return await sendReminders(payload, openid);
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('match-reminders', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '提醒失败' };
  }
};

// 开赛前 10~40 分钟扫描并推送（定时触发器调用）
async function sendUpcomingReminders() {
  const tmpl = process.env.MATCH_REMINDER_TEMPLATE_ID;
  if (!tmpl) return { success: true, data: { skipped: true, reason: '未配置 MATCH_REMINDER_TEMPLATE_ID' }, message: 'ok' };
  const now = Date.now();
  const windowEnd = now + 40 * 60 * 1000;
  const acts = await db.collection('activities').where({
    status: _.in(['registering', 'grouping'])
  }).limit(50).get();
  let sent = 0, failed = 0, scanned = 0;
  for (const act of (acts.data || [])) {
    const t = new Date(String(act.time).replace(/-/g, '/')).getTime();
    if (!t || t < now + 10 * 60 * 1000 || t > windowEnd) continue;
    scanned++;
    const regs = await db.collection('registrations').where({
      activityId: act._id, applyStatus: 'active', cancelStatus: _.neq('approved')
    }).get();
    const targets = [];
    const seen = new Set();
    for (const r of (regs.data || [])) {
      // BUG-12: 包含代报人 agentUserId，代理报名的代报人也应收到提醒
      const ids = [r.userId, r.agentUserId].filter(Boolean);
      for (const id of ids) {
        if (!isSyntheticId(id) && !seen.has(id)) {
          seen.add(id);
          targets.push(id);
        }
      }
    }
    for (const uid of targets) {
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: uid,
          templateId: tmpl,
          data: {
            thing1: { value: act.name || '羽毛球活动' },
            time2: { value: act.time || '' },
            thing3: { value: act.location || '' }
          },
          page: 'pages/activity-detail/activity-detail?id=' + act._id
        });
        sent++;
      } catch (e) {
    logger.error('match-reminders', (typeof action !== 'undefined' ? action : '-'), { err: e }); failed++; }
    }
  }
  return { success: true, data: { scanned, sent, failed }, message: 'ok' };
}

// 获取用户比赛提醒
async function getReminders(payload, openid) {
  const { activityId } = payload;
  if (!activityId) return { success: false, message: 'activityId 不能为空' };
  
  // 查询用户的队伍
  const myTeams = await db.collection('teams')
    .where({
      activityId,
      members: openid
    })
    .get();
  
  const myTeamIds = myTeams.data.map(t => t._id);
  
  if (myTeamIds.length === 0) {
    return {
      success: true,
      data: {
        hasReminder: false,
        reminders: []
      }
    };
  }
  
  // PERF-30：team1Id/team2Id 两次查询合并为一次 _.or
  const matchesRes = await db.collection('matches')
    .where(_.or([
      { activityId, status: 'pending', team1Id: _.in(myTeamIds) },
      { activityId, status: 'pending', team2Id: _.in(myTeamIds) }
    ]))
    .get();

  const allMatches = matchesRes.data || [];
  
  // 筛选10分钟内的比赛
  const now = new Date();
  const tenMinutesLater = new Date(now.getTime() + 10 * 60 * 1000);
  
  const reminders = allMatches.filter(m => {
    if (m.scheduledTime) {
      const scheduledTime = new Date(m.scheduledTime);
      return scheduledTime <= tenMinutesLater && scheduledTime >= now;
    }
    return false;
  });
  
  return {
    success: true,
    data: {
      hasReminder: reminders.length > 0,
      reminders: reminders.map(m => ({
        matchId: m._id,
        scheduledTime: m.scheduledTime,
        message: '您有一场比赛即将开始'
      }))
    }
  };
}

// 预览提醒内容（组织者）
async function previewReminders(payload, openid) {
  const { activityId } = payload;
  if (!activityId) return { success: false, message: 'activityId 不能为空' };
  
  const act = await db.collection('activities').doc(activityId).get();
  if (!act.data) return { success: false, message: '活动不存在' };
  if (act.data.organizerId !== openid) return { success: false, message: '仅组织者可发提醒' };
  
  const regs = await db.collection('registrations').where({
    activityId,
    applyStatus: 'active',
    cancelStatus: _.neq('approved')
  }).get();
  
  const targets = [];
  const seenU = new Set();
  for (const r of (regs.data || [])) {
    const ids = [r.userId, r.agentUserId].filter(Boolean);
    for (const id of ids) {
      if (id !== openid && !isSyntheticId(id) && !seenU.has(id)) {
        seenU.add(id);
        targets.push(id);
      }
    }
  }

  return {
    success: true,
    data: {
      activityId,
      recipients: targets.length,
      message: payload.message || '记得参加今天的羽毛球活动哦～'
    }
  };
}

// 发送提醒（组织者）
async function sendReminders(payload, openid) {
  const { activityId, message } = payload;
  if (!activityId) return { success: false, message: 'activityId 不能为空' };
  
  const act = await db.collection('activities').doc(activityId).get();
  if (!act.data) return { success: false, message: '活动不存在' };
  if (act.data.organizerId !== openid) return { success: false, message: '仅组织者可发提醒' };
  
  const regs = await db.collection('registrations').where({
    activityId,
    applyStatus: 'active',
    cancelStatus: _.neq('approved')
  }).get();
  
  const targets = [];
  const seenU = new Set();
  for (const r of (regs.data || [])) {
    const ids = [r.userId, r.agentUserId].filter(Boolean);
    for (const id of ids) {
      if (id !== openid && !isSyntheticId(id) && !seenU.has(id)) {
        seenU.add(id);
        targets.push(id);
      }
    }
  }

  const tmpl = process.env.MATCH_REMINDER_TEMPLATE_ID;
  if (!tmpl) return { success: false, message: '未配置提醒模板' };
  
  let sent = 0, failed = 0;
  for (const uid of targets) {
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: uid,
        templateId: tmpl,
        data: {
          thing1: { value: act.data.name },
          time2: { value: act.data.time },
          thing3: { value: act.data.location }
        },
        page: 'pages/activity-detail/activity-detail?id=' + activityId
      });
      sent++;
    } catch (e) {
    logger.error('match-reminders', (typeof action !== 'undefined' ? action : '-'), { err: e });
      failed++;
    }
  }
  
  return {
    success: true,
    data: {
      sent,
      failed,
      total: targets.length
    }
  };
}
