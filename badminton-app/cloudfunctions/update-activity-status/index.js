const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  const { activityId, status } = event;
  
  console.log('【update-activity-status】接收到参数:', { activityId, status, openid });
  
  if (!activityId || !status) {
    return {
      success: false,
      error: '活动ID和状态不能为空'
    };
  }
  
  try {
    const activityResult = await db.collection('activities').doc(activityId).get();
    
    console.log('【update-activity-status】活动数据:', activityResult.data);
    
    if (!activityResult.data) {
      return {
        success: false,
        error: '活动不存在'
      };
    }
    
    const activity = activityResult.data;
    
    console.log('【update-activity-status】组织者ID:', activity.organizer_id, '当前用户:', openid);
    
    if (activity.organizer_id !== openid) {
      return {
        success: false,
        error: '只有组织者才能操作'
      };
    }
    
    const updateResult = await db.collection('activities').doc(activityId).update({
      data: {
        status: status
      }
    });
    
    console.log('【update-activity-status】更新结果:', updateResult);
    
    return {
      success: true,
      data: {
        message: '状态已更新'
      }
    };
  } catch (err) {
    console.error('更新活动状态失败：', err);
    return {
      success: false,
      error: err.message || '更新活动状态失败'
    };
  }
};
