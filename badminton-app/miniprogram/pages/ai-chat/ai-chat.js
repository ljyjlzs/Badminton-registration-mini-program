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

  // ======================================================
  // 加载聊天历史
  // ======================================================
  loadHistory: function() {
    this.setData({ loadingHistory: true });
    wx.cloud.callFunction({
      name: 'ai-history',
      data: { action: 'get' },
      success: res => {
        this.setData({ loadingHistory: false });
        if (res.result && res.result.success) {
          const msgs = (res.result.data || [])
            .filter(m => m.role !== 'system_feedback') // 不显示系统反馈
            .map(m => this._parseMessage(m));
          this.setData({ messages: msgs });
          this.scrollToBottom('');
        }
      },
      fail: () => {
        this.setData({ loadingHistory: false });
      }
    });
  },

  // ======================================================
  // 解析消息：检测 __ACTION__ 块
  // ======================================================
  _parseMessage: function(m) {
    const base = {
      ...m,
      timeStr: this.formatTime(m.created_at),
      hasAction: false,
      actionData: null,
      displayContent: m.content,
      actionStatus: '' // '' | 'pending' | 'confirmed' | 'cancelled' | 'executing' | 'success' | 'error'
    };

    if (m.role !== 'assistant') return base;

    // 匹配 __ACTION__{...}__END__
    const actionMatch = m.content.match(/__ACTION__(\{[\s\S]*?\})__END__/);
    if (!actionMatch) return base;

    try {
      const actionData = JSON.parse(actionMatch[1]);
      // 文字部分（去掉 action 块）
      const displayContent = m.content.replace(/__ACTION__[\s\S]*?__END__/, '').trim();
      return {
        ...base,
        hasAction: true,
        actionData: actionData,
        displayContent: displayContent,
        actionStatus: 'pending'
      };
    } catch (e) {
      return base;
    }
  },

  // ======================================================
  // 输入框变化
  // ======================================================
  onInput: function(e) {
    this.setData({ inputValue: e.detail.value });
  },

  // ======================================================
  // 发送消息
  // ======================================================
  sendMessage: function() {
    const content = (this.data.inputValue || '').trim();
    if (!content || this.data.loading) return;

    const userMsg = {
      _id: 'tmp_' + Date.now(),
      role: 'user',
      content: content,
      displayContent: content,
      hasAction: false,
      actionStatus: '',
      timeStr: '刚刚'
    };

    this.setData({
      inputValue: '',
      loading: true,
      messages: [...this.data.messages, userMsg]
    });
    this.scrollToBottom(String(Date.now()));

    this._callAI({ message: content });
  },

  // ======================================================
  // 调用 AI 云函数
  // ======================================================
  _callAI: function(params) {
    wx.cloud.callFunction({
      name: 'ai-chat',
      data: params,
      success: res => {
        this.setData({ loading: false });
        if (res.result && res.result.success) {
          const raw = {
            _id: 'ai_' + Date.now(),
            role: 'assistant',
            content: res.result.data.content,
            created_at: null
          };
          const aiMsg = this._parseMessage(raw);
          aiMsg.timeStr = '刚刚';
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

  // ======================================================
  // 用户点击【确认操作】
  // ======================================================
  onConfirmAction: function(e) {
    const idx = e.currentTarget.dataset.index;
    const messages = this.data.messages;
    const msg = messages[idx];
    if (!msg || !msg.hasAction || msg.actionStatus !== 'pending') return;

    const action = msg.actionData;
    const actionType = action.action;

    // 更新状态为执行中
    const newMessages = [...messages];
    newMessages[idx] = { ...msg, actionStatus: 'executing' };
    this.setData({ messages: newMessages });

    // 根据操作类型执行
    if (actionType === 'create_activity') {
      this._doCreateActivity(idx, action.params);
    } else if (actionType === 'join_activity') {
      this._doJoinActivity(idx, action.params);
    } else if (actionType === 'cancel_registration') {
      this._doCancelRegistration(idx, action.params);
    } else {
      this._finishAction(idx, false, '未知操作类型：' + actionType);
    }
  },

  // ======================================================
  // 用户点击【取消操作】
  // ======================================================
  onCancelAction: function(e) {
    const idx = e.currentTarget.dataset.index;
    const messages = this.data.messages;
    const msg = messages[idx];
    if (!msg || !msg.hasAction) return;

    const newMessages = [...messages];
    newMessages[idx] = { ...msg, actionStatus: 'cancelled' };
    this.setData({ messages: newMessages, loading: true });

    // 告知 AI 操作已取消
    const cancelText = '[系统通知] 用户取消了操作：' + (msg.actionData.confirm_text || msg.actionData.action);
    this._callAI({ action_result: cancelText });
  },

  // ======================================================
  // 执行：创建活动
  // ======================================================
  _doCreateActivity: function(idx, params) {
    // time 字段需要转为时间戳（毫秒）
    let timeMs = params.time;
    if (typeof timeMs === 'string') {
      timeMs = new Date(timeMs).getTime();
    }

    wx.cloud.callFunction({
      name: 'create-activity',
      data: {
        name: params.name,
        time: timeMs,
        location: params.location,
        type: params.type || 'doubles'
      },
      success: res => {
        if (res.result && res.result.success) {
          this._finishAction(idx, true, '活动「' + params.name + '」创建成功！活动ID：' + res.result.data.activityId);
        } else {
          this._finishAction(idx, false, '创建活动失败：' + (res.result?.error || '未知错误'));
        }
      },
      fail: err => {
        this._finishAction(idx, false, '创建活动失败：' + (err.errMsg || '网络错误'));
      }
    });
  },

  // ======================================================
  // 执行：参加活动（需先获取用户信息）
  // ======================================================
  _doJoinActivity: function(idx, params) {
    // 参加活动需要用户的昵称、等级、头像
    // 从 globalData 或数据库获取用户信息
    const userInfo = app.globalData && app.globalData.userInfo;
    if (!userInfo || !userInfo.nickname) {
      this._finishAction(idx, false, '参加活动失败：请先在「首页」完善个人信息（昵称/等级）');
      return;
    }

    wx.cloud.callFunction({
      name: 'join-activity',
      data: {
        activityId: params.activityId,
        nickname: userInfo.nickname,
        level: userInfo.level || 5,
        avatar: userInfo.avatar || ('avatar_' + (userInfo.nickname || '?').charAt(0))
      },
      success: res => {
        if (res.result && res.result.success) {
          this._finishAction(idx, true, '已成功报名参加活动「' + params.activityName + '」！');
        } else {
          this._finishAction(idx, false, '报名失败：' + (res.result?.error || '未知错误'));
        }
      },
      fail: err => {
        this._finishAction(idx, false, '报名失败：' + (err.errMsg || '网络错误'));
      }
    });
  },

  // ======================================================
  // 执行：取消报名
  // ======================================================
  _doCancelRegistration: function(idx, params) {
    wx.cloud.callFunction({
      name: 'cancel-registration',
      data: { activityId: params.activityId },
      success: res => {
        if (res.result && res.result.success) {
          this._finishAction(idx, true, '已提交取消报名申请（活动：「' + params.activityName + '」），等待组织者审批。');
        } else {
          this._finishAction(idx, false, '取消报名失败：' + (res.result?.error || '未知错误'));
        }
      },
      fail: err => {
        this._finishAction(idx, false, '取消报名失败：' + (err.errMsg || '网络错误'));
      }
    });
  },

  // ======================================================
  // 操作完成：更新状态 + 反馈给 AI
  // ======================================================
  _finishAction: function(idx, success, resultText) {
    const messages = this.data.messages;
    const newMessages = [...messages];
    newMessages[idx] = {
      ...messages[idx],
      actionStatus: success ? 'success' : 'error',
      actionResultText: resultText
    };
    this.setData({ messages: newMessages, loading: true });

    // 把操作结果告知 AI，让 AI 继续回复
    this._callAI({ action_result: resultText });
  },

  // ======================================================
  // 滚动到底部
  // ======================================================
  scrollToBottom: function(suffix) {
    this.setData({ scrollToView: '' });
    setTimeout(() => {
      this.setData({ scrollToView: 'msg-bottom-' + suffix });
    }, 100);
  },

  // ======================================================
  // 格式化时间
  // ======================================================
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

  // ======================================================
  // 清空历史（新对话）
  // ======================================================
  clearHistory: function() {
    wx.showModal({
      title: '新对话',
      content: '确定要清空所有聊天记录，开始新对话吗？',
      success: res => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'ai-history',
            data: { action: 'clear' },
            success: res => {
              if (res.result && res.result.success) {
                this.setData({ messages: [] });
                wx.showToast({ title: '已开始新对话', icon: 'success' });
              }
            }
          });
        }
      }
    });
  }
});
