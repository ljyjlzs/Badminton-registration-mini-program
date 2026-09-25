/**
 * photo-like 云函数 - 点赞（06）
 * 动作：toggle / count
 * payload: { action, photoId }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action = 'toggle', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    const { photoId } = payload;
    if (!photoId) return { success: false, data: null, message: 'photoId 不能为空' };
    const photo = await db.collection('photos').doc(photoId).get();
    if (!photo.data) return { success: false, data: null, message: '照片不存在' };
    if (action === 'toggle') {
      // BUG-70: 事务包住 photo_likes 增删 + likeCount 更新，防止不一致
      const transaction = await db.startTransaction();
      try {
        const exist = await transaction.collection('photo_likes').where({ photoId, userId: openid }).limit(1).get();
        if (exist.data && exist.data.length > 0) {
          await transaction.collection('photo_likes').doc(exist.data[0]._id).remove();
          const cAfter = await transaction.collection('photo_likes').where({ photoId }).count();
          await transaction.collection('photos').doc(photoId).update({ data: { likeCount: cAfter.total } });
          await transaction.commit();
          return { success: true, data: { liked: false, likeCount: cAfter.total }, message: 'ok' };
        }
        await transaction.collection('photo_likes').add({ data: { photoId, userId: openid, createdAt: db.serverDate() } });
        const cAfter = await transaction.collection('photo_likes').where({ photoId }).count();
        await transaction.collection('photos').doc(photoId).update({ data: { likeCount: cAfter.total } });
        await transaction.commit();
        return { success: true, data: { liked: true, likeCount: cAfter.total }, message: 'ok' };
      } catch (txErr) {
    logger.error('photo-like', (typeof action !== 'undefined' ? action : '-'), { err: txErr });
        await transaction.rollback();
        throw txErr;
      }
    }
    if (action === 'count') {
      const c = await db.collection('photo_likes').where({ photoId }).count();
      return { success: true, data: { count: c.total }, message: 'ok' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('photo-like', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '点赞失败' };
  }
};
