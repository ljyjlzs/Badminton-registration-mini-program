// 创建活动页面逻辑
const app = getApp();

Page({
  data: {
    name: '',
    location: '',
    latitude: null,
    longitude: null,
    date: '',
    time: '',
    activityType: 'doubles',
    minPlayers: 4,
    maxPlayers: 100,
    loading: false
  },

  onLoad: function() {
    this.initDateTime();
  },

  initDateTime: function() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate() + 1; // 默认明天
    
    this.setData({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      time: '18:00'
    });
  },

  onNameInput: function(e) {
    this.setData({
      name: e.detail.value
    });
  },

onLocationInput: function(e) {
    this.setData({
      location: e.detail.value
    });
  },

  onDateChange: function(e) {
    this.setData({
      date: e.detail.value
    });
  },

  onTimeChange: function(e) {
    this.setData({
      time: e.detail.value
    });
  },

  onTypeChange: function(e) {
    const type = e.currentTarget.dataset.type;
    const isDoubles = type !== 'singles';
    this.setData({
      activityType: type,
      minPlayers: isDoubles ? 4 : 3,
      maxPlayers: 100
    });
  },

  getLocation: function() {
    wx.chooseLocation({
      success: res => {
        let location = '';
        
        if (res.address && res.name) {
          if (res.name.includes(res.address) || res.address.includes(res.name)) {
            location = res.name || res.address;
          } else {
            location = res.address + res.name;
          }
        } else {
          location = res.name || res.address || '';
        }
        
        if (location) {
          this.setData({
            location: location,
            latitude: res.latitude,
            longitude: res.longitude
          });
        }
      },
      fail: err => {
        console.error('选择地点失败：', err);
        if (err.errMsg && err.errMsg.includes('cancel')) {
          return;
        }
        wx.showToast({
          title: '选择地点失败',
          icon: 'none'
        });
      }
    });
  },

  submit: function() {
    const { name, location, date, time } = this.data;
    
    // 表单验证
    if (!name || name.trim() === '') {
      wx.showToast({
        title: '请输入活动名称',
        icon: 'none'
      });
      return;
    }
    
    if (name.length > 50) {
      wx.showToast({
        title: '活动名称不能超过50字',
        icon: 'none'
      });
      return;
    }
    
    if (!location || location.trim() === '') {
      wx.showToast({
        title: '请输入活动地点',
        icon: 'none'
      });
      return;
    }
    
    if (!date) {
      wx.showToast({
        title: '请选择活动日期',
        icon: 'none'
      });
      return;
    }
    
    if (!time) {
      wx.showToast({
        title: '请选择活动时间',
        icon: 'none'
      });
      return;
    }
    
    // 组合时间戳
    const dateTimeStr = `${date} ${time}:00`;
    const activityTime = new Date(dateTimeStr).getTime();
    
    if (activityTime <= Date.now()) {
      wx.showToast({
        title: '活动时间是未来时间',
        icon: 'none'
      });
      return;
    }
    
    this.setData({ loading: true });
    
    // 调用云函数创建活动
    wx.cloud.callFunction({
      name: 'create-activity',
      data: {
        name: name.trim(),
        location: location.trim(),
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        time: activityTime,
        type: this.data.activityType
      },
      success: res => {
        this.setData({ loading: false });
        
        if (res.result.success) {
          wx.showToast({
            title: '创建成功',
            icon: 'success'
          });
          
          // 跳转到活动详情页
          setTimeout(() => {
            wx.redirectTo({
              url: `/pages/activity-detail/activity-detail?id=${res.result.data.activityId}`
            });
          }, 1500);
        } else {
          wx.showToast({
            title: res.result.error || '创建失败',
            icon: 'none'
          });
        }
      },
      fail: err => {
        this.setData({ loading: false });
        console.error('创建活动失败：', err);
        wx.showToast({
          title: '创建失败，请重试',
          icon: 'none'
        });
      }
    });
  }
});
