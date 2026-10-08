const { callFunction } = require('../../utils/request.js');

Page({
  data: {
    aiMessage: '',
    parsing: false,
    draft: null,
    form: { name: '', time: '', location: '', type: 'doubles', maxPlayers: '8' },
    missingFields: [],
    isNameMissing: false,
    isTimeMissing: false,
    isLocationMissing: false,
    creating: false,
    loadError: false
  },

  // AI-32: 接收 create-activity 跳转带来的 ?input 参数并自动解析
  onLoad(options) {
    if (options && options.input) {
      this.setData({ aiMessage: decodeURIComponent(options.input) });
      this.parseAi();
    }
  },

  onAiInput(e) { this.setData({ aiMessage: e.detail.value }); },

  async parseAi() {
    const msg = this.data.aiMessage.trim();
    if (!msg) return wx.showToast({ title: '请输入活动描述', icon: 'none' });
    this.setData({ parsing: true, loadError: false });
    try {
      const data = await callFunction('parse-activity', 'parse', { message: msg });
      if (!data.success) throw new Error(data.message || 'AI 解析失败');
      const d = data.data;
      const draft = d.draft;
      const missing = draft.missing || [];
      this.setData({
        draft,
        form: {
          name: draft.name || '',
          time: draft.time || '',
          location: draft.location || '',
          type: draft.type || 'doubles',
          maxPlayers: String(draft.maxPlayers || 8)
        },
        missingFields: missing,
        isNameMissing: missing.indexOf('name') >= 0,
        isTimeMissing: missing.indexOf('time') >= 0,
        isLocationMissing: missing.indexOf('location') >= 0,
        parsing: false
      });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      // BUG-46: 解析失败展示可重试错误态
      this.setData({ parsing: false, loadError: true });
    }
  },

  // BUG-46: 加载失败后重新解析
  retryLoad() {
    this.parseAi();
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  selectType(e) {
    this.setData({ 'form.type': e.currentTarget.dataset.type });
  },

  async createActivity() {
    const { form } = this.data;
    const draft = this.data.draft || {};
    if (!form.name.trim()) return wx.showToast({ title: '活动名称不能为空', icon: 'none' });
    if (!form.location.trim()) return wx.showToast({ title: '活动地点不能为空', icon: 'none' });
    if (!form.time.trim()) return wx.showToast({ title: '活动时间不能为空', icon: 'none' });
    this.setData({ creating: true });
    try {
      const data = await callFunction('create-activity', 'create', {
        name: form.name.trim(),
        time: form.time.trim(),
        location: form.location.trim(),
        type: form.type,
        maxPlayers: Number(form.maxPlayers) || 8,
        province: draft.province || '',
        city: draft.city || '',
        district: draft.district || ''
      });
      if (!data.success) throw new Error(data.message || '创建失败');
      const d = data.data;
      wx.showToast({ title: '创建成功', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/activity-detail/activity-detail?id=${d.activityId}` });
      }, 1500);
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ creating: false });
    }
  },

  onShareAppMessage: function() {
    return {
      title: 'AI 创建羽毛球活动',
      path: '/pages/index/index'
    };
  },

  onShareTimeline: function() {
    return {
      title: 'AI 创建羽毛球活动'
    };
  }
});
