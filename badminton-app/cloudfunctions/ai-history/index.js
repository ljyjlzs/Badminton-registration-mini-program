/**
 * ai-history 云函数 - 聊天历史管理
 * 
 * action: 'get' - 获取当前用户的消息历史（最近50条）
 * action: 'clear' - 清空当前用户的聊天记录
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action } = event;
  
  try {
    if (action === 'clear') {
      // 清空当前用户的聊天记录
      // 云数据库安全规则限制只能删除自己的记录
      const result = await db.collection('ai_messages')
        .where({ user_id: openid })
        .remove();
      
      return {
        success: true,
        data: { deleted: result.stats ? result.stats.removed : 0 }
      };
    }
    
    // 默认：获取历史消息（最近50条）
    const result = await db.collection('ai_messages')
      .where({ user_id: openid })
      .orderBy('created_at', 'asc')
      .limit(50)
      .get();
    
    return {
      success: true,
      data: result.data || []
    };
  } catch (err) {
    console.error('聊天历史操作失败:', err);
    return {
      success: false,
      error: err.message || '操作失败'
    };
  }
};
