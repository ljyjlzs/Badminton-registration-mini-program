/**
 * unbind-partner 云函数 - 解绑搭档
 * 支持 action: unbind
 * payload: { registrationId }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action = 'unbind', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  try {
    if (action === 'unbind') return await unbindPartner(payload, openid);
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('unbind-partner', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '解绑失败' };
  }
};

async function unbindPartner(payload, openid) {
  const { registrationId } = payload;
  if (!registrationId) return { success: false, message: 'registrationId 不能为空' };
  
  // 查询报名记录
  const regRes = await db.collection('registrations').doc(registrationId).get();
  if (!regRes.data) return { success: false, message: '报名记录不存在' };
  
  const reg = regRes.data;
  
  // 验证权限：只有报名者本人可以解绑搭档
  if (reg.userId !== openid && reg.agentUserId !== openid) {
    return { success: false, message: '只有报名者本人可以解绑搭档' };
  }
  
  const partnerId = reg.partnerId;
  
  // 解绑自己
  await db.collection('registrations').doc(registrationId).update({
    data: {
      partnerId: null,
      updatedAt: db.serverDate()
    }
  });
  
  // 解绑对方
  if (partnerId) {
    const partnerReg = await db.collection('registrations')
      .where({
        activityId: reg.activityId,
        userId: partnerId,
        cancelStatus: _.neq('approved')
      })
      .get();
    
    if (partnerReg.data && partnerReg.data.length > 0) {
      await db.collection('registrations').doc(partnerReg.data[0]._id).update({
        data: {
          partnerId: null,
          updatedAt: db.serverDate()
        }
      });
    }
  }
  
  return {
    success: true,
    message: '解绑成功'
  };
}
