// pages/ai-chat/ai-chat.js
const app = getApp();

Page({
  data: {
    messages: [],
    inputValue: '',
    loading: false,
    loadingHistory: false,
    scrollToView: ''
  },

  onShow: function() {
    this.loadHistory();
  },

  // 加载聊天历史
  loadHistory: function() {
    this.setData({ loadingHistory: true });
    wx.cloud.callFunction({
      name: 'ai-history',
      data: { action: 'get' },
      success: res => {
        this.setData({ loadingHistory: false });
        if (res.result && res.result.success) {
          const msgs = (res.result.data || []).map(m => ({
            ...m,
            timeStr: this.formatTime(m.created_at)
          }));
          this.setData({
            messages: msgs
          });
          this.scrollToBottom('');
        }
      },
      fail: () => {
        this.setData({ loadingHistory: false });
      }
    });
  },

  // 输入框变化
  onInput: function(e) {
    this.setData({ inputValue: e.detail.value });
  },

  // 发送消息
  sendMessage: function() {
    const content = (this.data.inputValue || '').trim();
    if (!content || this.data.loading) return;

    const userMsg = {
      _id: 'tmp_' + Date.now(),
      role: 'user',
      content: content,
      timeStr: '刚刚'
    };

    this.setData({
      inputValue: '',
      loading: true,
      messages: [...this.data.messages, userMsg]
    });
    this.scrollToBottom(String(Date.now()));

    wx.cloud.callFunction({
      name: 'ai-chat',
      data: { message: content },
      success: res => {
        this.setData({ loading: false });
        if (res.result && res.result.success) {
          const aiContent = res.result.data.content;
          const aiMsg = {
            _id: 'ai_' + Date.now(),
            role: 'assistant',
            content: aiContent,
            timeStr: '刚刚'
          };
          this.setData({
            messages: [...this.data.messages, aiMsg]
          });
          this.scrollToBottom(String(Date.now()));
        } else {
          wx.showToast({ title: res.result?.error || '发送失败', icon: 'none' });
        }
      },
      fail: err => {
        this.setData({ loading: false });
        console.error('ai-chat 云函数调用失败:', err);
        wx.showToast({ title: err.errMsg || '发送失败', icon: 'none', duration: 3000 });
      }
    });
  },

  // 滚动到底部
  scrollToBottom: function(suffix) {
    this.setData({ scrollToView: '' });
    setTimeout(() => {
      this.setData({ scrollToView: 'msg-bottom-' + suffix });
    }, 100);
  },

  // 格式化时间
  formatTime: function(timeValue) {
    if (!timeValue) return '';
    let ts = timeValue;
    if (typeof timeValue === 'object' && timeValue.$date) {
      ts = timeValue.$date;
    }
    const d = new Date(ts);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  },

  // 清空历史
  clearHistory: function() {
    wx.showModal({
      title: '清空聊天记录',
      content: '确定要清空所有聊天记录吗？',
      success: res => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'ai-history',
            data: { action: 'clear' },
            success: res => {
              if (res.result && res.result.success) {
                this.setData({ messages: [] });
                wx.showToast({ title: '已清空', icon: 'success' });
              }
            }
          });
        }
      }
    });
  }
});
