/**
 * deleteActivity 云函数 - 删除活动
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
  
  const { activityId } = event;
  
  console.log('deleteActivity 被调用, activityId:', activityId, 'openid:', openid);
  
  if (!activityId) {
    return { success: false, error: '活动ID不能为空' };
  }
  
  try {
    const activityResult = await db.collection('activities').doc(activityId).get();
    console.log('活动查询结果:', activityResult.data);
    
    if (!activityResult.data) {
      return { success: false, error: '活动不存在' };
    }
    
    const activity = activityResult.data;
    
    if (activity.organizer_id !== openid) {
      return { success: false, error: '只有组织者才能删除活动' };
    }
    
    if (activity.status !== 'registering') {
      return { success: false, error: '只能删除报名中的活动' };
    }
    
    console.log('开始删除活动...');
    
    await db.collection('activities').doc(activityId).remove();
    console.log('活动已删除');
    
    await db.collection('registrations').where({
      activity_id: activityId
    }).remove();
    console.log('报名记录已删除');
    
    console.log('删除完成');
    return { success: true };
  } catch (err) {
    console.error('删除失败:', err);
    return { success: false, error: err.message || '删除失败' };
  }
};