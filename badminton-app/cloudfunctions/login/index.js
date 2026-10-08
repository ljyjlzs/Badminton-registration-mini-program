/**
 * login 云函数 - 微信授权登录
 * 
 * 功能：
 * 1. 获取微信用户 openid
 * 2. 获取用户昵称和头像
 * 3. 创建或更新用户记录
 * 
 * 入参：无（自动获取微信信息）
 * 出参：{ success, data: { openid, nickname, avatar, level } }
 */

const cloud = require('wx-server-sdk');
const logger = require('./logger');
// ENG-11: 默认等级常量（由 sync-shared.js 复制）
const { DEFAULT_LEVEL } = require('./constants.js');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  if (!openid) {
    return {
      success: false,
      message: '获取 openid 失败'
    };
  }
  
  try {
    console.log('开始登录, openid:', openid);
    
    const userInfo = (event.payload && event.payload.userInfo) || event.userInfo || {};
    
    try {
      const userResult = await db.collection('users').where({
        openid: openid
      }).get();

      if (userResult.data && userResult.data.length > 0) {
        console.log('用户已存在');
        // 兼容旧数据：确保 openid 字段存在
        if (!userResult.data[0].openid) {
          await db.collection('users').doc(userResult.data[0]._id).update({ data: { openid: openid } });
        }
        return {
          success: true,
          data: {
            _id: userResult.data[0]._id,
            openid: openid,
            nickname: userResult.data[0].nickname,
            avatar: userResult.data[0].avatar,
            level: userResult.data[0].level
          },
          message: 'ok'
        };
      }
    } catch (e) {
      console.log('查询用户失败或集合不存在, 创建新用户');
    }

    const newUser = {
      openid: openid,
      nickname: userInfo.nickname || userInfo.nickName || '',
      avatar: userInfo.avatar || userInfo.avatarUrl || '',
      level: DEFAULT_LEVEL,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    };
    
    const addResult = await db.collection('users').add({
      data: newUser
    });
    
    console.log('新用户创建成功');
    return {
      success: true,
      data: {
        _id: addResult._id,
        openid: openid,
        nickname: newUser.nickname,
        avatar: newUser.avatar,
        level: newUser.level
      },
      message: 'ok'
    };
  } catch (err) {
    logger.error('login', 'login', { err: err });
    console.error('登录失败：', err);
    return {
      success: false,
      message: err.message || '登录失败'
    };
  }
};
