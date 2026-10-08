const { callFunction } = require('../../utils/request.js');

Page({
  data: {
    loading: true,
    loadError: false,
    config: null,
    enabled: false,
    disabledReason: ''
  },

  onLoad(options) {
    // BUG-86: 校验 activityId，避免直连后开关只改本地状态不落库
    if (!options || !options.activityId) {
      wx.showToast({ title: '缺少活动参数', icon: 'none' });
      setTimeout(() => { wx.navigateBack(); }, 1500);
      return;
    }
    this.activityId = options.activityId;
    this.loadData();
  },

  async loadData() {
    try {
      this.setData({ loading: true, loadError: false });
      const data = await callFunction('voice-score-config', 'get', { activityId: this.activityId });
      const cfg = (data.data || data).config || {};
      this.setData({
        config: cfg,
        formatsText: Array.isArray(cfg.acceptedFormats) ? cfg.acceptedFormats.join(', ') : 'mp3',
        enabled: !!cfg.voiceScoreEnabled,
        // BUG-87: 兜底改为语义值 'OFF'，与 settings.wxml 三分支枚举对齐
        disabledReason: cfg.voiceScoreEnabled ? '' : (cfg.disabledReason || 'OFF'),
        loading: false
      });
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

  async toggleVoice(e) {
    const enabled = e.detail.value;
    try {
      const res = await callFunction('voice-score-config', 'update', { activityId: this.activityId, enabled });
      if (!res || !res.success) {
        wx.showToast({ title: (res && res.message) || '设置失败', icon: 'none' });
        return;
      }
      this.setData({ enabled });
      wx.showToast({ title: enabled ? '已开启' : '已关闭', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  // BUG-17: 天气入口（携带 activityId）
  goWeather() {
    wx.navigateTo({ url: '/pages/weather/weather?activityId=' + (this.activityId || '') });
  },

  // BUG-17: 语音记分测试入口
  goVoiceScoreTest() {
    wx.navigateTo({ url: '/pages/voice-score-test/voice-score-test' });
  },

  // BUG-17: 隐私政策入口
  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  // BUG-17: 用户协议入口
  goAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  onShareAppMessage: function() {
    return {
      title: '语音记分设置',
      path: '/pages/index/index'
    };
  },

  onShareTimeline: function() {
    return {
      title: '语音记分设置'
    };
  }
});
