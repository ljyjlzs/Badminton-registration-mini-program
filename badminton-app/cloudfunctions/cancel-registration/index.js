/**
 * cancel-registration 云函数 - 用户申请取消报名
 * 
 * 功能：
 * 1. 校验用户已报名、活动处于报名中状态
 * 2. 设置 cancel_status = 'pending'，等待组织者审批
 * 
 * 入参：{ activityId }
 * 出参：{ success, data: { cancel_status } }
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { activityId } = event;
  
  if (!activityId) {
    return { success: false, error: '缺少活动ID' };
  }
  
  try {
    // 1. 校验活动状态
    const activityResult = await db.collection('activities').doc(activityId).get();
    const activity = activityResult.data;
    
    if (!activity) {
      return { success: false, error: '活动不存在' };
    }
    
    if (activity.status !== 'registering') {
      return { success: false, error: '活动已不在报名阶段，无法取消' };
    }
    
    // 2. 校验用户已报名
    const regResult = await db.collection('registrations').where({
      activity_id: activityId,
      user_id: openid,
      cancel_status: db.command.in([null, 'rejected']) // 只能取消正常状态或被拒绝过的
    }).get();
    
    if (!regResult.data || regResult.data.length === 0) {
      return { success: false, error: '您未报名此活动' };
    }
    
    const registration = regResult.data[0];
    
    // 3. 组织者不能取消自己的报名（想取消活动请用删除功能）
    if (activity._openid === openid) {
      return { success: false, error: '组织者无法取消报名，如需取消活动请使用删除功能' };
    }
    
    // 4. 设置 cancel_status = 'pending'
    await db.collection('registrations').doc(registration._id).update({
      data: {
        cancel_status: 'pending',
        cancel_requested_at: db.serverDate()
      }
    });
    
    return {
      success: true,
      data: {
        cancel_status: 'pending'
      },
      message: '已提交取消申请，等待组织者确认'
    };
  } catch (err) {
    console.error('取消报名失败：', err);
    return { success: false, error: err.message || '取消报名失败' };
  }
};
