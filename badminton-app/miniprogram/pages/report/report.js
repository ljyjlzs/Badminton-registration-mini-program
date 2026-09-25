const { callFunction } = require('../../utils/request.js');

Page({
  data: {
    loading: true,
    activity: null,
    matches: [],
    copy: null,
    generating: false
  },

  onLoad(options) {
    this.activityId = options.activityId;
    this.loadData();
  },

  async loadData() {
    try {
      this.setData({ loading: true });
      const detail = await callFunction('get-activity-detail', 'detail', { activityId: this.activityId });
      // AI-36: 校验 success，失败走 catch
      if (!detail || detail.success === false) {
        throw new Error((detail && detail.message) || '加载失败');
      }
      const d = detail.data || {};
      const finished = (d.matches || []).filter(m => m.status === 'finished');
      this.setData({ activity: d.activity, matches: finished, loading: false });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      this.setData({ loading: false });
    }
  },

  async generateCopy() {
    this.setData({ generating: true });
    try {
      const data = await callFunction('generate-copy', 'generate', { activityId: this.activityId });
      // AI-37: 校验 success，失败不提示「生成成功」
      if (!data || data.success === false) {
        throw new Error((data && data.message) || '生成失败');
      }
      this.setData({ copy: (data.data || data).copy });
      wx.showToast({ title: '生成成功', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ generating: false });
    }
  },

  copyText(e) {
    const text = e.currentTarget.dataset.text;
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制', icon: 'success' }) });
  },

  onShareAppMessage: function() {
    return {
      title: '羽毛球活动文案',
      path: '/pages/index/index'
    };
  }
});
