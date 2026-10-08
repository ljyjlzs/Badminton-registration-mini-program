const { callFunction } = require('../../utils/request.js');

Page({
  data: {
    loading: true,
    loadError: false,
    weather: null,
    city: ''
  },

  onLoad(options) {
    if (options.city) this.setData({ city: options.city });
    this.loadData();
  },

  async loadData() {
    try {
      this.setData({ loading: true, loadError: false });
      const city = this.data.city || '深圳';
      const data = await callFunction('weather', 'get', { city });
      this.setData({ weather: (data.data || data).weather, loading: false });
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

  onRefresh() { this.loadData(); },

  onShareAppMessage() {
    return {
      title: '天气查询',
      path: '/pages/weather/weather'
    };
  },

  onShareTimeline() {
    return {
      title: '天气查询'
    };
  }
});
