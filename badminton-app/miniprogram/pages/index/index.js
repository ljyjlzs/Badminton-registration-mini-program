// 首页逻辑
const app = getApp();

Page({
  data: {
    userInfo: null,
    isLoggedIn: false,
    myActivities: [],
    joinableActivities: [],
    unavailableActivities: [],
    loading: true,
    showEditDialog: false,
    editType: 'nickname',
    editNickname: ''
  },

  onLoad: function() {
    this.checkLogin();
  },

  onShow: function() {
    if (this.data.isLoggedIn) {
      this.loadActivities();
    }
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
    db.collection('users').where({ _openid: openid }).get({
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
      wx.cloud.callFunction({
        name: 'login',
        data: {
          userInfo: userInfo
        },
        success: res => {
          this.setData({ loading: false });
          
          if (res.result) {
            const result = res.result;
            if (result.success && result.data) {
              app.globalData.userInfo = {
                ...result.data,
                ...userInfo
              };
              app.globalData.openid = result.data.openid;
              app.globalData.isLoggedIn = true;
              
              this.setData({
                isLoggedIn: true,
                userInfo: app.globalData.userInfo
              });
              
              this.loadActivities();
            } else {
              wx.showToast({
                title: result.error || '登录失败',
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
        },
        fail: err => {
          console.error('登录失败：', err);
          this.setData({ loading: false });
          wx.showToast({
            title: '登录失败，请重试',
            icon: 'none'
          });
        }
      });
    }
  },

  loadActivities: function() {
    const openid = app.globalData.openid;
    let completed = 0;
    const total = 3;
    
    const checkDone = () => {
      completed++;
      if (completed >= total) {
        this.setData({ loading: false });
      }
    };
    
    // 查询我创建的活动
    wx.cloud.callFunction({
      name: 'get-activities',
      data: {
        type: 'organized',
        openid: openid
      },
      success: res => {
        if (res.result && res.result.success) {
          this.setData({
            myActivities: res.result.data || []
          });
        }
        checkDone();
      },
      fail: () => {
        checkDone();
      }
    });
    
    // 查询可参加的活动
    wx.cloud.callFunction({
      name: 'get-activities',
      data: {
        type: 'available'
      },
      success: res => {
        if (res.result && res.result.success) {
          this.setData({
            joinableActivities: res.result.data || []
          });
        }
        checkDone();
      },
      fail: () => {
        checkDone();
      }
    });
    
    // 查询不可参加的活动（正在进行和已结束）
    wx.cloud.callFunction({
      name: 'get-activities',
      data: {
        type: 'unavailable'
      },
      success: res => {
        if (res.result && res.result.success) {
          this.setData({
            unavailableActivities: res.result.data || []
          });
        }
        checkDone();
      },
      fail: () => {
        checkDone();
      }
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

  goToActivityList: function() {
    wx.navigateTo({
      url: '/pages/activity-list/activity-list?tab=search'
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
    
    wx.cloud.callFunction({
      name: 'update-user-avatar',
      data: { avatar: avatar },
      success: (res) => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          this.setData({
            'userInfo.avatar': avatar
          });
          wx.showToast({ title: '头像已更新', icon: 'success' });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
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
    wx.cloud.callFunction({
      name: 'update-user-info',
      data: { nickname: nickname },
      success: res => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          this.setData({
            'userInfo.nickname': nickname,
            showEditDialog: false
          });
          wx.showToast({ title: '保存成功', icon: 'success' });
        } else {
          wx.showToast({ title: res.result?.error || '保存失败', icon: 'none' });
        }
      },
      fail: err => {
        wx.hideLoading();
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    });
  }
});
