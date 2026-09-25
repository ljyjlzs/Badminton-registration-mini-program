var callFunction = require('../../utils/request.js').callFunction;
var shareUtil = require('../../utils/share.js');
var nicknameUtil = require('../../utils/nickname.js');
var app = getApp();

Page({
  onShareAppMessage: function() {
    var s = shareUtil.makeShare({
      title: this.data.albumTitle || '活动相册',
      path: '/pages/photo-album/photo-album',
      query: 'activityId=' + (this.activityId || this.data.activityId || '')
    });
    return { title: s.title, path: s.path };
  },

  onShareTimeline: function() {
    var s = shareUtil.makeShare({
      title: this.data.albumTitle || '活动相册',
      path: '/pages/photo-album/photo-album',
      query: 'activityId=' + (this.activityId || this.data.activityId || '')
    });
    return { title: s.title, query: s.timeline.query };
  },

  data: {
    loading: true,
    loadingMore: false,
    activityId: '',
    photos: [],
    allPhotos: [],
    featured: [],
    currentTab: 'all',
    isOrganizer: false,
    isMember: false,
    openid: '',
    albumTitle: '',
    albumNote: '',
    aiNote: '',
    aiNoting: false,
    page: 1,
    pageSize: 20,
    renderLimit: 12,
    total: 0,
    hasMore: true,
    // Comments
    showComments: false,
    comments: [],
    commentText: '',
    commentPhotoId: '',
    // Edit album
    showEditAlbum: false,
    editTitle: '',
    editNote: '',
    // Image preview（BUG-31 预览入口精选切换）
    previewId: '',
    previewFeatured: false,
    // Context menu
    showContextMenu: false,
    contextPhotoId: '',
    contextFeatured: false,
    contextLiked: false,
    contextLikeCount: 0
  },

  onLoad: function(options) {
    this.activityId = options.activityId || '';
    this._inited = true;
    this._dirty = false;
    this.setData({
      activityId: this.activityId,
      openid: app.globalData.openid || ''
    });
    this.loadData();
  },

  onShow: function() {
    // PERF-08: 仅脏数据时刷新，预览/上传返回后仍可触发
    if (this._inited && this._dirty) {
      this._dirty = false;
      this.loadData(false, true);
    }
  },

  onReachBottom: function() {
    if (this.data.hasMore && !this.data.loadingMore && !this.data.loading) {
      this.loadData(true);
    }
  },

  // UX-26: 下拉刷新（静默刷新，避免全屏 loading 闪烁）
  onPullDownRefresh: function() {
    this.loadData(false, true);
    wx.stopPullDownRefresh();
  },

  // PERF-16: 局部更新单张照片，避免整页 loading
  updatePhotoLocal: function(photoId, patch) {
    var applyPatch = function(p) {
      var next = {};
      for (var k in p) next[k] = p[k];
      for (var k2 in patch) next[k2] = patch[k2];
      return next;
    };
    var allPhotos = (this.data.allPhotos || []).map(function(p) {
      return p._id === photoId ? applyPatch(p) : p;
    });
    var photos = allPhotos.slice(0, this.data.renderLimit);
    // BUG-30: 精选列表来自服务端（可能含未分页加载的照片），在两个数组内各自更新，勿用 photos 过滤覆盖
    var featured = (this.data.featured || []).map(function(p) {
      return p._id === photoId ? applyPatch(p) : p;
    });
    if (patch && patch.featured === true) {
      var exists = false;
      for (var i = 0; i < featured.length; i++) {
        if (featured[i]._id === photoId) { exists = true; break; }
      }
      if (!exists) {
        for (var j = 0; j < allPhotos.length; j++) {
          if (allPhotos[j]._id === photoId) { featured = featured.concat([allPhotos[j]]); break; }
        }
      }
    } else if (patch && patch.featured === false) {
      featured = featured.filter(function(p) { return p._id !== photoId; });
    }
    this.setData({ allPhotos: allPhotos, photos: photos, featured: featured });
  },

  removePhotoLocal: function(photoId) {
    var allPhotos = (this.data.allPhotos || []).filter(function(p) { return p._id !== photoId; });
    var photos = allPhotos.slice(0, this.data.renderLimit);
    var featured = (this.data.featured || []).filter(function(p) { return p._id !== photoId; });
    this.setData({ allPhotos: allPhotos, photos: photos, featured: featured });
  },

  findPhoto: function(photoId) {
    var allPhotos = this.data.allPhotos || [];
    for (var i = 0; i < allPhotos.length; i++) {
      if (allPhotos[i]._id === photoId) return allPhotos[i];
    }
    return null;
  },

  // PERF-13: 从缓冲区追加渲染，不发新请求
  showMorePhotos: function() {
    var allPhotos = this.data.allPhotos || [];
    var nextLimit = Math.min(allPhotos.length, this.data.renderLimit + 12);
    if (nextLimit <= this.data.renderLimit) return;
    this.setData({ renderLimit: nextLimit, photos: allPhotos.slice(0, nextLimit) });
  },

  // PERF-16: album list 与活动信息并行；silent 时不闪全屏 loading
  loadData: function(append, silent) {
    var self = this;
    var page = append ? (self.data.page + 1) : 1;
    if (append && (!self.data.hasMore || self.data.loadingMore)) return;
    if (!silent) {
      self.setData(append ? { loadingMore: true } : { loading: true });
    } else if (append) {
      self.setData({ loadingMore: true });
    }

    Promise.all([
      callFunction('album', 'list', {
        activityId: self.activityId,
        page: page,
        pageSize: self.data.pageSize
      }),
      // PERF-19: 只取相册需要的字段子集
      callFunction('get-activity-detail', 'detail', {
        activityId: self.activityId,
        fields: ['activity', 'isOrganizer', 'userRegistration']
      }).catch(function() { return null; })
    ]).then(function(results) {
      var res = results[0];
      var detail = results[1];
      if (!res || res.success === false) {
        self.setData({ loading: false, loadingMore: false });
        return;
      }
      var payload = res.data || {};
      var newPhotos = payload.photos || [];
      var total = payload.total || 0;
      var allPhotos = append ? self.data.allPhotos.concat(newPhotos) : newPhotos;
      // PERF-13: 首屏只提交前 renderLimit 张到渲染数组，其余留在 allPhotos 缓冲
      var renderLimit = append ? Math.min(allPhotos.length, self.data.renderLimit + 12) : Math.min(allPhotos.length, 12);
      var photos = allPhotos.slice(0, renderLimit);
      // BUG-30: 精选列表可能来自服务端（含未分页加载到的照片），只补充不在 photos 里的项，避免被本地过滤覆盖
      var localFeatured = allPhotos.filter(function(p) { return p.featured; });
      var extraFeatured = (self.data.featured || []).filter(function(f) {
        if (!f || f.featured === false) return false;
        for (var i = 0; i < allPhotos.length; i++) {
          if (allPhotos[i]._id === f._id) return false;
        }
        return true;
      });
      var featured = localFeatured.concat(extraFeatured);
      var hasMore = allPhotos.length < total;

      var activity = (detail && detail.data && detail.data.activity) ? detail.data.activity : {};
      self.setData({
        loading: false,
        loadingMore: false,
        page: page,
        total: total,
        hasMore: hasMore,
        allPhotos: allPhotos,
        renderLimit: renderLimit,
        photos: photos,
        featured: featured,
        isOrganizer: !!(detail && detail.data && detail.data.isOrganizer),
        isMember: !!(detail && detail.data && (detail.data.isOrganizer || detail.data.userRegistration)),
        albumTitle: activity.albumTitle || '',
        albumNote: activity.albumNote || ''
      });
    }).catch(function() {
      self.setData({ loading: false, loadingMore: false });
    });
  },

  switchTab: function(e) {
    var self = this;
    var tab = e.currentTarget.dataset.tab;
    self.setData({ currentTab: tab });
    // BUG-30: 精选 Tab 从服务端取数，分页之外的精选照也能进列表
    if (tab === 'featured') {
      self.loadFeatured();
    }
  },

  // BUG-30: 服务端精选列表（不随分页截断）
  loadFeatured: function() {
    var self = this;
    callFunction('album', 'featured', { activityId: self.activityId }).then(function(res) {
      if (!res || res.success === false) return;
      var payload = res.data || {};
      self.setData({ featured: payload.photos || [] });
    }).catch(function() {
      wx.showToast({ title: '精选加载失败', icon: 'none' });
    });
  },

  // BUG-17: 点击照片跳转照片详情页 photo-detail（原 wx.previewImage 预览改为 navigateTo）
  goDetail: function(e) {
    var photoId = e.currentTarget.dataset.id;
    if (!photoId) return;
    wx.navigateTo({
      url: '/pages/photo-detail/photo-detail?photoId=' + photoId + '&activityId=' + (this.activityId || '')
    });
  },

  stopPropagation: function() {},

  // 点赞（长按菜单触发，UX-03）
  toggleLike: function() {
    var self = this;
    var photoId = self.data.contextPhotoId;
    if (!photoId) return;
    callFunction('photo-like', 'toggle', { photoId: photoId }).then(function(res) {
      if (!res || res.success === false) {
        wx.showToast({ title: (res && res.message) || '操作失败', icon: 'none' });
        return;
      }
      var liked = !self.data.contextLiked;
      var count = (self.data.contextLikeCount || 0) + (liked ? 1 : -1);
      self._dirty = true;
      self.updatePhotoLocal(photoId, { liked: liked, likedByMe: liked, likeCount: count });
      self.setData({
        showContextMenu: false,
        contextLiked: liked,
        contextLikeCount: count
      });
    }).catch(function(err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    });
  },

  // BUG-31: 图片预览入口的精选切换（按 previewFeatured 选 action，以服务端返回为准）
  toggleFeatured: function() {
    var self = this;
    var photoId = self.data.previewId;
    if (!photoId) return;
    var action = self.data.previewFeatured ? 'unfeature' : 'feature';
    callFunction('photo-feature', action, { photoId: photoId }).then(function(r) {
      if (!r || r.success === false) {
        wx.showToast({ title: (r && r.message) || '操作失败', icon: 'none' });
        return;
      }
      var featured = !!(r.data && r.data.featured);
      self._dirty = true;
      self.updatePhotoLocal(photoId, { featured: featured });
      self.setData({ previewFeatured: featured });
      wx.showToast({ title: featured ? '已设为精选' : '已取消精选', icon: 'success' });
    }).catch(function() {
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  // BUG-60: 昵称映射公共方法：走 get-activity-detail 的 registrations 建 userId → nickname，
  // 给评论 nickname 与 c.replies[].nickname 赋值（评论/照片列表通用，复用 utils/nickname.js）
  _mapNicknames: function(list) {
    return nicknameUtil.mapNicknames(this.activityId, list);
  },

  // 评论
  openComments: function() {
    var self = this;
    var photoId = self.data.commentPhotoId || self.data.contextPhotoId;
    if (!photoId) return;
    self.setData({ showComments: true, commentPhotoId: photoId, commentText: '', showContextMenu: false });
    callFunction('photo-comments', 'list', { photoId: photoId }).then(function(res) {
      if (!res || res.success === false) {
        wx.showToast({ title: (res && res.message) || '加载评论失败', icon: 'none' });
        return;
      }
      var comments = (res && res.data) ? (res.data.comments || res.comments || []) : [];
      // BUG-60: 昵称映射走 get-activity-detail 的 registrations（含 replies），替代 users 表内联映射
      self._mapNicknames(comments).then(function() {
        self.setData({ comments: comments });
      });
    }).catch(function() {
      wx.showToast({ title: '加载评论失败', icon: 'none' });
    });
  },

  closeComments: function() {
    this.setData({ showComments: false });
  },

  onCommentInput: function(e) {
    this.setData({ commentText: e.detail.value });
  },

  submitComment: function() {
    var self = this;
    var text = self.data.commentText.trim();
    if (!text) return;
    var photoId = self.data.commentPhotoId;
    callFunction('photo-comments', 'add', {
      photoId: photoId,
      content: text
    }).then(function(res) {
      if (!res || res.success === false) {
        wx.showToast({ title: (res && res.message) || '评论失败', icon: 'none' });
        return;
      }
      self._dirty = true;
      self.setData({ commentText: '' });
      self.openComments();
      var item = self.findPhoto(photoId);
      if (item) {
        self.updatePhotoLocal(photoId, { commentCount: (item.commentCount || 0) + 1 });
      }
    }).catch(function(err) {
      wx.showToast({ title: (err && err.message) || '评论失败', icon: 'none' });
    });
  },

  deleteComment: function(e) {
    var self = this;
    var commentId = e.currentTarget.dataset.id;
    var photoId = self.data.commentPhotoId;
    callFunction('photo-comments', 'delete', { commentId: commentId }).then(function(res) {
      if (!res || res.success === false) {
        wx.showToast({ title: (res && res.message) || '删除失败', icon: 'none' });
        return;
      }
      self._dirty = true;
      self.openComments();
      var item = self.findPhoto(photoId);
      if (item) {
        self.updatePhotoLocal(photoId, { commentCount: Math.max((item.commentCount || 1) - 1, 0) });
      }
    }).catch(function(err) {
      wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' });
    });
  },

  // 长按菜单
  onPhotoLongPress: function(e) {
    var item = e.currentTarget.dataset.item;
    this.setData({
      showContextMenu: true,
      contextPhotoId: item._id,
      contextFeatured: !!item.featured,
      contextLiked: !!(item.liked || item.likedByMe),
      contextLikeCount: item.likeCount || 0
    });
  },

  closeContextMenu: function() {
    this.setData({ showContextMenu: false });
  },

  contextDeletePhoto: function() {
    var self = this;
    var photoId = self.data.contextPhotoId;
    wx.showModal({
      title: '删除照片',
      content: '确定删除这张照片吗？',
      success: function(res) {
        if (res.confirm) {
          callFunction('photo-upload', 'delete', { photoId: photoId }).then(function(r) {
            if (!r || r.success === false) {
              wx.showToast({ title: (r && r.message) || '删除失败', icon: 'none' });
              return;
            }
            self._dirty = true;
            self.setData({ showContextMenu: false });
            wx.showToast({ title: '已删除', icon: 'success' });
            self.removePhotoLocal(photoId);
          }).catch(function(err) {
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  contextToggleFeatured: function() {
    var self = this;
    var photoId = self.data.contextPhotoId;
    var action = self.data.contextFeatured ? 'unfeature' : 'feature';
    callFunction('photo-feature', action, { photoId: photoId }).then(function(r) {
      if (!r || r.success === false) {
        wx.showToast({ title: (r && r.message) || '操作失败', icon: 'none' });
        return;
      }
      self._dirty = true;
      // BUG-31: 以服务端返回为准更新 UI，不再本地翻转
      var featured = !!(r.data && r.data.featured);
      self.updatePhotoLocal(photoId, { featured: featured });
      self.setData({ showContextMenu: false, contextFeatured: featured });
      wx.showToast({ title: '操作成功', icon: 'success' });
    }).catch(function() {
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  // PERF-02: 生成缩略图 base64，失败回退原图
  _compressThumb: function(filePath) {
    return new Promise(function(resolve) {
      var fs = wx.getFileSystemManager();
      function readAsBase64(path) {
        try {
          return fs.readFileSync(path, 'base64');
        } catch (e) {
          return '';
        }
      }
      wx.compressImage({
        src: filePath,
        quality: 80,
        success: function(cRes) {
          var data = readAsBase64(cRes.tempFilePath);
          resolve(data || readAsBase64(filePath));
        },
        fail: function() {
          resolve(readAsBase64(filePath));
        }
      });
    });
  },

  _extOf: function(path) {
    var m = /\.(\w+)(\?|$)/.exec(path || '');
    var ext = (m && m[1] ? m[1] : 'jpg').toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    if (ext !== 'jpg' && ext !== 'png' && ext !== 'gif' && ext !== 'webp') ext = 'jpg';
    return ext;
  },

  // 上传照片（COST-05 直传 + PERF-02 缩略图 + PERF-07 sizeType）
  uploadPhoto: function() {
    var self = this;
    var MAX_FILE_SIZE = 10 * 1024 * 1024;
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: function(res) {
        var allFiles = res.tempFiles || [];
        var skipped = 0;
        var files = [];
        for (var i = 0; i < allFiles.length; i++) {
          if (allFiles[i].size > MAX_FILE_SIZE) {
            skipped++;
          } else {
            files.push(allFiles[i]);
          }
        }
        if (skipped > 0) {
          wx.showToast({ title: '已跳过 ' + skipped + ' 张超过10MB的图片', icon: 'none' });
        }
        if (files.length === 0) {
          if (skipped === 0) {
            wx.showToast({ title: '未选择图片', icon: 'none' });
          } else {
            wx.showToast({ title: '图片超过10MB，请压缩后重试', icon: 'none' });
          }
          return;
        }
        self._dirty = true;
        var uploaded = 0;
        var failed = 0;
        var total = files.length;
        wx.showLoading({ title: '上传中... 0/' + total });
        // BUG-32: 串行递归上传，一张传完再传下一张，避免多张并发
        var uploadNext = function(idx) {
          if (idx >= total) {
            wx.hideLoading();
            if (failed > 0) {
              wx.showToast({ title: '上传完成，失败 ' + failed + ' 张', icon: 'none' });
            } else {
              wx.showToast({ title: '上传完成', icon: 'success' });
            }
            self._dirty = true;
            // PERF-16: silent 刷新，避免 loading:true 全屏闪烁
            self.loadData(false, true);
            return;
          }
          var file = files[idx];
          var onSettled = function() {
            var done = uploaded + failed;
            if (done < total) {
              wx.showLoading({ title: '上传中... ' + done + '/' + total });
            }
            uploadNext(idx + 1);
          };
          self._compressThumb(file.tempFilePath).then(function(thumbData) {
            // COST-05: 原图 wx.cloud.uploadFile 直传云存储
            var ext = self._extOf(file.tempFilePath);
            var cloudPath = 'photos/' + self.activityId + '/' + Date.now() + '_' + idx + '.' + ext;
            return new Promise(function(resolve, reject) {
              wx.cloud.uploadFile({
                cloudPath: cloudPath,
                filePath: file.tempFilePath,
                success: function(up) { resolve({ up: up, cloudPath: cloudPath }); },
                fail: reject
              });
            }).then(function(r) {
              // 直传后仅上报 fileID + 缩略图 base64
              return callFunction('photo-upload', 'upload', {
                activityId: self.activityId,
                fileID: r.up.fileID,
                cloudPath: r.cloudPath,
                thumbData: thumbData || '',
                fileName: file.tempFilePath
              });
            });
          }).then(function(r) {
            if (r && r.success !== false) {
              uploaded++;
            } else {
              failed++;
            }
            onSettled();
          }).catch(function() {
            failed++;
            onSettled();
          });
        };
        uploadNext(0);
      }
    });
  },

  // 编辑相册信息
  editAlbumInfo: function() {
    this.setData({
      showEditAlbum: true,
      editTitle: this.data.albumTitle,
      editNote: this.data.albumNote
    });
  },

  closeEditAlbum: function() {
    this.setData({ showEditAlbum: false });
  },

  onEditTitleInput: function(e) {
    this.setData({ editTitle: e.detail.value });
  },

  onEditNoteInput: function(e) {
    this.setData({ editNote: e.detail.value });
  },

  saveAlbumInfo: function() {
    var self = this;
    callFunction('update-activity-status', 'update', {
      activityId: self.activityId,
      albumTitle: self.data.editTitle,
      albumNote: self.data.editNote
    }).then(function(res) {
      if (!res || res.success === false) {
        wx.showToast({ title: (res && res.message) || '保存失败', icon: 'none' });
        return;
      }
      self._dirty = true;
      self.setData({ showEditAlbum: false, albumTitle: self.data.editTitle, albumNote: self.data.editNote });
      wx.showToast({ title: '已保存', icon: 'success' });
    }).catch(function() {
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },

  // AI-46: 跳转 AI 精选页
  goAiFeature: function() {
    wx.navigateTo({ url: '/pages/ai-feature/ai-feature?activityId=' + this.activityId });
  },

  // AI 小记（COST-11 防抖）
  generateAiNote: function() {
    var self = this;
    if (self.data.aiNoting) return;
    self.setData({ aiNoting: true });
    wx.showLoading({ title: '生成中...' });
    callFunction('photo-ai-note', 'generate', { activityId: self.activityId }).then(function(res) {
      wx.hideLoading();
      self.setData({ aiNoting: false });
      var data = (res && res.data) || {};
      var results = data.results || [];
      var notes = [];
      results.forEach(function(r) {
        if (r.aiNote) notes.push(r.aiNote);
      });
      if (notes.length > 0) {
        var noteText = notes.join('；');
        self._dirty = true;
        self.setData({ aiNote: noteText });
        // AI-17: AI 小记落库，避免只写内存
        callFunction('update-activity-status', 'update', {
          activityId: self.activityId,
          albumNote: noteText
        }).catch(function() {
          wx.showToast({ title: '小记已生成，但保存失败', icon: 'none' });
        });
      } else {
        wx.showToast({ title: '生成失败', icon: 'none' });
      }
    }).catch(function() {
      wx.hideLoading();
      self.setData({ aiNoting: false });
      wx.showToast({ title: '生成失败', icon: 'none' });
    });
  },

  // 分享海报
  generatePoster: function() {
    var self = this;
    var photos = self.data.photos.slice(0, 9);
    var fileIDs = photos.map(function(p) { return p.fileID; }).filter(Boolean);

    // 先将 fileID 转为临时 URL，Canvas 1.0 不支持 cloud:// 协议
    wx.cloud.getTempFileURL({
      fileList: fileIDs,
      success: function(urlRes) {
        var urlMap = {};
        (urlRes.fileList || []).forEach(function(f) { urlMap[f.fileID] = f.tempFileURL; });

        var ctx = wx.createCanvasContext('posterCanvas', self);
        ctx.setFillStyle('#ffffff');
        ctx.fillRect(0, 0, 750, 1334);
        ctx.setFillStyle('#1f2d29');
        ctx.setFontSize(40);
        ctx.setTextAlign('center');
        ctx.fillText(self.data.albumTitle || '活动相册', 375, 100);
        ctx.setFillStyle('#84938e');
        ctx.setFontSize(24);
        ctx.fillText('共 ' + self.data.photos.length + ' 张照片', 375, 150);

        var cols = 3, size = 200, gap = 20;
        var startX = (750 - (size * cols + gap * (cols - 1))) / 2;
        var startY = 200;

        for (var i = 0; i < photos.length; i++) {
          var col = i % cols, row = Math.floor(i / cols);
          var x = startX + col * (size + gap), y = startY + row * (size + gap);
          var url = urlMap[photos[i].fileID];
          if (url) {
            try { ctx.drawImage(url, x, y, size, size); } catch (e) {}
          }
        }

        ctx.draw(false, function() {
          wx.canvasToTempFilePath({
            canvasId: 'posterCanvas',
            success: function(res) {
              wx.saveImageToPhotosAlbum({
                filePath: res.tempFilePath,
                success: function() { wx.showToast({ title: '海报已保存', icon: 'success' }); },
                fail: function() { wx.showToast({ title: '保存失败', icon: 'none' }); }
              });
            }
          }, self);
        });
      },
      fail: function() {
        wx.showToast({ title: '图片加载失败', icon: 'none' });
      }
    });
  },

  // UX-16: 图片加载失败简单处理
  onImgError: function(e) {
    console.warn('图片加载失败', e && e.detail);
  }
});
