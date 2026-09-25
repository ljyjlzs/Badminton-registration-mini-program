/**
 * update-user-avatar 云函数 - 更新当前用户头像
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const { action = 'update', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { success: false, message: '未获取到用户身份，请重新进入小程序' };
  try {
    if (action === 'update') {
      const { avatar } = payload;
      if (!avatar) return { success: false, message: '头像不能为空' };
      const res = await db.collection('users').where({ openid: openid }).limit(1).get();
      if (!res.data || res.data.length === 0) return { success: false, message: '用户不存在，请先完善资料' };
      await db.collection('users').doc(res.data[0]._id).update({
        data: { avatar: avatar, updatedAt: db.serverDate() }
      });
      return { success: true, data: { avatar: avatar }, message: '更新成功' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('update-user-avatar', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '更新失败' };
  }
};
