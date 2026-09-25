/**
 * photo-comments 云函数 - 图片评论（06）
 * 动作：list / add(支持 reply)
 * payload: { action, photoId, content?, parentCommentId?, replyToUserId? }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const { requireStr, LIMITS } = require('./validate.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action = 'list', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    if (action === 'list') {
      const { photoId, pageSize = 30, page = 1 } = payload;
      if (!photoId) return { success: false, message: 'photoId 不能为空' };
      const total = await db.collection('photo_comments').where({ photoId, parentCommentId: _.in([null, '']) }).count();
      const list = await db.collection('photo_comments').where({ photoId, parentCommentId: _.in([null, '']) }).orderBy('createdAt', 'asc').skip((page - 1) * pageSize).limit(pageSize).get();
      const ids = list.data.map(c => c._id);
      const replies = await db.collection('photo_comments').where({ parentCommentId: _.in(ids) }).orderBy('createdAt', 'asc').get();
      const map = {};
      replies.data.forEach(r => { (map[r.parentCommentId] = map[r.parentCommentId] || []).push(r); });
      list.data.forEach(c => { c.replies = map[c._id] || []; });
      return { success: true, data: { comments: list.data, total: total.total }, message: 'ok' };
    }
    if (action === 'add') {
      const { photoId, content, parentCommentId, replyToUserId } = payload;
      if (!photoId) return { success: false, message: 'photoId 不能为空' };
      // SEC-06: 评论内容长度校验
      const c = requireStr(content, '评论内容', LIMITS.COMMENT);
      if (!c.ok) return { success: false, message: c.message };
      const photo = await db.collection('photos').doc(photoId).get();
      if (!photo.data) return { success: false, message: '图片不存在' };
      const doc = {
        photoId, userId: openid, content: c.value,
        parentCommentId: parentCommentId || '', replyToUserId: replyToUserId || '',
        createdAt: db.serverDate()
      };
      const add = await db.collection('photo_comments').add({ data: doc });
      if (!parentCommentId) await db.collection('photos').doc(photoId).update({ data: { commentCount: _.inc(1) } });
      return { success: true, data: { commentId: add._id }, message: 'ok' };
    }
    if (action === 'delete') {
      const { commentId } = payload;
      if (!commentId) return { success: false, message: 'commentId 不能为空' };
      const comment = await db.collection('photo_comments').doc(commentId).get();
      if (!comment.data) return { success: false, message: '评论不存在' };
      // 仅评论者本人、图片上传者或活动组织者可删除（与前端 photo-album 权限一致）
      const photo = await db.collection('photos').doc(comment.data.photoId).get();
      let canDelete = comment.data.userId === openid;
      if (!canDelete && photo.data && photo.data.uploadedBy === openid) canDelete = true;
      if (!canDelete && photo.data && photo.data.activityId) {
        const actRes = await db.collection('activities').doc(photo.data.activityId).get();
        if (actRes.data && actRes.data.organizerId === openid) canDelete = true;
      }
      if (!canDelete) {
        return { success: false, message: '无权限删除' };
      }
      await db.collection('photo_comments').doc(commentId).remove();
      if (!comment.data.parentCommentId) await db.collection('photos').doc(comment.data.photoId).update({ data: { commentCount: _.inc(-1) } });
      return { success: true, data: { commentId }, message: 'ok' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('photo-comments', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '评论失败' };
  }
};
