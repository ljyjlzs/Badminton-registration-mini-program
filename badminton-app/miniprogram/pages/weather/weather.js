const { callFunction } = require('../../utils/request.js');

Page({
  data: {
    loading: true,
    weather: null,
    city: ''
  },

  onLoad(options) {
    if (options.city) this.setData({ city: options.city });
    this.loadData();
  },

  async loadData() {
    try {
      this.setData({ loading: true });
      const city = this.data.city || '深圳';
      const data = await callFunction('weather', 'get', { city });
      this.setData({ weather: (data.data || data).weather, loading: false });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onRefresh() { this.loadData(); }
});
