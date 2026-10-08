const { callFunction } = require('../../utils/request.js');

Page({
  data: {
    loading: true,
    loadError: false,
    candidates: [],
    selected: {},
    invites: [],
    generating: false,
    remaining: 0
  },

  onLoad(options) {
    this.activityId = options.activityId;
    this.loadData();
  },

  async loadData() {
    try {
      this.setData({ loading: true, loadError: false });
      const data = await callFunction('invite', 'listCandidates', { activityId: this.activityId });
      // AI-36: 校验 success，失败不展示空列表
      if (!data || data.success === false) {
        throw new Error((data && data.message) || '加载失败');
      }
      const d = data.data || data;
      const selected = {};
      (d.candidates || []).forEach(c => { selected[c.userId] = true; });
      this.setData({ candidates: d.candidates || [], selected, remaining: d.remaining || 0, loading: false });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      // BUG-46: 加载失败展示可重试错误态
      this.setData({ loading: false, loadError: true });
    }
  },

  // BUG-46: 加载失败后重新加载
  retryLoad() {
    this.loadData();
  },

  toggleSelect(e) {
    const userId = e.currentTarget.dataset.userid;
    const selected = { ...this.data.selected };
    selected[userId] = !selected[userId];
    this.setData({ selected });
  },

  async generateInvites() {
    const ids = this.data.candidates.filter(c => this.data.selected[c.userId]).map(c => c.userId);
    if (ids.length === 0) return wx.showToast({ title: '请选择候选人', icon: 'none' });
    this.setData({ generating: true });
    try {
      const data = await callFunction('invite', 'generateInvites', { activityId: this.activityId, candidateIds: ids });
      // AI-36: 校验 success，失败不提示「生成成功」
      if (!data || data.success === false) {
        throw new Error((data && data.message) || '生成失败');
      }
      const d = data.data || data;
      this.setData({ invites: d.invites || [] });
      wx.showToast({ title: '生成成功', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ generating: false });
    }
  },

  copyInvite(e) {
    const text = e.currentTarget.dataset.text;
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制', icon: 'success' }) });
  },

  onShareAppMessage: function() {
    return {
      title: '羽毛球活动邀请',
      path: '/pages/index/index'
    };
  },

  onShareTimeline: function() {
    return {
      title: '羽毛球活动邀请'
    };
  }
});
