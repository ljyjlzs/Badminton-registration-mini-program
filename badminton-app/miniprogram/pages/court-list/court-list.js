const { callFunction } = require('../../utils/request.js');

Page({
  data: {
    loading: true,
    activity: null,
    courts: [],
    unassigned: [],
    isOrganizer: false,
    status: '',
    showConfigModal: false,
    ppcInput: '',
    readyResult: null,
    submitting: false
  },

  onLoad(options) {
    this.activityId = options.activityId;
    this.loadData();
  },

  onShow() {
    if (this.activityId) this.loadData();
  },

  async loadData() {
    try {
      // UX-10: 已有数据时静默刷新，避免从子页面返回整页白屏
      if (!this.data.activity) {
        this.setData({ loading: true });
      }
      const dataRes = await callFunction('court-list', 'get', { activityId: this.activityId });
      const detailRes = await callFunction('get-activity-detail', 'detail', { activityId: this.activityId });
      // AI-48: callFunction 返回信封 { success, data, message }，需解包一层
      const data = (dataRes && dataRes.data) || dataRes || {};
      const detail = (detailRes && detailRes.data) || detailRes || {};
      this.setData({
        activity: detail.activity,
        isOrganizer: detail.isOrganizer,
        status: (detail.activity && detail.activity.status) || '',
        courts: data.courts || [],
        unassigned: data.unassigned || [],
        loading: false
      });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      this.setData({ loading: false });
    }
  },

  showConfig() {
    const ppc = this.data.activity ? (this.data.activity.playersPerCourt || 4) : 4;
    this.setData({ showConfigModal: true, ppcInput: String(ppc) });
  },

  hideConfig() { this.setData({ showConfigModal: false }); },

  onPpcInput(e) { this.setData({ ppcInput: e.detail.value }); },

  async confirmConfig() {
    const ppc = Number(this.data.ppcInput);
    if (!(ppc >= 4)) return wx.showToast({ title: '每场至少4人', icon: 'none' });
    try {
      await callFunction('court-config', 'config', { activityId: this.activityId, playersPerCourt: ppc });
      wx.showToast({ title: '配置成功', icon: 'success' });
      this.setData({ showConfigModal: false });
      this.loadData();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  async addCourt() {
    try {
      await callFunction('court-add', 'add', { activityId: this.activityId });
      wx.showToast({ title: '新增成功', icon: 'success' });
      this.loadData();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  async deleteCourt(e) {
    const courtNo = e.currentTarget.dataset.courtno;
    wx.showModal({
      title: '确认删除',
      content: `确定删除场地${String.fromCharCode(64 + courtNo)}？`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await callFunction('court-delete', 'delete', { activityId: this.activityId, courtNo });
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadData();
        } catch (e) {
          wx.showToast({ title: e.message, icon: 'none' });
        }
      }
    });
  },

  async autoAssign() {
    try {
      const r = await callFunction('court-assign', 'autoAssign', { activityId: this.activityId });
      // AI-48: callFunction 返回信封 { success, data, message }，需解包一层
      const d = (r && r.data) || r || {};
      wx.showToast({ title: `已分配${d.assigned}人`, icon: 'success' });
      this.loadData();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  async checkReady() {
    try {
      const r = await callFunction('court-ready', 'checkReady', { activityId: this.activityId });
      // AI-48: callFunction 返回信封 { success, data, message }，需解包一层
      const d = (r && r.data) || r || {};
      this.setData({ readyResult: d });
      if (d.ready) {
        wx.showModal({
          title: '可以开始',
          content: '所有场地已就绪，是否开始分组？',
          success: async (res) => {
            if (res.confirm) await this.startGrouping();
          }
        });
      }
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  async startGrouping() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      await callFunction('court-start', 'generate', { activityId: this.activityId });
      wx.showToast({ title: '分组完成', icon: 'success' });
      wx.navigateTo({ url: `/pages/court-detail/court-detail?activityId=${this.activityId}` });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goToCourtDetail() {
    wx.navigateTo({ url: `/pages/court-detail/court-detail?activityId=${this.activityId}` });
  },

  onShareAppMessage: function() {
    return {
      title: '羽毛球场地赛',
      path: '/pages/court-list/court-list?activityId=' + this.activityId
    };
  }
});
