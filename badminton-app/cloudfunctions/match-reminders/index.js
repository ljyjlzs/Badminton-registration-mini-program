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
  // FIX-P0-2：腾讯云定时触发器实际入参为 Type:"Timer"（大写 T），原判据只认小写 'timer'
  // 导致守卫不命中、落到 action:'get' 分支空转。改为大小写不敏感。
  const triggerType = event && event.Type != null ? String(event.Type).toLowerCase() : '';
  if (event && (event.triggers || triggerType === 'timer' || event.action === 'cron')) {
    try {
      return await sendUpcomingReminders();
    } catch (err) {
      // FIX-P0-3：原写法 typeof action 引用下方 :const action 才声明的变量，
      // 在 TDZ 内 typeof 同样抛 ReferenceError，导致定时路径异常时日志全丢。
      logger.error('match-reminders', 'timer', { err: err });
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

// FIX-P0-1：模板关键词编号以模板详情页实测为准 —— thing1 / time6 / thing10
// （原代码发 thing1/time2/thing3，time6、thing10 必填却缺失 → 微信 47003 100% 拒发）
// 详见《开发交接清单》§11.11.16.3
const TEMPLATE_KEYS = { name: 'thing1', time: 'time6', location: 'thing10' };
// 微信 thing 类型硬上限 20 字符，而活动名称允许 40 字、地点无长度校验 → 必须截断
const THING_MAX_LEN = 20;

// thing 类型统一清洗：超长、空值、换行/制表符都会被微信以 47003 拒绝
// FIX：按码点（而非 UTF-16 code unit）截断，避免把 emoji 切成半个代理对
function toThing(value, fallback) {
  const s = (value == null ? '' : String(value)).replace(/[\r\n\t]+/g, ' ').trim();
  if (!s) return fallback;
  const chars = Array.from(s);
  return chars.length <= THING_MAX_LEN ? s : chars.slice(0, THING_MAX_LEN).join('');
}

// FIX-P1：微信 43101 = 用户未订阅/已消费一次性授权，属预期结果而非故障，
// 不应计入 failed —— 否则 cron 每 5 分钟重扫同一窗口时，第 2~6 次必然全 43101，
// 触发假告警「全部提醒发送失败」（同一场活动连打约 5 条）。
function isUnsubscribed(e) {
  if (!e) return false;
  const code = e.errCode != null ? e.errCode
    : (e.errcode != null ? e.errcode
      : (e.code != null ? e.code : NaN));
  if (Number(code) === 43101) return true;
  const msg = String((e && (e.errMsg || e.message)) || '');
  return msg.indexOf('43101') >= 0;
}

// 构造订阅消息 data；两处 send（定时批量 / 组织者手动）共用，避免键名再次漂移
function buildReminderData(act) {
  const a = act || {};
  const data = {};
  data[TEMPLATE_KEYS.name] = { value: toThing(a.name, '羽毛球活动') };
  data[TEMPLATE_KEYS.time] = { value: String(a.time || '').trim() };
  // 正常创建流程 location 必非空（create-activity/index.js:91），
  // 此处兜底只为覆盖历史脏数据 —— 空串会被微信拒，兜底后至少能送达
  data[TEMPLATE_KEYS.location] = { value: toThing(a.location, '待定场地') };
  return data;
}

// 开赛前 10~40 分钟扫描并推送（定时触发器调用）
async function sendUpcomingReminders() {
  const tmpl = process.env.MATCH_REMINDER_TEMPLATE_ID;
  if (!tmpl) return { success: true, data: { skipped: true, reason: '未配置 MATCH_REMINDER_TEMPLATE_ID' }, message: 'ok' };
  const now = Date.now();
  const windowEnd = now + 40 * 60 * 1000;
  const acts = await db.collection('activities').where({
    status: _.in(['registering', 'grouping'])
  }).limit(50).get();
  let sent = 0, failed = 0, unsubscribed = 0, scanned = 0;
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
          data: buildReminderData(act),
          page: 'pages/activity-detail/activity-detail?id=' + act._id
        });
        sent++;
      } catch (e) {
        // 43101（用户未订阅/一次性授权已消费）单列，不计入 failed
        if (isUnsubscribed(e)) { unsubscribed++; } else {
          logger.error('match-reminders', 'timer-send', { err: e });
          failed++;
        }
      }
    }
  }
  // FIX-P1：只在**真失败**时告警。条件用 failed>0 而非 scanned>0，
  // 避免「窗口内活动无人可发」与「43101 正常耗尽」两种非故障场景误报。
  // 计数拼进 err 串：_shared/logger.js:4 SAFE 白名单不含 scanned/failed，
  // 直接传对象字段会被静默丢弃（只有 err 有专门分支转 msg）。
  if (failed > 0 && sent === 0) {
    logger.error('match-reminders', 'timer', {
      err: '全部提醒发送失败（扫描 ' + scanned + ' 条 / 成功 ' + sent
        + ' 条 / 失败 ' + failed + ' 条 / 未订阅跳过 ' + unsubscribed + ' 条）'
    });
  }
  return { success: true, data: { scanned, sent, failed, unsubscribed }, message: 'ok' };
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
  
  let sent = 0, failed = 0, unsubscribed = 0;
  for (const uid of targets) {
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: uid,
        templateId: tmpl,
        data: buildReminderData(act.data),
        page: 'pages/activity-detail/activity-detail?id=' + activityId
      });
      sent++;
    } catch (e) {
      // 43101 属用户侧预期结果，单列不计失败
      if (isUnsubscribed(e)) { unsubscribed++; } else {
        logger.error('match-reminders', 'manual-send', { err: e });
        failed++;
      }
    }
  }

  // FIX-P1：全失败仍返回 success:true 会让故障完全不可观测。
  // 前端 0 处调用 send（死路径），改返回值不破坏任何现有调用方。
  // 只有真失败（failed>0）才算失败；全 43101 是用户没订阅，不是故障。
  const allFailed = failed > 0 && sent === 0;
  return {
    success: !allFailed,
    data: {
      sent,
      failed,
      unsubscribed,
      total: targets.length
    },
    message: allFailed
      ? '提醒全部发送失败（共 ' + targets.length + ' 条），请检查模板 ID、关键词编号与时间格式'
      : 'ok'
  };
}
