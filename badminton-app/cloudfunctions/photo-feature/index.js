/**
 * photo-feature 云函数 - 精选/首页滚动（06）
 * 动作：feature / unfeature / listFeatured
 * payload: { action, photoId }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action = 'listFeatured', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    if (action === 'listFeatured') {
      // AI-46: 返回候选（未精选）照片供选择；传 includeFeatured=true 时返回已精选
      const baseWhere = payload.activityId ? { activityId: payload.activityId } : {};
      const where = payload.includeFeatured
        ? Object.assign({}, baseWhere, { featured: true })
        : Object.assign({}, baseWhere, { featured: _.neq(true) });
      const list = await db.collection('photos').where(where).orderBy('featuredAt', 'desc').limit(10).get();
      return { success: true, data: { photos: list.data }, message: 'ok' };
    }
    const { photoId } = payload;
    if (!photoId) return { success: false, message: 'photoId 不能为空' };
    const photo = await db.collection('photos').doc(photoId).get();
    if (!photo.data) return { success: false, message: '图片不存在' };
    const act = await db.collection('activities').doc(photo.data.activityId).get();
    if (!act.data || act.data.organizerId !== openid) return { success: false, message: '仅组织者可精选' };
    if (action === 'feature') {
      await db.collection('photos').doc(photoId).update({ data: { featured: true, featuredAt: db.serverDate() } });
      return { success: true, data: { featured: true }, message: 'ok' };
    }
    if (action === 'unfeature') {
      await db.collection('photos').doc(photoId).update({ data: { featured: false } });
      return { success: true, data: { featured: false }, message: 'ok' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('photo-feature', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '精选失败' };
  }
};
