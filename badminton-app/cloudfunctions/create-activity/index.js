/**
 * createActivity 云函数 - 创建活动
 * 
 * 功能：
 * 1. 验证活动信息
 * 2. 创建活动记录
 * 3. 创建者自动报名
 * 
 * 入参：{ name, time, location }
 * 出参：{ success, data: { activityId } }
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
  
  const { name, time, location, latitude, longitude, type } = event;
  
  // 验证必填字段
  if (!name || name.trim() === '') {
    return {
      success: false,
      error: '活动名称不能为空'
    };
  }
  
  if (!time || time <= Date.now()) {
    return {
      success: false,
      error: '活动时间必须是将来的时间'
    };
  }
  
  if (!location || location.trim() === '') {
    return {
      success: false,
      error: '活动地点不能为空'
    };
  }
  
  if (name.length > 50) {
    return {
      success: false,
      error: '活动名称不能超过50个字符'
    };
  }
  
  if (location.length > 100) {
    return {
      success: false,
      error: '活动地点不能超过100个字符'
    };
  }

  const activityType = type === 'singles' ? 'singles' : (type === 'fixed-doubles' ? 'fixed-doubles' : 'doubles');
   
  try {
    // 创建活动记录
    const activityData = {
      name: name.trim(),
      time: time,
      location: location.trim(),
      latitude: latitude || null,
      longitude: longitude || null,
      organizer_id: openid,
      type: activityType,
      status: 'registering',
      min_players: activityType === 'singles' ? 3 : 4,
      max_players: 100,
      current_players: 0,
      created_at: db.serverDate()
    };
    
    const activityResult = await db.collection('activities').add({
      data: activityData
    });
    
    return {
      success: true,
      data: {
        activityId: activityResult._id
      }
    };
  } catch (err) {
    console.error('创建活动失败：', err);
    return {
      success: false,
      error: err.message || '创建活动失败'
    };
  }
};
