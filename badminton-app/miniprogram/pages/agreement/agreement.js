Page({
  data: {},
  onLoad: function() {},

  onShareAppMessage: function() {
    return {
      title: '用户服务协议',
      path: '/pages/agreement/agreement'
    };
  },

  onShareTimeline: function() {
    return {
      title: '用户服务协议'
    };
  }
});
