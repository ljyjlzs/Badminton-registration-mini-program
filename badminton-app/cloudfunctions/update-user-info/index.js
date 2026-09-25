/**
 * update-user-info 云函数 - 更新当前用户信息（昵称/头像）
 * 对齐 UserSummary/UserServiceImpl
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action = 'update', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { success: false, message: '未获取到用户身份，请重新进入小程序' };
  try {
    if (action === 'update') {
      const { nickname, avatar } = payload;
      const data = { updatedAt: db.serverDate() };
      if (nickname && nickname.trim()) data.nickname = nickname.trim();
      if (avatar) data.avatar = avatar;
      const res = await db.collection('users').where({ openid: openid }).limit(1).get();
      if (res.data && res.data.length > 0) {
        await db.collection('users').doc(res.data[0]._id).update({ data });
      } else {
        await db.collection('users').add({
          data: {
            openid: openid,
            nickname: nickname ? nickname.trim() : '',
            avatar: avatar || '',
            level: 5,
            rating: 1000,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
      }
      return { success: true, data: { openid: openid }, message: '更新成功' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('update-user-info', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '更新失败' };
  }
};
