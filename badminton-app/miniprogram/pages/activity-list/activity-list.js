// 活动列表页面
const app = getApp();

Page({
  data: {
    myCreatedActivities: [],
    myJoinedActivities: [],
    currentTab: 'created',
    loading: true,
    statusText: {
      'registering': '报名中',
      'grouping': '分组中',
      'playing': '比赛中',
      'challenge': '挑战赛',
      'finished': '已结束'
    }
  },

  onLoad: function() {
    this.loadActivities();
  },

  onShow: function() {
    this.loadActivities();
  },

  onPullDownRefresh: function() {
    this.loadActivities();
    wx.stopPullDownRefresh();
  },

  loadActivities: function() {
    this.setData({ loading: true });
    
    const openid = app.globalData.openid;
    
    // 加载我创建的活动
    wx.cloud.callFunction({
      name: 'get-activities',
      data: {
        type: 'organized'
      },
      success: res => {
        if (res.result.success) {
          this.setData({
            myCreatedActivities: res.result.data || []
          });
        }
      }
    });
    
    // 加载我参加的活动
    wx.cloud.callFunction({
      name: 'get-activities',
      data: {
        type: 'joined'
      },
      success: res => {
        this.setData({ loading: false });
        if (res.result.success) {
          this.setData({
            myJoinedActivities: res.result.data || []
          });
        }
      },
      fail: () => {
        this.setData({ loading: false });
      }
    });
  },

  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
  },

  goToActivity: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/activity-detail/activity-detail?id=${id}`
    });
  },

  goToCreate: function() {
    wx.navigateTo({
      url: '/pages/create-activity/create-activity'
    });
  },

  formatTime: function(timeValue) {
    if (!timeValue) return '待定';
    
    let timestamp = timeValue;
    
    if (typeof timeValue === 'string') {
      if (timeValue.includes('T')) {
        timestamp = new Date(timeValue).getTime();
      } else if (!isNaN(timeValue)) {
        timestamp = parseInt(timeValue);
      } else {
        return '待定';
      }
    } else if (typeof timeValue === 'object') {
      if (timeValue.$date) {
        timestamp = timeValue.$date;
      } else {
        return '待定';
      }
    }
    
    if (!timestamp || isNaN(timestamp)) return '待定';
    
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '待定';
    
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}月${day}日`;
  }
});
