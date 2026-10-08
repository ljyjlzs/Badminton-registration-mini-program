Page({
  data: {},
  onLoad: function() {},

  onShareAppMessage: function() {
    return {
      title: '隐私政策',
      path: '/pages/privacy/privacy'
    };
  },

  onShareTimeline: function() {
    return {
      title: '隐私政策'
    };
  }
});
