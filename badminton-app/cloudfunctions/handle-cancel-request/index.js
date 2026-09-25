/**
 * handle-cancel-request 云函数 - 组织者审批取消
 * 对齐 RegistrationServiceImpl：approve 解绑搭档→approved→currentPlayers-1→补位候补；reject→rejected
 * payload: { registrationId, decision: 'approve'|'reject' }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action = 'approve', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    const { registrationId, decision } = payload;
    if (!registrationId) return { success: false, message: 'registrationId 不能为空' };
    const regRes = await db.collection('registrations').doc(registrationId).get();
    if (!regRes.data) return { success: false, message: '报名记录不存在' };
    const reg = regRes.data;
    if (reg.cancelStatus !== 'pending') return { success: false, message: '该记录没有待审批的取消申请' };

    const actRes = await db.collection('activities').doc(reg.activityId).get();
    if (!actRes.data) return { success: false, message: '活动不存在' };
    if (actRes.data.organizerId !== openid) return { success: false, message: '仅组织者可审批' };

    const decisionVal = decision || action;
    if (decisionVal !== 'approve' && decisionVal !== 'reject') {
      return { success: false, message: 'decision 必须为 approve 或 reject' };
    }

    if (decisionVal === 'reject') {
      await db.collection('registrations').doc(registrationId).update({
        data: { cancelStatus: 'rejected', cancelProcessedAt: db.serverDate(), cancelProcessedBy: openid, updatedAt: db.serverDate() }
      });
      return { success: true, data: { cancelStatus: 'rejected' }, message: '已拒绝取消申请' };
    }

    // approve — 物理删除记录，彻底释放唯一索引，允许用户重新报名
    await db.collection('registrations').doc(registrationId).remove();
    await unbindPartner(reg);

    // 仅当原本占名额（active）才释放并补位
    if (reg.applyStatus === 'active') {
      // 先减少活动人数
      await db.collection('activities').doc(reg.activityId).update({ data: { currentPlayers: _.inc(-1) } });
      // 等待一小段时间确保数据库更新完成
      await new Promise(resolve => setTimeout(resolve, 100));
      // 再进行候补补位
      await promoteWaitlist(reg.activityId);
    }

    return { success: true, data: { cancelStatus: 'approved' }, message: '已批准取消' };
  } catch (err) {
    logger.error('handle-cancel-request', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '审批失败' };
  }
};

async function unbindPartner(reg) {
  if (!reg.partnerId) return;
  const partner = await db.collection('registrations').where({ activityId: reg.activityId, userId: reg.partnerId }).get();
  if (partner.data && partner.data.length > 0) {
    await db.collection('registrations').doc(partner.data[0]._id).update({ data: { partnerId: null } });
  }
}

async function promoteWaitlist(activityId) {
  // 重新查询活动信息，获取最新的 currentPlayers
  const actRes = await db.collection('activities').doc(activityId).get();
  const act = actRes.data;
  if (!act) return;
  
  // 查询候补用户
  const waiting = await db.collection('registrations')
    .where({ activityId, applyStatus: 'waiting' })
    .orderBy('waitlistOrder', 'asc')
    .limit(1)
    .get();
  
  if (!waiting.data || waiting.data.length === 0) return;
  
  // 检查是否还有名额（取消后 currentPlayers 已经减少，所以应该有名额）
  if (act.currentPlayers >= act.maxPlayers) return;
  
  const w = waiting.data[0];
  await db.collection('registrations').doc(w._id).update({
    data: { applyStatus: 'active', waitlistOrder: null, updatedAt: db.serverDate() }
  });
  await db.collection('activities').doc(activityId).update({ data: { currentPlayers: _.inc(1) } });
}
