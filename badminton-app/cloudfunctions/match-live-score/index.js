/**
 * match-live-score 云函数 - 比分直播（07.5，订阅消息推送）
 * 动作：update(更新某场比赛实时比分) / get(当前直播)
 * payload: { action, activityId, matchId, teamAScore?, teamBScore?, subscribers?[] }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
const { requireArr } = require('./validate.js');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action = 'get', payload = {} } = event;
  // UX-02：模板 ID 配置下发（无需 activityId / 鉴权，供小程序申请订阅时使用）
  if (action === 'config') {
    return {
      success: true,
      data: { liveScore: process.env.LIVE_SCORE_TEMPLATE_ID || '' },
      message: 'ok'
    };
  }
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    const { activityId } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };
    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data) return { success: false, message: '活动不存在' };

    if (action === 'get') {
      const list = await db.collection('matches').where({ activityId, status: 'playing' }).get();
      return { success: true, data: { liveMatches: list.data }, message: 'ok' };
    }
    if (action === 'update') {
      const { matchId, team1Score, team2Score, teamAScore, teamBScore, subscribers } = payload;
      if (!matchId) return { success: false, message: 'matchId 不能为空' };
      // SEC-06: 数组入参长度校验（UX-02 后 subscribers 不再被信任使用，仍做入参约束）
      if (subscribers != null) {
        const subsCheck = requireArr(subscribers, 'subscribers');
        if (!subsCheck.ok) return { success: false, message: subsCheck.message };
      }
      const t1 = team1Score != null ? team1Score : teamAScore;
      const t2 = team2Score != null ? team2Score : teamBScore;
      const match = await db.collection('matches').doc(matchId).get();
      if (!match.data) return { success: false, message: '比赛不存在' };
      // 检查权限：通过 activityId 查组织者
      const actId = match.data.activityId;
      const act = await db.collection('activities').doc(actId).get();
      if (act.data && act.data.organizerId !== openid) return { success: false, message: '仅组织者可更新比分' };

      await db.collection('matches').doc(matchId).update({ data: { liveTeam1Score: t1, liveTeam2Score: t2, updatedAt: db.serverDate() } });

      const tmpl = process.env.LIVE_SCORE_TEMPLATE_ID;
      // UX-02：收件人改服务端按报名/队伍解析，不再信任客户端 subscribers
      let subs = [];
      try {
        const regs = await db.collection('registrations').where({
          activityId: actId, applyStatus: 'active', cancelStatus: _.neq('approved')
        }).get();
        subs = (regs.data || []).map(r => r.userId).filter(id => id && id !== openid && !/^(proxy_|agent_|cancelled_)/.test(id));
      } catch (e) {
    logger.error('match-live-score', (typeof action !== 'undefined' ? action : '-'), { err: e }); subs = []; }
      let pushed = 0;
      // BUG-44：跳过推送时返回 pushSkipped 标记，避免静默
      let pushSkipped = false;
      if (tmpl && subs.length > 0) {
        for (const uid of subs) {
          try {
            await cloud.openapi.subscribeMessage.send({
              touser: uid, templateId: tmpl,
              data: { thing1: { value: act.data.name }, number2: { value: t1 }, number3: { value: t2 } },
              page: 'pages/match-score/match-score?matchId=' + matchId
            });
            pushed++;
          } catch (e) {
    logger.error('match-live-score', (typeof action !== 'undefined' ? action : '-'), { err: e }); /* ignore */ }
        }
      } else {
        // BUG-44：跳过推送时不再静默——标记 pushSkipped，模板未配置时留下可排查的错误日志
        pushSkipped = true;
        if (!tmpl) {
          logger.error('match-live-score', (typeof action !== 'undefined' ? action : '-'), { err: 'LIVE_SCORE_TEMPLATE_ID 未配置，跳过订阅消息推送' });
        }
      }
      return { success: true, data: { matchId, team1Score: t1, team2Score: t2, pushed, pushSkipped }, message: 'ok' };
    }
    if (action === 'clear') {
      const { matchId } = payload;
      if (!matchId) return { success: false, message: 'matchId 不能为空' };
      const match = await db.collection('matches').doc(matchId).get();
      if (!match.data) return { success: false, message: '比赛不存在' };
      // 权限校验：与 update 一致，仅组织者可清除
      const actId = match.data.activityId;
      const clearAct = await db.collection('activities').doc(actId).get();
      if (clearAct.data && clearAct.data.organizerId !== openid) return { success: false, message: '仅组织者可清除比分' };

      await db.collection('matches').doc(matchId).update({ data: { liveTeam1Score: null, liveTeam2Score: null, updatedAt: db.serverDate() } });
      return { success: true, data: { matchId }, message: 'ok' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('match-live-score', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '直播更新失败' };
  }
};
