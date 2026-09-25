/**
 * album 云函数 - 相册聚合（06）
 * 动作：getPhotos(分页) / getFeatured(首页滚动) / getMyPhotos / getStats
 * payload: { action, activityId?, pageSize?, page? }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action = 'getPhotos', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    if (action === 'list' || action === 'getPhotos') {
      const { activityId, pageSize = 20, page = 1 } = payload;
      let q = {};
      if (activityId) q.activityId = activityId;
      const total = await db.collection('photos').where(q).count();
      const list = await db.collection('photos').where(q).orderBy('takenAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get();
      // BUG-63: 与 photo-upload list 一致，补每人点赞态 liked/likedByMe
      const photos = list.data || [];
      const photoIds = photos.map(p => p._id);
      const likedSet = new Set();
      if (openid && photoIds.length > 0) {
        const likes = await db.collection('photo_likes').where({ photoId: _.in(photoIds), userId: openid }).get();
        (likes.data || []).forEach(l => likedSet.add(l.photoId));
      }
      const withLikeState = photos.map(p => Object.assign({}, p, {
        liked: likedSet.has(p._id),
        likedByMe: likedSet.has(p._id)
      }));
      return { success: true, data: { photos: withLikeState, total: total.total, page, pageSize }, message: 'ok' };
    }
    if (action === 'getFeatured' || action === 'featured') {
      // BUG-30: 支持按 activityId 过滤（同 photo-feature AI-46），不传则兼容旧全局精选
      const { activityId } = payload;
      const where = activityId ? { featured: true, activityId } : { featured: true };
      // 相册精选 Tab 需完整列表，放宽首页滚动的 10 条上限（仅此调用方）
      const list = await db.collection('photos').where(where).orderBy('featuredAt', 'desc').limit(100).get();
      return { success: true, data: { photos: list.data }, message: 'ok' };
    }
    if (action === 'getMyPhotos' || action === 'mine') {
      const list = await db.collection('photos').where({ uploadedBy: openid }).orderBy('takenAt', 'desc').limit(50).get();
      return { success: true, data: { photos: list.data }, message: 'ok' };
    }
    if (action === 'getStats' || action === 'stats') {
      const total = await db.collection('photos').count();
      const feat = await db.collection('photos').where({ featured: true }).count();
      const my = await db.collection('photos').where({ uploadedBy: openid }).count();
      return { success: true, data: { total: total.total, featured: feat.total, my: my.total }, message: 'ok' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('album', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '相册查询失败' };
  }
};
