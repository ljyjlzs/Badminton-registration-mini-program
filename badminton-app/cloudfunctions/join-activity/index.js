/**
 * joinActivity 云函数 - 报名参加活动
 * 
 * 功能：
 * 1. 验证活动状态（必须是 registering）
 * 2. 验证人数是否已满
 * 3. 验证是否已报名
 * 4. 创建报名记录
 * 
 * 入参：{ activityId, level, nickname }
 * 出参：{ success, data: { registrationId } }
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
  
  const { activityId, level, nickname, avatar, partnerId } = event;
  
  if (!activityId) {
    return {
      success: false,
      error: '活动ID不能为空'
    };
  }
  
  if (!avatar) {
    return {
      success: false,
      error: '请上传头像'
    };
  }
  
  if (!nickname || nickname.trim().length < 2) {
    return {
      success: false,
      error: '请输入有效的名字（至少2个字符）'
    };
  }
  
  if (!level || level < 1 || level > 10) {
    return {
      success: false,
      error: '等级必须在1-10之间'
    };
  }
  
  try {
    const activityResult = await db.collection('activities').doc(activityId).get();
    
    if (!activityResult.data) {
      return {
        success: false,
        error: '活动不存在'
      };
    }
    
    const activity = activityResult.data;
    
    if (activity.status !== 'registering') {
      return {
        success: false,
        error: '活动已开始或已结束，无法报名'
      };
    }
    
    if (activity.current_players >= activity.max_players) {
      return {
        success: false,
        error: '活动报名已满'
      };
    }
    
    const existingReg = await db.collection('registrations').where({
      activity_id: activityId,
      user_id: openid
    }).get();
    
    if (existingReg.data && existingReg.data.length > 0) {
      return {
        success: false,
        error: '您已报名此活动'
      };
    }
    
    // 固搭模式：如果当前用户已被别人选为搭档，需要检查
    if (activity.type === 'fixed-doubles') {
      // 查看当前用户是否已作为搭档被绑定（通过检查是否有人的 partner_id 是自己）
      const boundReg = await db.collection('registrations').where({
        activity_id: activityId,
        partner_id: openid
      }).get();
      if (boundReg.data && boundReg.data.length > 0) {
        // 已被别人选为搭档，不允许重新选
        return { success: false, error: '您已被选为搭档，无需再报名' };
      }
    }
    
    // 固搭模式：验证搭档合法性
    if (activity.type === 'fixed-doubles' && partnerId) {
      // 搭档必须已报名
      const partnerReg = await db.collection('registrations').where({
        activity_id: activityId,
        user_id: partnerId
      }).get();
      
      if (!partnerReg.data || partnerReg.data.length === 0) {
        return { success: false, error: '所选搭档尚未报名' };
      }
      
      // 搭档不能已有搭档
      if (partnerReg.data[0].partner_id) {
        return { success: false, error: '所选搭档已有搭档，请选择其他人' };
      }
    }
    
    const registrationData = {
      activity_id: activityId,
      user_id: openid,
      nickname: nickname.trim(),
      avatar: avatar,
      level: level,
      team_id: null,
      is_eliminated: false,
      partner_id: partnerId || null,
      created_at: db.serverDate()
    };
    
    const regResult = await db.collection('registrations').add({
      data: registrationData
    });
    
    await db.collection('activities').doc(activityId).update({
      data: {
        current_players: _.inc(1)
      }
    });
    
    // 固搭模式：互相绑定搭档关系
    if (partnerId) {
      await db.collection('registrations').where({
        activity_id: activityId,
        user_id: partnerId
      }).update({
        data: { partner_id: openid }
      });
    }
    
    return {
      success: true,
      data: {
        registrationId: regResult._id
      }
    };
  } catch (err) {
    console.error('报名失败：', err);
    return {
      success: false,
      error: err.message || '报名失败'
    };
  }
};
