/**
 * cancel-registration 云函数 - 取消报名
 * 对齐 RegistrationServiceImpl.cancelRegistrationInternal（看 applyStatus，不看比赛状态）
 * payload: { registrationId } 或 { activityId }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action = 'cancel', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    if (action === 'cancel') return await doCancel(payload, openid);
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('cancel-registration', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '取消失败' };
  }
};

async function findReg(payload, openid) {
  if (payload.registrationId) {
    const r = await db.collection('registrations').doc(payload.registrationId).get();
    if (!r.data) return null;
    if (r.data.userId !== openid && r.data.agentUserId !== openid) return { forbidden: true };
    return r.data;
  }
  if (payload.activityId) {
    const list = await db.collection('registrations').where({ activityId: payload.activityId, userId: openid }).get();
    const active = (list.data || []).find(r => r.cancelStatus !== 'approved');
    return active || null;
  }
  return null;
}

async function doCancel(payload, openid) {
  const reg = await findReg(payload, openid);
  if (reg && reg.forbidden) return { success: false, message: '无权操作该报名' };
  if (!reg) return { success: false, message: '未找到报名记录' };

  if (reg.cancelStatus === 'pending') return { success: false, message: '已有待审批的取消申请' };

  // 候补：物理删除记录，释放唯一索引
  if (reg.applyStatus === 'waiting') {
    await db.collection('registrations').doc(reg._id).remove();
    return { success: true, data: { applyStatus: 'waiting', cancelStatus: 'approved' }, message: '已取消候补' };
  }

  // 有效报名：置 pending，等组织者审批
  await db.collection('registrations').doc(reg._id).update({
    data: { cancelStatus: 'pending', cancelRequestedAt: db.serverDate(), updatedAt: db.serverDate() }
  });
  return { success: true, data: { applyStatus: 'active', cancelStatus: 'pending' }, message: '取消申请已提交，等待组织者审批' };
}

async function unbindPartner(reg) {
  if (!reg.partnerId) return;
  const partner = await db.collection('registrations').where({ activityId: reg.activityId, userId: reg.partnerId }).get();
  if (partner.data && partner.data.length > 0) {
    await db.collection('registrations').doc(partner.data[0]._id).update({ data: { partnerId: null } });
  }
}
