var cloud = require('wx-server-sdk');
var logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
var db = cloud.database();
var _ = db.command;

exports.main = async function(event, context) {
  var action = event.action || 'join';
  var payload = event.payload || {};
  var wxContext = cloud.getWXContext();
  var openid = wxContext.OPENID;
  try {
    if (action === 'join') return await doJoin(payload, openid);
    if (action === 'check-conflict') return await doCheckConflict(payload, openid);
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('join-activity', action, { err: err });
    return { success: false, message: err.message || '报名失败' };
  }
};

async function doJoin(payload, openid) {
  var activityId = payload.activityId;
  var nickname = payload.nickname;
  var avatar = payload.avatar || '';
  var level = payload.level;
  var partnerId = payload.partnerId;
  var agent = payload.agent;
  var agentName = payload.agentName;
  var agentPhone = payload.agentPhone;

  if (!nickname || nickname.trim().length < 2) return { success: false, message: '请输入有效的名字（至少2个字符）' };
  if (!agent && !avatar) return { success: false, message: '请上传头像' };
  if (!level || level < 1 || level > 10) return { success: false, message: '等级必须在1-10之间' };
  if (!activityId) return { success: false, message: '活动ID不能为空' };

  var actRes = await db.collection('activities').doc(activityId).get();
  if (!actRes.data) return { success: false, message: '活动不存在' };
  var activity = actRes.data;
  if (activity.status !== 'registering') return { success: false, message: '活动已开始或已结束，无法报名' };

  // 冲突检测（非代报时）- 仅检测，不阻止报名
  var conflicts = [];
  if (!agent) {
    conflicts = await checkConflict(openid, activityId, activity.time);
    // 冲突检测不阻止报名，只返回冲突信息
  }

  // 先清理可能存在的脏数据
  try {
    await db.collection('registrations').where({ activityId: null, userId: openid }).remove();
  } catch (e) {}

  // 代报时检查被代报人姓名是否重复，非代报时检查当前用户是否已报名
  if (agent) {
    // 代报：检查被代报人姓名是否重复
    var existingByName = await db.collection('registrations').where({
      activityId: activityId,
      nickname: nickname.trim(),
      cancelStatus: _.neq('approved')
    }).get();
    
    if (existingByName.data && existingByName.data.length > 0) {
      return { success: false, message: '该姓名已在活动中报名' };
    }
  } else {
    // 非代报：检查当前用户是否已报名
    var myRegs = await db.collection('registrations').where({ activityId: activityId, userId: openid }).get();
    var myActive = null;
    var myCancelled = null;
    var myRejected = [];
    (myRegs.data || []).forEach(function(r) {
      if (r.cancelStatus === 'approved') {
        myCancelled = r;
      } else if (r.cancelStatus === 'rejected' || r.cancelStatus === 'pending') {
        myRejected.push(r);
      } else {
        myActive = r;
      }
    });

    // 清理 rejected/pending 的记录（取消被拒绝或待审批的旧记录不影响重新报名）
    // 若该记录仍占正式名额（applyStatus=active），删除时同步回收名额
    for (var i = 0; i < myRejected.length; i++) {
      try {
        if (myRejected[i].applyStatus === 'active') {
          await db.collection('activities').doc(activityId).update({ data: { currentPlayers: _.inc(-1) } });
        }
        await db.collection('registrations').doc(myRejected[i]._id).remove();
      } catch (e) {}
    }

    // 如果有已取消的记录，删除它以便重新报名
    if (myCancelled && !myActive) {
      try {
        await db.collection('registrations').doc(myCancelled._id).remove();
      } catch (e) {
        // remove 失败时，清除 userId 以绕过唯一索引
        console.error('删除已取消记录失败，尝试清除userId:', e.message);
        await db.collection('registrations').doc(myCancelled._id).update({
          data: { userId: 'cancelled_' + myCancelled._id, updatedAt: db.serverDate() }
        });
      }
    }

    if (myActive) return { success: false, message: '您已报名此活动' };
  }

  if (activity.type === 'fixed-doubles' && partnerId) {
    var partnerReg = await db.collection('registrations').where({
      activityId: activityId,
      userId: partnerId,
      cancelStatus: _.neq('approved')
    }).get();
    if (!partnerReg.data || partnerReg.data.length === 0) return { success: false, message: '所选搭档尚未报名' };
    if (partnerReg.data[0].partnerId) return { success: false, message: '所选搭档已有搭档，请选择其他人' };
  }
  if (activity.type === 'fixed-doubles') {
    var bound = await db.collection('registrations').where({
      activityId: activityId,
      partnerId: openid,
      cancelStatus: _.neq('approved')
    }).get();
    if (bound.data && bound.data.length > 0) return { success: false, message: '您已被选为搭档，无需再报名' };
  }

  // 容量检查 + 三步写入（报名 + 人数 + 搭档绑定）放同一事务：
  // count→add→inc 原子化，避免并发报名超卖
  var transaction = await db.startTransaction();
  try {
    var validCount = await transaction.collection('registrations').where({
      activityId: activityId,
      applyStatus: 'active',
      cancelStatus: _.neq('approved')
    }).count();

    var isWaiting = validCount.total >= activity.maxPlayers;

    var regData = {
      activityId: activityId,
      userId: agent ? ('agent_' + openid + '_' + Date.now()) : openid,
      nickname: nickname.trim(),
      avatar: avatar,
      level: Number(level),
      partnerId: partnerId || null,
      teamId: null,
      applyStatus: isWaiting ? 'waiting' : 'active',
      cancelStatus: null,
      agentUserId: agent ? openid : null,
      agentName: agent ? (agentName || nickname.trim()) : null,
      agentPhone: agent ? (agentPhone || '') : null,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    };

    if (isWaiting) {
      var wl = await transaction.collection('registrations').where({ activityId: activityId, applyStatus: 'waiting' }).count();
      regData.waitlistOrder = wl.total + 1;
    }

    var addRes = await transaction.collection('registrations').add({ data: regData });
    var registrationId = addRes._id;

    if (!isWaiting) {
      await transaction.collection('activities').doc(activityId).update({ data: { currentPlayers: _.inc(1) } });
    }

    if (partnerId) {
      await transaction.collection('registrations').where({ activityId: activityId, userId: partnerId }).update({ data: { partnerId: openid } });
    }

    await transaction.commit();

    return {
      success: true,
      data: {
        registrationId: registrationId,
        applyStatus: regData.applyStatus,
        isWaiting: isWaiting,
        hasConflict: conflicts.length > 0,
        conflicts: conflicts,
        agentName: regData.agentName || null,
        agentPhone: regData.agentPhone || null
      },
      message: isWaiting ? '报名成功，已进入候补' : '报名成功'
    };
  } catch (e) {
    await transaction.rollback();
    if (e.message && e.message.indexOf('duplicate key') !== -1) {
      return { success: false, message: '您已报名此活动，请勿重复报名' };
    }
    throw e;
  }
}

