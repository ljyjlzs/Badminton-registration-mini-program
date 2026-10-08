/**
 * photo-upload 云函数 - 上传图片 + 元数据（06）
 * 动作：authorize(两段式上传前置鉴权) / upload(fileID 直传落库 / 旧 data base64 兼容) / list / delete(含云存储清理)
 * payload: { action, activityId, fileID?, cloudPath?, thumbData?, data?, fileName?, tags?, caption? }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const { requireArr } = require('./validate.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/**
 * 两段式 authorize 前置校验：getWXContext 取 openid，查报名表确认活动成员（或组织者），非成员拒绝
 * @param {string} activityId 活动 ID
 * @param {string} openid 调用者 OPENID
 * @param {string} [denyMessage] 非成员拒绝文案
 * @returns {Promise<{ok: boolean, message?: string, act?: object|null}>}
 */
async function assertActivityMember(activityId, openid, denyMessage) {
  if (!openid) return { ok: false, message: '未获取到用户身份，请重新进入小程序', act: null };
  const actRes = await db.collection('activities').doc(activityId).get();
  const act = actRes.data || null;
  if (!act) return { ok: false, message: '活动不存在', act: null };
  // BUG-71: 同时校验本人报名和代报人身份
  const isMember = await db.collection('registrations').where(_.and([
    { activityId },
    _.or([{ userId: openid }, { agentUserId: openid }])
  ])).count();
  if (isMember.total === 0 && act.organizerId !== openid) {
    return { ok: false, message: denyMessage || '仅活动成员可操作', act };
  }
  return { ok: true, act };
}

