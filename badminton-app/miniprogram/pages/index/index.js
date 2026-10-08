// 首页逻辑
const app = getApp();
const { request } = require('../../utils/request.js');
const shareUtil = require('../../utils/share.js');

Page({
  data: {
    userInfo: null,
    isLoggedIn: false,
    myActivities: [],
    joinableActivities: [],
    unavailableActivities: [],
    myActivitiesTotal: 0,
    joinableActivitiesTotal: 0,
    unavailableActivitiesTotal: 0,
    // UX-25: 可参加活动分页状态（仅此区做触底加载，另两区保留 3 条预览 + 查看全部跳转）
    joinablePage: 1,
    joinableHasMore: false,
    joinableLoadingMore: false,
    loading: true,
    showEditDialog: false,
    editType: 'nickname',
    editNickname: '',
    userStats: null,
    userBadges: []
  },

  onShareAppMessage: function() {
    var s = shareUtil.makeShare({ title: '羽毛球活动约起来', path: '/pages/index/index' });
    return { title: s.title, path: s.path };
  },

  onShareTimeline: function() {
    var s = shareUtil.makeShare({ title: '羽毛球活动约起来', path: '/pages/index/index' });
    return { title: s.title, query: s.timeline.query };
  },

  onLoad: function() {
    this._firstShowDone = false;
    this._lastLoadAt = 0;
    this.checkLogin();
  },

  onShow: function() {
    if (!this.data.isLoggedIn) return;
    // PERF-18: 避免冷启动 onLoad(checkLogin) 与 onShow 双跑 get-activities
    if (!this._firstShowDone) {
      this._firstShowDone = true;
      if (this._lastLoadAt) return;
      this.loadActivities();
      this.loadUserStats();
      return;
    }
    // PERF-18/PERF-21: 15 秒内重复进入不全量刷新
    if (Date.now() - this._lastLoadAt < 15000) return;
    this.loadActivities();
    this.loadUserStats();
  },

  checkLogin: function() {
    const userInfo = app.globalData.userInfo;
    if (userInfo && userInfo.openid) {
      this.setData({
        userInfo: userInfo,
        isLoggedIn: true
      });
      // 从 users 表加载最新的昵称和头像
      this.loadLatestUserInfo();
      this.loadActivities();
      // PERF-18: 首次加载由 checkLogin 触发，置位避免 onShow 再跑一轮
      this._firstShowDone = true;
    } else {
      this.setData({
        loading: false
      });
    }
  },

  loadLatestUserInfo: function() {
    const openid = app.globalData.openid;
    if (!openid) return;
    const db = wx.cloud.database();
    db.collection('users').where({ openid: openid }).get({
      success: res => {
        if (res.data && res.data.length > 0) {
          const latestUser = res.data[0];
          const currentInfo = app.globalData.userInfo || {};
          app.globalData.userInfo = {
            ...currentInfo,
            nickname: latestUser.nickname || currentInfo.nickname,
            avatar: latestUser.avatar || currentInfo.avatar
          };
          this.setData({
            userInfo: app.globalData.userInfo
          });
        }
      },
      fail: () => {}
    });
  },

  onGetUserInfo: function(e) {
    if (e.detail.userInfo) {
      const userInfo = e.detail.userInfo;
      this.setData({
        userInfo: userInfo,
        loading: true
      });
      
      // 调用登录云函数
      request('login', 'login', { userInfo: userInfo }).then(res => {
        this.setData({ loading: false });

        if (res.result) {
          const result = res.result;
          if (result.success && result.data) {
            app.saveLoginInfo({
              ...result.data,
              ...userInfo
            }, result.data.openid);

      this.setData({
        isLoggedIn: true,
        userInfo: app.globalData.userInfo
      });

      this.loadActivities();
      this.loadUserStats();
          } else {
            wx.showToast({
              title: result.message || '登录失败',
              icon: 'none'
            });
          }
        } else {
          console.error('res.result为空', res);
          wx.showToast({
            title: '登录失败',
            icon: 'none'
          });
        }
      }).catch(err => {
        console.error('登录失败：', err);
        this.setData({ loading: false });
        wx.showToast({
          title: '登录失败，请重试',
          icon: 'none'
        });
      });
    }
  },

  loadUserStats: function() {
    const openid = app.globalData.openid;
    if (!openid) return;
    const db = wx.cloud.database();
    db.collection('scores').where({ userId: openid }).get({
      success: res => {
        const scores = res.data || [];
        const totalGames = scores.length;
        const totalWins = scores.filter(s => s.scoreChange > 0).length;
        const totalScore = scores.reduce((sum, s) => sum + (s.scoreChange || 0), 0);
        const winRate = totalGames > 0 ? Math.round(totalWins / totalGames * 100) + '%' : '0%';
        const badges = [];
        if (totalGames >= 10) badges.push({ id: 'games10', icon: '🏸', name: '活跃选手' });
        if (totalGames >= 50) badges.push({ id: 'games50', icon: '🔥', name: '赛场老兵' });
        if (totalWins >= 10) badges.push({ id: 'wins10', icon: '🏆', name: '十连胜' });
        if (totalScore >= 100) badges.push({ id: 'score100', icon: '⭐', name: '百分达人' });
        this.setData({ userStats: { totalGames, totalWins, winRate, totalScore }, userBadges: badges });
      },
      fail: () => {}
    });
  },

  loadActivities: function() {
    this._lastLoadAt = Date.now();

    // PERF-04: 三类活动列表相互独立，Promise.all 并行拉取
    const fetchList = (type) =>
      request('get-activities', 'list', { type: type, page: 1, pageSize: 20 }).catch(() => null);

    Promise.all([
      fetchList('organized'),
      fetchList('available'),
      fetchList('unavailable')
    ]).then(([myRes, joinableRes, unavailableRes]) => {
      // PERF-18: 合并 setData——三类结果收集到一个 patch，一次提交（原先 4 次独立 setData）
      const patch = { loading: false };
      // 我创建的/暂时不能参加：保留 3 条预览 + 查看全部跳转（列表全量在 activity-list 页）
      const applyPreview = (res, cacheKey, listKey, totalKey) => {
        if (!(res && res.result && res.result.success)) return;
        const d = res.result.data || {};
        const all = d.list || [];
        this[cacheKey] = all;
        patch[listKey] = all.slice(0, 3);
        patch[totalKey] = d.total || all.length;
      };
      // 可参加的活动：UX-25 完整分页（触底加载更多），不再截断到 3 条
      const applyJoinable = (res) => {
        if (!(res && res.result && res.result.success)) return;
        const d = res.result.data || {};
        const all = d.list || [];
        this._allJoinableActivities = all;
        patch.joinableActivities = all;
        patch.joinableActivitiesTotal = d.total || all.length;
        patch.joinablePage = 1;
        patch.joinableHasMore = !!(d && d.hasMore);
      };
      applyPreview(myRes, '_allMyActivities', 'myActivities', 'myActivitiesTotal');
      applyJoinable(joinableRes);
      applyPreview(unavailableRes, '_allUnavailableActivities', 'unavailableActivities', 'unavailableActivitiesTotal');
      this.setData(patch);
    });
  },

  // UX-25: 触底加载更多可参加的活动（累加 page，hasMore 控制「加载中…/没有更多了」）
  onReachBottom: function() {
    if (!this.data.joinableHasMore || this.data.joinableLoadingMore) return;
    const nextPage = this.data.joinablePage + 1;
    this.setData({ joinableLoadingMore: true });
    request('get-activities', 'list', { type: 'available', page: nextPage, pageSize: 20 }).then(res => {
      const d = (res && res.result && res.result.data) || {};
      const more = d.list || [];
      const existing = this.data.joinableActivities || [];
      this._allJoinableActivities = (this._allJoinableActivities || []).concat(more);
      this.setData({
        joinableActivities: existing.concat(more),
        joinablePage: nextPage,
        joinableHasMore: !!d.hasMore,
        joinableLoadingMore: false
      });
    }).catch(() => {
      this.setData({ joinableLoadingMore: false });
    });
  },

  goToCreateActivity: function() {
    wx.navigateTo({
      url: '/pages/create-activity/create-activity'
    });
  },

  goToActivityDetail: function(e) {
    const activityId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/activity-detail/activity-detail?id=${activityId}`
    });
  },

  goToActivityList: function(e) {
    const tab = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.tab : 'search';
    const app = getApp();
    app.globalData.activityListTab = tab || 'search';
    wx.switchTab({
      url: '/pages/activity-list/activity-list'
    });
  },

  goToRules: function() {
    wx.navigateTo({
      url: '/pages/rules/rules'
    });
  },


  onEditNickname: function() {
    const userInfo = this.data.userInfo;
    this.setData({
      showEditDialog: true,
      editType: 'nickname',
      editNickname: userInfo && userInfo.nickname ? userInfo.nickname : ''
    });
  },

  onChooseAvatar: function(e) {
    const avatarUrl = e.detail.avatarUrl;
    if (avatarUrl) {
      this.saveAvatar(avatarUrl);
    }
  },

  uploadAvatar: function() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.saveAvatarToCloud(tempFilePath);
      }
    });
  },

  saveAvatarToCloud: function(filePath) {
    const app = getApp();
    const openid = app.globalData.openid;
    const cloudPath = `avatars/${openid}/${Date.now()}.jpg`;
    
    wx.showLoading({ title: '上传中...' });
    
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: (res) => {
        const fileID = res.fileID;
        this.saveAvatar(fileID);
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  saveAvatar: function(avatar) {
    wx.showLoading({ title: '保存中...' });

    request('update-user-avatar', 'update', { avatar: avatar }).then(res => {
      wx.hideLoading();
      if (res.result && res.result.success) {
        this.setData({ 'userInfo.avatar': avatar });
        wx.showToast({ title: '头像已更新', icon: 'success' });
      } else {
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },

  hideEditDialog: function() {
    this.setData({ showEditDialog: false });
  },

  stopPropagation: function() {},

  onEditNicknameInput: function(e) {
    this.setData({ editNickname: e.detail.value });
  },

  confirmEdit: function() {
    const app = getApp();
    
    const nickname = this.data.editNickname.trim();
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    if (nickname.length < 2) {
      wx.showToast({ title: '昵称至少2个字符', icon: 'none' });
      return;
    }
    
    wx.showLoading({ title: '保存中...' });
    request('update-user-info', 'update', { nickname: nickname }).then(res => {
      wx.hideLoading();
      if (res.result && res.result.success) {
        this.setData({
          'userInfo.nickname': nickname,
          showEditDialog: false
        });
        wx.showToast({ title: '保存成功', icon: 'success' });
      } else {
        wx.showToast({ title: res.result?.message || '保存失败', icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },

  // UX-16: 图片加载失败兜底 — 回退到首字母占位
  onImgError(e) {
    console.warn('图片加载失败', e && e.detail);
    if (this.data.userInfo && this.data.userInfo.avatar) {
      this.setData({ 'userInfo.avatar': '' });
    }
  }
});