// 冲突检测 action
async function doCheckConflict(payload, openid) {
  var activityId = payload.activityId;
  if (!activityId) return { success: false, message: '活动ID不能为空' };
  
  var actRes = await db.collection('activities').doc(activityId).get();
  if (!actRes.data) return { success: false, message: '活动不存在' };
  
  var conflicts = await checkConflict(openid, activityId, actRes.data.time);
  
  return {
    success: true,
    data: {
      hasConflict: conflicts.length > 0,
      conflicts: conflicts
    }
  };
}

// 冲突检测函数
async function checkConflict(openid, activityId, activityTime) {
  if (!activityTime) return [];
  
  var activityTimeDate = new Date(activityTime);
  if (isNaN(activityTimeDate.getTime())) return [];
  
  // 查询用户所有 active 状态的报名
  var myRegs = await db.collection('registrations').where({
    userId: openid,
    applyStatus: 'active',
    cancelStatus: _.neq('approved')
  }).get();
  
  if (!myRegs.data || myRegs.data.length === 0) return [];
  
  // 获取所有已报名的活动ID
  var activityIds = myRegs.data.map(function(r) { return r.activityId; }).filter(function(id) { return id !== activityId; });
  
  if (activityIds.length === 0) return [];
  
  // 查询这些活动的信息
  var activities = await db.collection('activities').where({
    _id: _.in(activityIds)
  }).get();
  
  // 检查时间冲突（前后2小时内）
  var conflicts = [];
  for (var i = 0; i < activities.data.length; i++) {
    var act = activities.data[i];
    if (!act.time) continue;
    
    var actTime = new Date(act.time);
    if (isNaN(actTime.getTime())) continue;
    
    var timeDiff = Math.abs(activityTimeDate.getTime() - actTime.getTime());
    var hoursDiff = timeDiff / (1000 * 60 * 60);
    
    if (hoursDiff <= 2) {
      conflicts.push({
        activityId: act._id,
        name: act.name || '未命名活动',
        time: act.time,
        location: act.location || '待定'
      });
    }
  }
  
  return conflicts;
}
