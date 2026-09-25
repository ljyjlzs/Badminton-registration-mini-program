/**
 * delete-activity 云函数 - 删除活动（级联）
 * 对齐 ActivityServiceImpl.deleteActivity，仅组织者
 * payload: { activityId }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action = 'delete', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    if (action !== 'delete') return { success: false, message: '未知 action: ' + action };
    const { activityId } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };
    const actRes = await db.collection('activities').doc(activityId).get();
    if (!actRes.data) return { success: false, message: '活动不存在' };
    if (actRes.data.organizerId !== openid) return { success: false, message: '仅组织者可删除' };

    const collections = ['scores', 'matches', 'teams', 'registrations', 'rating_changes', 'badges', 'photos', 'photo_likes', 'photo_comments', 'activity_courts', 'court_assignments', 'match_live_states', 'ai_messages', 'activity_copy', 'activity_settings'];
    // COST-14: 先收集照片云文件，库删完后一并删除存储
    const photoFiles = [];
    try {
      const phRes = await db.collection('photos').where({ activityId }).get();
      (phRes.data || []).forEach(p => {
        if (p.fileID) photoFiles.push(p.fileID);
        if (p.thumbFileID) photoFiles.push(p.thumbFileID);
      });
    } catch (e) {
    logger.error('delete-activity', (typeof action !== 'undefined' ? action : '-'), { err: e }); /* photos 集合可能不存在 */ }
    for (const c of collections) {
      try {
        if (c === 'photo_likes' || c === 'photo_comments') {
          const photoIds = await db.collection('photos').where({ activityId }).get();
          for (const p of (photoIds.data || [])) {
            await db.collection(c).where({ photoId: p._id }).remove();
          }
        } else {
          await db.collection(c).where({ activityId }).remove();
        }
      } catch (e) {
    logger.error('delete-activity', (typeof action !== 'undefined' ? action : '-'), { err: e }); /* 集合不存在或无数据，跳过 */ }
    }
    await db.collection('activities').doc(activityId).remove();
    if (photoFiles.length > 0) {
      try {
        for (let i = 0; i < photoFiles.length; i += 50) {
          await cloud.deleteFile({ fileList: photoFiles.slice(i, i + 50) });
        }
      } catch (e) {
    logger.error('delete-activity', (typeof action !== 'undefined' ? action : '-'), { err: e }); /* 删除存储失败不回滚库删除 */ }
    }
    return { success: true, data: { activityId }, message: '删除成功' };
  } catch (err) {
    logger.error('delete-activity', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '删除失败' };
  }
};
