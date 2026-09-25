App({
  // ENG-01: 全局错误留痕（不含敏感字段）
  onError: function (err) {
    try {
      var msg = typeof err === 'string' ? err : (err && err.message) || String(err);
      console.error('[app-error]', msg);
      if (this.rl) this.rl.error('app.onError', msg.slice(0, 500));
    } catch (e) {}
  },

  onUnhandledRejection: function (res) {
    try {
      var msg = String((res && res.reason && res.reason.message) || (res && res.reason) || '');
      console.error('[unhandledRejection]', msg);
      if (this.rl) this.rl.error('unhandledRejection', msg.slice(0, 500));
    } catch (e) {}
  },

  onLaunch: function () {
    var that = this;
    // ENG-01: 实时日志管理器（mp 后台「开发→运维中心→实时日志」查看）
    try {
      this.rl = (typeof wx.getRealtimeLogManager === 'function') ? wx.getRealtimeLogManager() : null;
    } catch (e) {
      this.rl = null;
    }
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-3guy8euw3babaf6d',
        traceUser: true,
      });
    }

    // 网络状态变化监听：断网/恢复时给出提示，并同步 globalData.networkOk
    wx.onNetworkStatusChange(function (res) {
      if (that.globalData) that.globalData.networkOk = res.isConnected;
      if (!res.isConnected) {
        wx.showToast({ title: '网络已断开', icon: 'none', duration: 2000 });
      } else {
        wx.showToast({ title: '网络已恢复', icon: 'none', duration: 1500 });
      }
    });

    // 启动时初始化网络状态，写入 globalData.networkOk（BUG-46）
    wx.getNetworkType({
      success: function (res) {
        if (that.globalData) that.globalData.networkOk = res.networkType !== 'none';
      },
      fail: function () {
        if (that.globalData) that.globalData.networkOk = false;
      }
    });

    // 从本地缓存恢复登录状态，避免每次冷启动都要重新授权
    try {
      const cached = wx.getStorageSync('userLoginInfo');
      if (cached && cached.openid) {
        this.globalData = {
          userInfo: cached.userInfo || null,
          openid: cached.openid,
          isLoggedIn: true,
          voiceEnabled: true,
          voiceConfig: { secretId: '', secretKey: '' },
          aiEnabled: true
        };
      } else {
        this.globalData = {
          userInfo: null,
          openid: null,
          isLoggedIn: false,
          voiceEnabled: true,
          voiceConfig: { secretId: '', secretKey: '' },
          aiEnabled: true
        };
      }
    } catch (e) {
      this.globalData = {
        userInfo: null,
        openid: null,
        isLoggedIn: false,
        voiceEnabled: true,
        voiceConfig: { secretId: '', secretKey: '' }
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
      isLoggedIn: false,
      aiEnabled: true
    };
    try {
      wx.removeStorageSync('userLoginInfo');
    } catch (e) {}
  }
});
