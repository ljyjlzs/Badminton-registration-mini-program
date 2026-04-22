/**
 * updateUserInfo 云函数 - 更新用户信息
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  const { nickname } = event;
  
  if (!nickname || nickname.trim().length < 2) {
    return {
      success: false,
      error: '昵称至少2个字符'
    };
  }
  
  try {
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    
    if (userResult.data && userResult.data.length > 0) {
      await db.collection('users').doc(userResult.data[0]._id).update({
        data: {
          nickname: nickname.trim(),
          updated_at: db.serverDate()
        }
      });
    } else {
      await db.collection('users').add({
        data: {
          _openid: openid,
          nickname: nickname.trim(),
          level: 5,
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
    }
    
    return {
      success: true,
      data: { nickname: nickname.trim() }
    };
  } catch (err) {
    console.error('更新用户信息失败：', err);
    return {
      success: false,
      error: err.message || '更新失败'
    };
  }
};