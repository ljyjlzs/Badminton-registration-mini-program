// pages/rules/rules.js
Page({
  data: {
    loading: true,
    currentTab: 'singles',
    sections: [],
    currentSection: null
  },

  onLoad: function () {
    this.loadRules();
  },

  onPullDownRefresh: function () {
    this.loadRules();
    wx.stopPullDownRefresh();
  },

  loadRules: function () {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'get-rules',
      success: res => {
        this.setData({ loading: false });
        if (res.result && res.result.success) {
          const sections = res.result.data || [];
          const currentSection = sections.find(s => s.id === this.data.currentTab) || sections[0] || null;
          this.setData({
            sections: sections,
            currentSection: currentSection
          });
        } else {
          wx.showToast({ title: '加载失败', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    });
  },

  switchTab: function (e) {
    const tab = e.currentTarget.dataset.tab;
    const currentSection = this.data.sections.find(s => s.id === tab) || null;
    this.setData({
      currentTab: tab,
      currentSection: currentSection
    });
  }
});
