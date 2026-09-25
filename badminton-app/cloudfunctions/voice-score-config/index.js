/**
 * voice-score-config 云函数 - 语音报比分配置（07.2）
 * 动作：get / update ；配置存于 activity_settings 集合（每活动一条）
 * payload: { action, activityId, parseRule?, enabled? }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const { rateLimit } = require('./rateLimit.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action = 'get', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  // COST-07: 限流 20 次/分钟
  const rl = rateLimit(openid, { limit: 20, windowMs: 60 * 1000 });
  if (!rl.ok) return { success: false, message: '操作太频繁，请稍后再试' };
  try {
    const { activityId } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };
    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data) return { success: false, message: '活动不存在' };
    if (act.data.organizerId !== openid) return { success: false, message: '仅组织者可配置' };

    const q = await db.collection('activity_settings').where({ activityId }).limit(1).get();
    if (action === 'get') {
      const cfg = (q.data && q.data[0]) || { voiceScoreEnabled: false, parseRule: 'default' };
      return { success: true, data: { config: cfg }, message: 'ok' };
    }
    if (action === 'update') {
      const { parseRule, enabled } = payload;
      const data = { voiceScoreEnabled: enabled != null ? enabled : false, parseRule: parseRule || 'default', updatedAt: db.serverDate() };
      if (q.data && q.data.length > 0) {
        await db.collection('activity_settings').doc(q.data[0]._id).update({ data });
      } else {
        await db.collection('activity_settings').add({ data: { activityId, ...data } });
      }
      return { success: true, data: { config: data }, message: 'ok' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('voice-score-config', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '配置失败' };
  }
};
