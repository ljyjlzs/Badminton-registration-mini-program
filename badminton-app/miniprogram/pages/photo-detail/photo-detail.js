var callFunction = require('../../utils/request.js').callFunction;
var nicknameUtil = require('../../utils/nickname.js');
var app = getApp();

Page({
  data: {
    loading: true,
    photo: null,
    comments: [],
    commentText: '',
    sending: false,
    isOrganizer: false,
    openid: ''
  },

  onLoad: function(options) {
    this.photoId = options.photoId;
    this.activityId = options.activityId || '';
    this.setData({ openid: app.globalData.openid || '' });
    this.loadData();
  },

  onShow: function() {
    if (this.photoId && this.data.loading === false) {
      this.loadData();
    }
  },

  // BUG-60: 昵称映射公共方法：走 get-activity-detail 的 registrations 建 userId → nickname，
  // 给评论 nickname 与 c.replies[].nickname 赋值（评论/照片列表通用，复用 utils/nickname.js）
  _mapNicknames: function(list) {
    return nicknameUtil.mapNicknames(this.activityId, list);
  },

  loadData: function() {
    var self = this;
    self.setData({ loading: true });

    callFunction('photo-upload', 'list', { activityId: self.activityId }).then(function(photoData) {
      var pd = (photoData.data || photoData);
      var photos = (pd && pd.photos) ? pd.photos : [];
      var photo = null;
      for (var i = 0; i < photos.length; i++) {
        if (photos[i]._id === self.photoId) { photo = photos[i]; break; }
      }

      callFunction('photo-comments', 'list', { photoId: self.photoId }).then(function(commentData) {
        var cd = (commentData.data || commentData);
        var comments = (cd && cd.comments) ? cd.comments : [];
        // BUG-60: 昵称映射复用 _mapNicknames（get-activity-detail 的 registrations，含 replies）
        self._mapNicknames(comments).then(function() {
          self.setData({ photo: photo, comments: comments, loading: false });
        });
      }).catch(function() {
        self.setData({ photo: photo, loading: false });
      });

      callFunction('get-activity-detail', 'detail', { activityId: self.activityId }).then(function(detail) {
        self.setData({ isOrganizer: detail && detail.data && detail.data.isOrganizer });
      }).catch(function() {});
    }).catch(function(e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
      self.setData({ loading: false });
    });
  },

  toggleLike: function() {
    var self = this;
    if (!self.data.photo) return;
    callFunction('photo-like', 'toggle', { photoId: self.photoId }).then(function() {
      self.loadData();
    }).catch(function(e) {
      wx.showToast({ title: e.message, icon: 'none' });
    });
  },

  onCommentInput: function(e) {
    this.setData({ commentText: e.detail.value });
  },

  sendComment: function() {
    var self = this;
    var content = self.data.commentText.trim();
    if (!content) return;
    self.setData({ sending: true });
    callFunction('photo-comments', 'add', { photoId: self.photoId, content: content }).then(function() {
      self.setData({ commentText: '' });
      self.loadData();
    }).catch(function(e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }).finally(function() {
      self.setData({ sending: false });
    });
  },

  deleteComment: function(e) {
    var self = this;
    var commentId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除评论',
      content: '确定删除这条评论吗？',
      success: function(res) {
        if (res.confirm) {
          callFunction('photo-comments', 'delete', { commentId: commentId }).then(function() {
            wx.showToast({ title: '已删除', icon: 'success' });
            self.loadData();
          }).catch(function() {
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  deletePhoto: function() {
    var self = this;
    wx.showModal({
      title: '删除照片',
      content: '确定删除这张照片吗？删除后无法恢复。',
      success: function(res) {
        if (res.confirm) {
          callFunction('photo-upload', 'delete', { photoId: self.photoId }).then(function() {
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(function() { wx.navigateBack(); }, 1500);
          }).catch(function() {
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  // UX-16: 图片加载失败简单处理
  onImgError: function(e) {
    console.warn('图片加载失败', e && e.detail);
  }
});
