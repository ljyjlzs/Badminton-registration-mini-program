var callFunction = require('../../utils/request').callFunction;

Page({
  data: {
    activityId: '',
    suggestions: [],
    isTemplate: false,
    loading: false,
    generating: false
  },

  onLoad: function(options) {
    if (options.activityId) this.setData({ activityId: options.activityId });
  },

  generate: function() {
    var that = this;
    if (that.data.generating) return;
    that.setData({ generating: true, loading: true });
    callFunction('photo-feature', 'listFeatured', { activityId: that.data.activityId })
      .then(function(data) {
        // AI-46/48: callFunction 返回信封 { success, data, message }，需解包一层
        var d = (data && data.data) || data || {};
        if (data && data.success === false) {
          throw new Error(data.message || '生成失败');
        }
        var list = (d.photos || []).map(function(s) {
          return Object.assign({}, s, { checked: true });
        });
        that.setData({ suggestions: list, isTemplate: false, loading: false, generating: false });
      })
      .catch(function() {
        that.setData({ loading: false, generating: false });
        wx.showToast({ title: '生成失败', icon: 'none' });
      });
  },

  toggle: function(e) {
    var idx = e.currentTarget.dataset.idx;
    var suggestions = this.data.suggestions.slice();
    suggestions[idx].checked = !suggestions[idx].checked;
    this.setData({ suggestions: suggestions });
  },

  apply: function() {
    var that = this;
    var ids = that.data.suggestions.filter(function(s) { return s.checked; }).map(function(s) { return s._id; });
    if (ids.length === 0) {
      wx.showToast({ title: '请至少选择一张', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认采用',
      content: '将替换当前精选，共 ' + ids.length + ' 张',
      success: function(m) {
        if (!m.confirm) return;
        var promises = ids.map(function(photoId) {
          return callFunction('photo-feature', 'feature', { photoId: photoId });
        });
        Promise.all(promises).then(function(results) {
          // AI-46: 过滤失败结果，部分失败也要提示
          var failed = (results || []).filter(function(r) { return !r || r.success === false; }).length;
          if (failed > 0) {
            wx.showToast({ title: '部分精选失败（' + failed + '/' + ids.length + '）', icon: 'none' });
          } else {
            wx.showToast({ title: '已采用', icon: 'success' });
          }
          setTimeout(function() { wx.navigateBack(); }, 800);
        }).catch(function() {
          wx.showToast({ title: '精选失败', icon: 'none' });
        });
      }
    });
  },

  // UX-16: 图片加载失败简单处理
  onImgError: function(e) {
    console.warn('图片加载失败', e && e.detail);
  },

  onShareAppMessage: function() {
    return {
      title: 'AI 精选照片',
      path: '/pages/ai-feature/ai-feature?activityId=' + this.data.activityId
    };
  }
});
