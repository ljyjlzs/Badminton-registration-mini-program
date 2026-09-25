// 活动列表页面
const app = getApp();
const { callFunction } = require('../../utils/request.js');
const shareUtil = require('../../utils/share.js');

// 活动类型中文映射
const TYPE_MAP = {
  'singles': '单打',
  'doubles': '双打轮换',
  'fixed-doubles': '双打固搭',
  'court-doubles': '按场地双打'
};

Page({
  onShareAppMessage: function() {
    var s = shareUtil.makeShare({ title: '羽毛球活动列表', path: '/pages/activity-list/activity-list' });
    return { title: s.title, path: s.path };
  },

  onShareTimeline: function() {
    var s = shareUtil.makeShare({ title: '羽毛球活动列表', path: '/pages/activity-list/activity-list' });
    return { title: s.title, query: s.timeline.query };
  },

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
    loadError: false,
    availablePage: 1,
    availableHasMore: false,
    availableLoadingMore: false,
    searchPage: 1,
    searchHasMore: false,
    filterDateStart: '',
    filterDateEnd: '',
    filterType: '',
    statusText: {
      'registering': '报名中',
      'grouping': '分组中',
      'playing': '比赛中',
      'finished': '已结束'
    }
  },

  onLoad: function(options) {
    // PERF-21: onShow 节流状态
    this._firstShowDone = false;
    this._lastLoadAt = 0;
    // tabBar 页面不支持 url 参数，通过 globalData 传递
    if (app.globalData.isLoggedIn) {
      this.loadActivities();
    }
  },

  onShow: function() {
    // 每次显示时读取目标 tab（全局跳转可能随时切换）
    const targetTab = app.globalData.activityListTab || 'created';
    this.setData({ currentTab: targetTab });
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
    // PERF-21: 首次 onShow 照常加载（onLoad 已加载过则跳过，避免双跑）
    if (!this._firstShowDone) {
      this._firstShowDone = true;
      if (this._lastLoadAt) return;
      this.loadActivities();
      return;
    }
    // PERF-21: 60 秒内重复进入且已有数据，不全量刷新
    const hasData = (this.data.myCreatedActivities || []).length > 0 ||
      (this.data.myJoinedActivities || []).length > 0 ||
      (this.data.availableActivities || []).length > 0;
    if (hasData && Date.now() - this._lastLoadAt < 60000) return;
    this.loadActivities();
  },

  onPullDownRefresh: function() {
    this.loadActivities();
    wx.stopPullDownRefresh();
  },

  loadActivities: function() {
    this._lastLoadAt = Date.now();
    this.setData({ loading: true, loadError: false });

    // 加载我创建的活动
    callFunction('get-activities', 'list', { type: 'organized', page: 1, pageSize: 20 }).then(res => {
      if (res.success) {
        this.setData({ myCreatedActivities: this.withFormattedTime((res.data && res.data.list) || []) });
        this.applyFilter();
      }
    }).catch(() => {
      this.setData({ loadError: true });
    });

    // 加载我参加的活动
    callFunction('get-activities', 'list', { type: 'joined', page: 1, pageSize: 20 }).then(res => {
      this.setData({ loading: false });
      if (res.success) {
        var self = this;
        var joined = this.withFormattedTime((res.data && res.data.list) || []).map(function(item) {
          var ts = self.parseTime(item.time);
          var daysLeft = 0;
          if (ts) {
            // 自然日差：今日 0 点对齐，避免用毫秒 ceil 把今天算成 1 天
            var startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            var startOfEvent = new Date(ts);
            startOfEvent.setHours(0, 0, 0, 0);
            daysLeft = Math.round((startOfEvent - startOfToday) / 86400000);
          }
          return Object.assign({}, item, { daysLeft: daysLeft });
        });
        this.setData({ myJoinedActivities: joined });
        this.applyFilter();
      }
    }).catch(() => {
      this.setData({ loading: false, loadError: true });
    });

    // 加载可参加的活动（用于查找活动tab）
    callFunction('get-activities', 'list', { type: 'available', page: 1, pageSize: 20 }).then(res => {
      if (res.success) {
        var available = this.withFormattedTime((res.data && res.data.list) || []);
        this.setData({ availableActivities: available, availableHasMore: (res.data && res.data.hasMore) || false, availablePage: 1 });
        if (this.data.currentTab === 'search' && !this.data.searchKeyword) {
          this.setData({ searchResults: available });
        }
      }
    }).catch(() => {
      this.setData({ loadError: true });
    });

    // 如果在搜索tab，重新搜索
    if (this.data.currentTab === 'search' && this.data.searchKeyword) {
      this.doCloudSearch();
    }
  },

  withFormattedTime: function(list) {
    var self = this;
    return (list || []).map(function(item) {
      return Object.assign({}, item, { formattedTime: self.formatTime(item.time) });
    });
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

  onDateStartChange: function(e) {
    this.setData({ filterDateStart: e.detail.value });
    this.applyFilter();
  },

  onDateEndChange: function(e) {
    this.setData({ filterDateEnd: e.detail.value });
    this.applyFilter();
  },

  onFilterTypeChange: function(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ filterType: this.data.filterType === type ? '' : type });
    this.applyFilter();
  },

  clearFilter: function() {
    this.setData({ filterDateStart: '', filterDateEnd: '', filterType: '' });
    this.applyFilter();
  },

  applyFilter: function() {
    const kw = (this.data.searchKeyword || '').trim().toLowerCase();
    const { filterDateStart, filterDateEnd, filterType } = this.data;

    const filterFn = (item) => {
      if (kw) {
        const nameMatch = item.name && item.name.toLowerCase().includes(kw);
        const locationMatch = item.location && item.location.toLowerCase().includes(kw);
        const typeCn = TYPE_MAP[item.type] || '';
        const typeMatch = typeCn.includes(kw) || (item.type && item.type.toLowerCase().includes(kw));
        if (!nameMatch && !locationMatch && !typeMatch) return false;
      }
      if (filterType && item.type !== filterType) return false;
      if (filterDateStart || filterDateEnd) {
        const itemTime = item.time ? new Date(item.time).getTime() : 0;
        if (filterDateStart) {
          const start = new Date(filterDateStart).getTime();
          if (itemTime < start) return false;
        }
        if (filterDateEnd) {
          const end = new Date(filterDateEnd).getTime() + 86400000;
          if (itemTime > end) return false;
        }
      }
      return true;
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

    callFunction('get-activities', 'list', { type: 'search', keyword, page: 1, pageSize: 20 }).then(res => {
      this.setData({ searchLoading: false });
      const list = this.withFormattedTime(res.success ? ((res.data && res.data.list) || []) : []);
      this.setData({
        searchResults: list,
        searchPage: 1,
        searchHasMore: (res.data && res.data.hasMore) || false
      });
    }).catch(() => {
      this.setData({ searchLoading: false });
      wx.showToast({ title: '搜索失败', icon: 'none' });
    });
  },

  clearSearch: function() {
    this.setData({
      searchKeyword: '',
      searchResults: this.data.availableActivities,
      searchHasMore: this.data.availableHasMore,
      searchPage: this.data.availablePage,
      filteredCreatedActivities: this.data.myCreatedActivities,
      filteredJoinedActivities: this.data.myJoinedActivities
    });
  },

  // BUG-6/UX-25: 触底加载更多（仅搜索/可参加 tab）
  onReachBottom: function() {
    if (this.data.currentTab !== 'search') return;
    if (this.data.searchLoading || this.data.availableLoadingMore) return;

    const isSearch = !!(this.data.searchKeyword || '').trim();
    const hasMore = isSearch ? this.data.searchHasMore : this.data.availableHasMore;
    if (!hasMore) return;

    const nextPage = (isSearch ? this.data.searchPage : this.data.availablePage) + 1;
    const keyword = (this.data.searchKeyword || '').trim();

    this.setData({ availableLoadingMore: true });
    const payload = isSearch
      ? { type: 'search', keyword, page: nextPage, pageSize: 20 }
      : { type: 'available', page: nextPage, pageSize: 20 };

    callFunction('get-activities', 'list', payload).then(res => {
      const more = this.withFormattedTime((res.success && res.data && res.data.list) || []);
      const hasMoreAfter = (res.data && res.data.hasMore) || false;
      const existing = isSearch ? this.data.searchResults : this.data.availableActivities;
      const merged = existing.concat(more);
      const patch = { availableLoadingMore: false };
      if (isSearch) {
        patch.searchResults = merged;
        patch.searchPage = nextPage;
        patch.searchHasMore = hasMoreAfter;
      } else {
        patch.availableActivities = merged;
        patch.availablePage = nextPage;
        patch.availableHasMore = hasMoreAfter;
        patch.searchResults = merged;
      }
      this.setData(patch);
    }).catch(() => {
      this.setData({ availableLoadingMore: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
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

  parseTime: function(timeValue) {
    if (!timeValue && timeValue !== 0) return null;

    let timestamp = timeValue;

    if (typeof timeValue === 'string') {
      if (timeValue.includes('T')) {
        timestamp = new Date(timeValue).getTime();
      } else if (!isNaN(timeValue)) {
        timestamp = parseInt(timeValue);
      } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timeValue)) {
        timestamp = new Date(timeValue.replace(/-/g, '/')).getTime();
      } else {
        return null;
      }
    } else if (typeof timeValue === 'object') {
      if (timeValue.$date) {
        timestamp = timeValue.$date;
      } else {
        return null;
      }
    }

    if (!timestamp || isNaN(timestamp)) return null;
    return timestamp;
  },

  formatTime: function(timeValue) {
    var timestamp = this.parseTime(timeValue);
    if (!timestamp) return '待定';

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '待定';

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    return `${month}月${day}日 ${hour}:${minute < 10 ? '0' + minute : minute}`;
  }
});
