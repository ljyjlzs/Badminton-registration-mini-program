/**
 * handle-cancel-request 云函数 - 组织者审批取消报名请求
 * 
 * 功能：
 * 1. 校验调用者是活动组织者
 * 2. approve：标记已取消，减少活动人数，固搭则清空搭档的 partner_id
 * 3. reject：标记已拒绝
 * 
 * 入参：{ registrationId, action: 'approve' | 'reject' }
 * 出参：{ success, message }
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
  const { registrationId, action } = event;
  
  if (!registrationId || !action) {
    return { success: false, error: '缺少参数' };
  }
  
  if (action !== 'approve' && action !== 'reject') {
    return { success: false, error: 'action 必须为 approve 或 reject' };
  }
  
  try {
    // 1. 获取报名记录
    const regResult = await db.collection('registrations').doc(registrationId).get();
    const registration = regResult.data;
    
    if (!registration) {
      return { success: false, error: '报名记录不存在' };
    }
    
    if (registration.cancel_status !== 'pending') {
      return { success: false, error: '该请求已处理' };
    }
    
    // 2. 校验组织者身份
    const activityResult = await db.collection('activities').doc(registration.activity_id).get();
    const activity = activityResult.data;
    
    if (!activity || activity.organizer_id !== openid) {
      return { success: false, error: '仅组织者可审批取消请求' };
    }
    
    // 3. 执行审批
    if (action === 'approve') {
      // 标记已取消
      await db.collection('registrations').doc(registrationId).update({
        data: {
          cancel_status: 'approved',
          cancel_handled_at: db.serverDate()
        }
      });
      
      // 减少活动人数
      await db.collection('activities').doc(registration.activity_id).update({
        data: {
          current_players: _.inc(-1)
        }
      });
      
      // 固搭活动：清空搭档的 partner_id
      if (registration.partner_id) {
        await db.collection('registrations').where({
          activity_id: registration.activity_id,
          user_id: registration.partner_id
        }).update({
          data: {
            partner_id: _.remove()
          }
        });
      }
      
      return {
        success: true,
        message: '已同意取消报名'
      };
    } else {
      // 标记已拒绝
      await db.collection('registrations').doc(registrationId).update({
        data: {
          cancel_status: 'rejected',
          cancel_handled_at: db.serverDate()
        }
      });
      
      return {
        success: true,
        message: '已拒绝取消请求'
      };
    }
  } catch (err) {
    console.error('审批取消请求失败：', err);
    return { success: false, error: err.message || '操作失败' };
  }
};
