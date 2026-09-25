const { callFunction } = require('../../utils/request.js');

Page({
  data: {
    loading: true,
    user: null,
    activities: [],
    badges: [],
    badgeIcons: {
      mvp: '🏆', best_partner: '🤝', streak_king: '🔥', hard_worker: '💪', biggest_win: '🎯'
    }
  },

  onLoad() { this.loadData(); },

  async loadData() {
    try {
      this.setData({ loading: true });
      // PERF-04: login / 活动列表 / 徽章统计互不依赖，并行调用
      const [loginRes, orgRes, joinRes, statsRes] = await Promise.all([
        callFunction('login', 'login', {}),
        callFunction('get-activities', 'list', { type: 'organized', page: 1, pageSize: 20 }),
        callFunction('get-activities', 'list', { type: 'joined', page: 1, pageSize: 20 }),
        // 徽章加载失败不阻断页面
        callFunction('get-user-stats', 'get', { period: 'all' }).catch(e => {
          console.error('加载徽章失败：', e);
          return null;
        })
      ]);
      // AI-36: 校验 success，失败走 catch
      if (!loginRes || loginRes.success === false) throw new Error((loginRes && loginRes.message) || '登录失败');
      if (!orgRes || orgRes.success === false) throw new Error((orgRes && orgRes.message) || '加载失败');
      if (!joinRes || joinRes.success === false) throw new Error((joinRes && joinRes.message) || '加载失败');
      const user = loginRes.data || {};
      const allActs = [...((orgRes.data && orgRes.data.list) || []), ...((joinRes.data && joinRes.data.list) || [])];
      const seen = new Set();
      const uniqueActs = allActs.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
      uniqueActs.sort((a, b) => (b.time || '').localeCompare(a.time || ''));

      const stats = statsRes && (statsRes.data || statsRes);
      const badges = (stats && stats.badges) || [];

      this.setData({
        user,
        activities: uniqueActs.slice(0, 20),
        badges: badges,
        loading: false
      });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      this.setData({ loading: false });
    }
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/activity-detail/activity-detail?id=${id}` });
  },

  goToSummary() {
    wx.navigateTo({ url: '/pages/my-summary/my-summary' });
  },

  // BUG-17: 隐私政策入口
  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  // BUG-17: 用户协议入口
  goAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  onShareAppMessage: function() {
    return {
      title: '羽毛球 - 我的资料',
      path: '/pages/index/index'
    };
  }
});
