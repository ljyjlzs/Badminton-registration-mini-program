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
    if (options && options.tab === 'search') {
      this.setData({ currentTab: 'search' });
    }
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

    // 如果在搜索tab，重新搜索
    if (this.data.currentTab === 'search' && this.data.searchKeyword) {
      this.doCloudSearch();
    }
  },

  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
    
    // 切到搜索tab时，如果有关键词就自动搜索
    if (tab === 'search' && this.data.searchKeyword) {
      this.doCloudSearch();
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
      searchResults: [],
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