exports.main = async (event) => {
  const { action = 'upload', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    // 两段式上传前置鉴权：校验成员并返回约定 cloudPath，客户端只允许上传到该路径后再回填
    if (action === 'authorize') {
      const { activityId, fileName } = payload;
      if (!activityId) return { success: false, message: 'activityId 不能为空' };
      const chk = await assertActivityMember(activityId, openid, '仅活动成员可上传');
      if (!chk.ok) return { success: false, message: chk.message };
      const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const ext = (fileName || 'photo.jpg').split('.').pop().split('?')[0] || 'jpg';
      const safeExt = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext.toLowerCase()) ? ext.toLowerCase() : 'jpg';
      return {
        success: true,
        data: { activityId, cloudPath: 'photos/' + activityId + '/' + stamp + '.' + safeExt },
        message: 'ok'
      };
    }
    if (action === 'upload') {
      const { activityId, data, fileID, cloudPath, fileName, tags, caption, thumbData } = payload;
      if (!activityId) return { success: false, message: 'activityId 不能为空' };
      if (!data && !fileID) return { success: false, message: '图片数据不能为空' };
      // SEC-06: 数组入参长度校验
      if (tags != null) {
        const tagCheck = requireArr(tags, 'tags', 10);
        if (!tagCheck.ok) return { success: false, message: tagCheck.message };
      }
      // BUG-32(4): data/thumbData 长度上限，防止超大 base64 撑爆云函数入参
      const MAX_DATA_LEN = 4 * 1024 * 1024;   // ~3MB binary
      const MAX_THUMB_LEN = 512 * 1024;        // ~384KB binary
      if (data && String(data).length > MAX_DATA_LEN) return { success: false, message: '图片过大，请压缩后重试' };
      if (thumbData && String(thumbData).length > MAX_THUMB_LEN) return { success: false, message: '缩略图过大' };
      // 两段式 authorize 前置：先校验用户身份与活动成员，非成员拒绝
      // COST-05: 直传链路仍必须做成员校验，防止绕过
      const chk = await assertActivityMember(activityId, openid, '仅活动成员可上传');
      if (!chk.ok) return { success: false, message: chk.message };
      // 上传者以服务端 OPENID 为准，不信任客户端 uploadedBy
      const uploader = openid;

      let finalFileID = fileID;
      let finalCloudPath = cloudPath || '';
      const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const ext = (fileName || 'photo.jpg').split('.').pop().split('?')[0] || 'jpg';
      const safeExt = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext.toLowerCase()) ? ext.toLowerCase() : 'jpg';
      if (fileID) {
        // COST-05: 直传分支，原图已由客户端 wx.cloud.uploadFile 上传，这里只落库
        if (!finalCloudPath) {
          const m = /^cloud:\/\/[^/]+\/(.+)$/.exec(fileID);
          finalCloudPath = m ? m[1] : '';
        }
      } else {
        finalCloudPath = `photos/${activityId}/${stamp}.${safeExt}`;
        const buf = Buffer.from(data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const up = await cloud.uploadFile({ cloudPath: finalCloudPath, fileContent: buf });
        if (!up.fileID) return { success: false, message: '上传失败' };
        finalFileID = up.fileID;
      }

      // PERF-02: 缩略图单独落库到 thumbs/ 前缀，九宫格用 thumbFileID
      let thumbFileID = '';
      let thumbCloudPath = '';
      if (thumbData) {
        try {
          thumbCloudPath = `thumbs/${activityId}/${stamp}_t.${safeExt}`;
          const tbuf = Buffer.from(String(thumbData).replace(/^data:image\/\w+;base64,/, ''), 'base64');
          const tup = await cloud.uploadFile({ cloudPath: thumbCloudPath, fileContent: tbuf });
          thumbFileID = tup.fileID || '';
        } catch (e) {
    logger.error('photo-upload', (typeof action !== 'undefined' ? action : '-'), { err: e });
          thumbFileID = '';
          thumbCloudPath = '';
        }
      }

      const doc = {
        activityId, fileID: finalFileID, cloudPath: finalCloudPath,
        thumbFileID, thumbCloudPath,
        uploadedBy: uploader, tags: tags || [], caption: caption || '',
        featured: false, likeCount: 0, commentCount: 0,
        takenAt: db.serverDate(), createdAt: db.serverDate()
      };
      // COST-05: 写库失败时清理已上传文件，避免原图/缩略图成孤儿文件
      let add;
      try {
        add = await db.collection('photos').add({ data: doc });
      } catch (addErr) {
    logger.error('photo-upload', (typeof action !== 'undefined' ? action : '-'), { err: addErr });
        const orphanFiles = [finalFileID, thumbFileID].filter(Boolean);
        if (orphanFiles.length > 0) {
          try { await cloud.deleteFile({ fileList: orphanFiles }); } catch (e) {
    logger.error('photo-upload', (typeof action !== 'undefined' ? action : '-'), { err: e }); /* 清理失败则忽略 */ }
        }
        return { success: false, message: addErr.message || '照片保存失败' };
      }
      return { success: true, data: { photoId: add._id, fileID: finalFileID, thumbFileID }, message: 'ok' };
    }
    if (action === 'list') {
      const { activityId } = payload;
      if (!activityId) return { success: false, message: 'activityId 不能为空' };
      // 两段式 authorize 前置：先校验用户身份与活动成员，非成员拒绝
      const chk = await assertActivityMember(activityId, openid, '仅活动成员可查看');
      if (!chk.ok) return { success: false, message: chk.message };
      const list = await db.collection('photos').where({ activityId }).orderBy('takenAt', 'desc').get();
      const photos = list.data || [];
      // 补每人点赞态 liked/likedByMe
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
      return { success: true, data: { photos: withLikeState }, message: 'ok' };
    }
    if (action === 'delete') {
      const { photoId } = payload;
      if (!photoId) return { success: false, message: 'photoId 不能为空' };
      const photo = await db.collection('photos').doc(photoId).get();
      if (!photo.data) return { success: false, message: '照片不存在' };
      // 两段式 authorize 前置：先校验用户身份与活动成员，非成员拒绝
      const chk = await assertActivityMember(photo.data.activityId, openid, '无权限删除');
      if (!chk.ok) return { success: false, message: chk.message };
      // 仅上传者或组织者可删除
      if (photo.data.uploadedBy !== openid && chk.act.organizerId !== openid) {
        return { success: false, message: '无权限删除' };
      }
      await db.collection('photos').doc(photoId).remove();
      // 删除相关评论
      await db.collection('photo_comments').where({ photoId }).remove();
      // COST-14: 同步删除云存储文件，避免永久计费
      const files = [photo.data.fileID, photo.data.thumbFileID].filter(Boolean);
      if (files.length > 0) {
        try { await cloud.deleteFile({ fileList: files }); } catch (e) {
    logger.error('photo-upload', (typeof action !== 'undefined' ? action : '-'), { err: e }); /* 文件已不存在则忽略 */ }
      }
      return { success: true, data: { photoId }, message: 'ok' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('photo-upload', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '上传失败' };
  }
};
