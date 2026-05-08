App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-3guy8euw3babaf6d',
        traceUser: true,
      });
    }

    // 从本地缓存恢复登录状态，避免每次冷启动都要重新授权
    try {
      const cached = wx.getStorageSync('userLoginInfo');
      if (cached && cached.openid) {
        this.globalData = {
          userInfo: cached.userInfo || null,
          openid: cached.openid,
          isLoggedIn: true
        };
      } else {
        this.globalData = {
          userInfo: null,
          openid: null,
          isLoggedIn: false
        };
      }
    } catch (e) {
      this.globalData = {
        userInfo: null,
        openid: null,
        isLoggedIn: false
      };
    }
  },

  // 保存登录信息到本地缓存
  saveLoginInfo: function(userInfo, openid) {
    this.globalData.userInfo = userInfo;
    this.globalData.openid = openid;
    this.globalData.isLoggedIn = true;
    try {
      wx.setStorageSync('userLoginInfo', {
        userInfo: userInfo,
        openid: openid
      });
    } catch (e) {
      console.error('缓存登录信息失败:', e);
    }
  },

  // 清除登录信息
  clearLoginInfo: function() {
    this.globalData = {
      userInfo: null,
      openid: null,
      isLoggedIn: false
    };
    try {
      wx.removeStorageSync('userLoginInfo');
    } catch (e) {}
  }
});
