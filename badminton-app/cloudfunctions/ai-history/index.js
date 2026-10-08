/**
 * ai-history 云函数 - 聊天历史管理
 * 
 * action: 'get' - 获取当前用户的消息历史（最近50条）
 * action: 'clear' - 清空当前用户的聊天记录
 */

const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

// 兼容存量数据：老文档字段为 user_id/created_at，新写入为 userId/createdAt
function userFilter(openid) {
  return _.or([{ userId: openid }, { user_id: openid }]);
}

function tsOf(m) {
  const t = m.createdAt || m.created_at;
  if (!t) return 0;
  const n = new Date(t).getTime();
  return isNaN(n) ? 0 : n;
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { success: false, message: '未获取到用户身份，请重新进入小程序' };
  const { action } = event;

  try {
    if (action === 'clear') {
      // 清空当前用户的聊天记录（兼容新旧两种用户字段名）
      // 云数据库安全规则限制只能删除自己的记录
      const result = await db.collection('ai_messages')
        .where(userFilter(openid))
        .remove();

      return {
        success: true,
        data: { deleted: result.stats ? result.stats.removed : 0 },
        message: 'ok'
      };
    }

    // AI-10: 持久化操作卡片状态，历史重载时不再重置为 pending
    if (action === 'updateActionStatus') {
      const p = event.payload || {};
      const messageId = p.messageId;
      const actionStatus = p.actionStatus;
      const actionResultText = p.actionResultText || '';
      if (!messageId) return { success: false, message: 'messageId 不能为空' };
      const validStatus = ['pending', 'confirmed', 'cancelled', 'executing', 'success', 'error'];
      if (validStatus.indexOf(actionStatus) === -1) {
        return { success: false, message: '非法 actionStatus: ' + actionStatus };
      }
      const msgRes = await db.collection('ai_messages').doc(messageId).get();
      if (!msgRes.data || (msgRes.data.userId !== openid && msgRes.data.user_id !== openid)) {
        return { success: false, message: '消息不存在或无权限' };
      }
      await db.collection('ai_messages').doc(messageId).update({ data: { actionStatus, actionResultText } });
      return { success: true, data: { messageId, actionStatus, actionResultText }, message: 'ok' };
    }

    // 默认：获取最近 50 条历史消息（兼容新旧字段名，内存排序后取最近50条）
    // AI-2/AI-35: 过滤 __system_feedback，避免系统反馈文本渲染为对话
    // AI-7: orderBy desc 确保 limit(50) 取到的是最新 50 条
    const result = await db.collection('ai_messages')
      .where(_.and([userFilter(openid), { role: _.neq('__system_feedback') }]))
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const rows = (result.data || []).sort(function(a, b) { return tsOf(a) - tsOf(b); });

    return {
      success: true,
      data: rows.slice(-50),
      message: 'ok'
    };
  } catch (err) {
    logger.error('ai-history', (typeof action !== 'undefined' ? action : '-'), { err: err });
    console.error('聊天历史操作失败:', err);
    return {
      success: false,
      message: err.message || '操作失败'
    };
  }
};
