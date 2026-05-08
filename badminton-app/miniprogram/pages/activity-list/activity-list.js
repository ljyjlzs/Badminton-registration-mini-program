// 活动列表页面
const app = getApp();

// 活动类型中文映射
const TYPE_MAP = {
  'singles': '单打',
  'doubles': '双打轮换',
  'fixed-doubles': '双打固搭'
};

Page({
  data: {
    myCreatedActivities: [],
    myJoinedActivities: [],
    availableActivities: [],
    filteredCreatedActivities: [],
    filteredJoinedActivities: [],
    searchResults: [],
    searchKeyword: '',
    currentTab: 'created',
    loading: true,
    searchLoading: false,
    statusText: {
      'registering': '报名中',
      'grouping': '分组中',
      'playing': '比赛中',
      'challenge': '挑战赛',
      'final': '决赛',
      'finished': '已结束'
    }
  },

  onLoad: function(options) {
    // tabBar 页面不支持 url 参数，通过 globalData 传递
    const app = getApp();
    const targetTab = app.globalData.activityListTab || 'created';
    this.setData({ currentTab: targetTab });
    if (app.globalData.isLoggedIn) {
      this.loadActivities();
    }
  },

  onShow: function() {
    // 授权拦截：未登录则跳回首页
    if (!app.globalData.isLoggedIn) {
      wx.showModal({
        title: '需要授权',
        content: '请先在首页授权登录后查看活动',
        showCancel: false,
        success: () => {
          wx.switchTab({ url: '/pages/index/index' });
        }
      });
      return;
    }
    // 每次显示时刷新数据
    this.loadActivities();
  },

  onPullDownRefresh: function() {
    this.loadActivities();
    wx.stopPullDownRefresh();
  },

  loadActivities: function() {
    this.setData({ loading: true });
    
    // 加载我创建的活动
    wx.cloud.callFunction({
      name: 'get-activities',
      data: { type: 'organized' },
      success: res => {
        if (res.result.success) {
          const list = res.result.data || [];
          this.setData({ myCreatedActivities: list });
          this.applyFilter();
        }
      }
    });
    
    // 加载我参加的活动
    wx.cloud.callFunction({
      name: 'get-activities',
      data: { type: 'joined' },
      success: res => {
        this.setData({ loading: false });
        if (res.result.success) {
          const list = res.result.data || [];
          this.setData({ myJoinedActivities: list });
          this.applyFilter();
        }
      },
      fail: () => {
        this.setData({ loading: false });
      }
    });

    // 加载可参加的活动（用于查找活动tab）
    wx.cloud.callFunction({
      name: 'get-activities',
      data: { type: 'available' },
      success: res => {
        if (res.result && res.result.success) {
          this.setData({ availableActivities: res.result.data || [] });
          // 如果当前在搜索tab且没有关键词，用可参加活动作为搜索结果
          if (this.data.currentTab === 'search' && !this.data.searchKeyword) {
            this.setData({ searchResults: res.result.data || [] });
          }
        }
      }
    });

    // 如果在搜索tab，重新搜索
    if (this.data.currentTab === 'search' && this.data.searchKeyword) {
      this.doCloudSearch();
    }
  },

  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
    
    // 切到搜索tab时，有关键词就搜索，无关键词就显示全部可参加活动
    if (tab === 'search') {
      if (this.data.searchKeyword) {
        this.doCloudSearch();
      } else {
        this.setData({ searchResults: this.data.availableActivities });
      }
    } else {
      this.applyFilter();
    }
  },

  // 搜索输入
  onSearchInput: function(e) {
    this.setData({ searchKeyword: e.detail.value });
    // 防抖
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      if (this.data.currentTab === 'search') {
        this.doCloudSearch();
      } else {
        this.applyFilter();
      }
    }, 300);
  },

  // 按回车搜索
  doSearch: function() {
    if (this.data.currentTab === 'search') {
      this.doCloudSearch();
    } else {
      this.applyFilter();
    }
  },

  // 本地过滤（我创建的 / 我参加的）
  applyFilter: function() {
    const kw = (this.data.searchKeyword || '').trim().toLowerCase();

    if (!kw) {
      this.setData({
        filteredCreatedActivities: this.data.myCreatedActivities,
        filteredJoinedActivities: this.data.myJoinedActivities
      });
      return;
    }

    const filterFn = (item) => {
      const nameMatch = item.name && item.name.toLowerCase().includes(kw);
      const locationMatch = item.location && item.location.toLowerCase().includes(kw);
      const typeCn = TYPE_MAP[item.type] || '';
      const typeMatch = typeCn.includes(kw) || (item.type && item.type.toLowerCase().includes(kw));
      return nameMatch || locationMatch || typeMatch;
    };

    this.setData({
      filteredCreatedActivities: this.data.myCreatedActivities.filter(filterFn),
      filteredJoinedActivities: this.data.myJoinedActivities.filter(filterFn)
    });
  },

  // 云端搜索（查找活动）
  doCloudSearch: function() {
    const keyword = this.data.searchKeyword.trim();
    if (!keyword) {
      this.setData({ searchResults: [] });
      return;
    }

    this.setData({ searchLoading: true });

    wx.cloud.callFunction({
      name: 'get-activities',
      data: {
        type: 'search',
        keyword: keyword
      },
      success: res => {
        this.setData({ searchLoading: false });
        if (res.result && res.result.success) {
          this.setData({
            searchResults: res.result.data || []
          });
        } else {
          this.setData({ searchResults: [] });
        }
      },
      fail: err => {
        console.error('[搜索] 失败:', err);
        this.setData({ searchLoading: false });
        wx.showToast({ title: '搜索失败', icon: 'none' });
      }
    });
  },

  clearSearch: function() {
    this.setData({
      searchKeyword: '',
      searchResults: this.data.availableActivities,
      filteredCreatedActivities: this.data.myCreatedActivities,
      filteredJoinedActivities: this.data.myJoinedActivities
    });
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
    const hour = date.getHours();
    const minute = date.getMinutes();
    return `${month}月${day}日 ${hour}:${minute < 10 ? '0' + minute : minute}`;
  }
});
