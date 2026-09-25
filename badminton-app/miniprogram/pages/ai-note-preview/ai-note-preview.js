var callFunction = require('../../utils/request').callFunction;

Page({
  data: {
    activityId: '',
    note: '',
    title: '',
    source: '',
    loading: false
  },

  onLoad: function(options) {
    if (options.activityId) {
      this.setData({ activityId: options.activityId });
      // AI-51: 防止 onLoad 被快速重复触发
      if (this._loading) return;
      this._loading = true;
      // AI-17: 先尝试回填已有 albumNote，再生成
      this.loadExistingNote();
      this.generate();
    } else {
      wx.showToast({ title: '缺少活动参数', icon: 'none' });
      setTimeout(function() { wx.navigateBack(); }, 1500);
    }
  },

  // AI-17: 回填已保存的 albumNote
  loadExistingNote: function() {
    var that = this;
    callFunction('get-activity-detail', 'get', { activityId: that.data.activityId }).then(function(res) {
      var d = (res && res.data) || {};
      if (d.albumNote && !that.data.note) {
        that.setData({ note: d.albumNote, source: 'saved' });
      }
    }).catch(function() {});
  },

  generate: function() {
    var that = this;
    if (that.data.loading) return;
    that.setData({ loading: true });
    callFunction('photo-ai-note', 'batchAiNote', { activityId: that.data.activityId })
      .then(function(data) {
        // AI-47/48: callFunction 返回信封 { success, data, message }，需解包一层
        var d = (data && data.data) || data || {};
        var results = d.results || [];
        var note = results.length > 0 ? results.map(function(r) { return r.aiNote || ''; }).filter(Boolean).join('\n') : '';
        if (note) {
          that.setData({ title: 'AI相册小记', note: note, source: 'ai', loading: false });
        } else if (that.data.note) {
          // AI-17: 已有 albumNote 时不报生成失败
          that.setData({ loading: false });
        } else {
          that.setData({ loading: false });
          wx.showToast({ title: '暂无可生成的内容', icon: 'none' });
        }
      })
      .catch(function() {
        that.setData({ loading: false });
        wx.showToast({ title: '生成失败', icon: 'none' });
      });
  },

  adopt: function() {
    if (!this.data.note) return;
    var that = this;
    // AI-12: callFunction 第三参即 payload，须扁平传 albumNote（勿再嵌套 payload）
    callFunction('update-activity-status', 'update', { activityId: that.data.activityId, albumNote: that.data.note }).then(function() {
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(function() { wx.navigateBack(); }, 800);
    }).catch(function() {
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },

  reject: function() {
    wx.showToast({ title: '已取消采用', icon: 'none' });
  },

  retry: function() {
    this.generate();
  },

  copy: function() {
    if (!this.data.note) return;
    wx.setClipboardData({ data: this.data.note });
  }
});
