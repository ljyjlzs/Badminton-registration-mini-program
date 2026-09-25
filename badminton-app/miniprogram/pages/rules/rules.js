// pages/rules/rules.js
const { request } = require('../../utils/request.js');

const ICON_MAP = { singles: '🏸', doubles: '👥', 'fixed-doubles': '🔗' };

function toLines(text) {
  if (Array.isArray(text)) return text;
  if (!text) return [];
  return String(text).split(/[；;\n]/).map(s => s.trim()).filter(Boolean);
}

Page({
  data: {
    loading: true,
    currentTab: 'singles',
    sections: [],
    currentSection: null
  },

  onLoad: function () {
    this.loadRules();
  },

  onPullDownRefresh: function () {
    this.loadRules();
    wx.stopPullDownRefresh();
  },

  loadRules: function () {
    this.setData({ loading: true });
    request('get-rules', 'get', {}).then(res => {
      this.setData({ loading: false });
      if (res.result && res.result.success) {
        const raw = (res.result.data && res.result.data.sections) || [];
        const sections = raw.map(s => ({
          id: s.type,
          name: s.title,
          icon: ICON_MAP[s.type] || '📋',
          match_rules: toLines(s.match_rules),
          scoring_rules: toLines(s.scoring_rules),
          common_rules: toLines(s.common_rules)
        }));
        const currentSection = sections.find(s => s.id === this.data.currentTab) || sections[0] || null;
        this.setData({ sections: sections, currentSection: currentSection });
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '网络错误', icon: 'none' });
    });
  },

  switchTab: function (e) {
    const tab = e.currentTarget.dataset.tab;
    const currentSection = this.data.sections.find(s => s.id === tab) || null;
    this.setData({
      currentTab: tab,
      currentSection: currentSection
    });
  },

  goToRulesQa: function() {
    wx.navigateTo({ url: '/pages/rules-qa/rules-qa' });
  },

  onShareAppMessage: function() {
    return {
      title: '羽毛球比赛规则',
      path: '/pages/rules/rules'
    };
  },

  onShareTimeline: function() {
    return {
      title: '羽毛球比赛规则'
    };
  }
});
