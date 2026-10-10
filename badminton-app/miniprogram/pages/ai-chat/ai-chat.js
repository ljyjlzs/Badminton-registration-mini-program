// pages/ai-chat/ai-chat.js
const app = getApp();
const { request } = require('../../utils/request.js');
// ENG-11: 默认等级常量
const constants = require('../../utils/constants.js');
const timeUtil = require('../../utils/time.js');

Page({
  data: {
    messages: [],
    inputValue: '',
    loading: false,
    loadingHistory: false,
    scrollToView: ''
  },

  // AI-33: 请求序号，初始化放在生命周期外避免被 setData 序列化
  _aiSeq: 0,
  // PERF-18: onShow 历史拉取节流时间戳（同 AI-33，放生命周期外）
  _lastLoadAt: 0,

  onShow: function() {
    // 授权拦截：未登录则跳回首页
    if (!app.globalData.isLoggedIn) {
      wx.showModal({
        title: '需要授权',
        content: '请先在首页授权登录后使用AI功能',
        showCancel: false,
        success: () => {
          wx.switchTab({ url: '/pages/index/index' });
        }
      });
      return;
    }
    // 昵称拦截：未设置昵称则提示并跳回首页
    const nickname = (app.globalData.userInfo && app.globalData.userInfo.nickname) || '';
    if (!nickname) {
      wx.showModal({
        title: '需要设置昵称',
        content: '请先在首页设置昵称后使用AI功能',
        showCancel: false,
        success: () => {
          wx.switchTab({ url: '/pages/index/index' });
        }
      });
      return;
    }
    // PERF-18: _lastLoadAt 节流，15s 内不重复请求
    if (Date.now() - (this._lastLoadAt || 0) < 15000) return;
    // PERF-26: 仅脏标记或首次进入时刷新历史
    if (this._historyDirty || !this._historyLoaded) {
      this.loadHistory();
    }
  },

  // ======================================================
  // 加载聊天历史
  // ======================================================
  loadHistory: function() {
    this._lastLoadAt = Date.now();
    this.setData({ loadingHistory: true });
    request('ai-history', 'get', {}).then(res => {
      this.setData({ loadingHistory: false });
      if (res.result && res.result.success) {
        const msgs = (res.result.data || [])
          // i=134: 统一过滤 system_feedback 与历史遗留的 __system_feedback
          .filter(m => m.role !== 'system_feedback' && m.role !== '__system_feedback')
          .map(m => this._parseMessage(m));
        this.setData({ messages: msgs });
        this._historyDirty = false;
        this._historyLoaded = true;
        this.scrollToBottom();
      }
    }).catch(() => {
      this.setData({ loadingHistory: false });
    });
  },

  // PERF-28: 路径式追加单条消息，避免整段序列化 messages
  _appendMessage: function(msg) {
    const n = this.data.messages.length;
    const patch = {};
    patch['messages[' + n + ']'] = msg;
    this.setData(patch);
  },

  // PERF-28: 路径式更新指定下标消息
  _updateMessageAt: function(idx, msg) {
    const patch = {};
    patch['messages[' + idx + ']'] = msg;
    this.setData(patch);
  },

  // ======================================================
  // 解析消息：检测 __ACTION__ 块和 __SELECT__ 块
  // ======================================================
  _parseMessage: function(m) {
    const base = {
      ...m,
      timeStr: this.formatTime(m.createdAt || m.created_at),
      hasAction: false,
      actionData: null,
      hasSelect: false,
      selectOptions: [],
      displayContent: m.content,
      actionStatus: m.actionStatus || '' // '' | 'pending' | 'confirmed' | 'cancelled' | 'executing' | 'success' | 'error'
    };

    if (m.role !== 'assistant') return base;
    // AI-3: 空 content 保护，防止 TypeError
    if (!m.content) return base;

    // i=152: 解析失败时隐藏原始协议标记，显示友好提示
    const stripProtocolMarkers = function(text) {
      return (text || '')
        .replace(/__SELECT__[\s\S]*?__END__/g, '')
        .replace(/__ACTION__[\s\S]*?__END__/g, '')
        .trim();
    };

    // 匹配 __SELECT__[...]__END__（活动选择列表）
    const selectMatch = m.content.match(/__SELECT__(\[[\s\S]*?\])__END__/);
    if (selectMatch) {
      try {
        const selectOptions = JSON.parse(selectMatch[1]);
        if (Array.isArray(selectOptions) && selectOptions.length > 0) {
          const displayContent = m.content.replace(/__SELECT__[\s\S]*?__END__/, '').trim();
          return {
            ...base,
            hasSelect: true,
            selectOptions: selectOptions,
            displayContent: displayContent
          };
        }
        // i=154: 空列表不渲染空卡片
        return {
          ...base,
          displayContent: stripProtocolMarkers(m.content) || '（暂无可选活动）'
        };
      } catch (e) {
        // 解析失败，去掉原始标记后继续尝试 ACTION
        base.displayContent = stripProtocolMarkers(m.content) || '（消息内容解析失败）';
      }
    }

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
        // AI-10: 优先读持久化的 actionStatus，避免历史重载后重置为 pending
        actionStatus: m.actionStatus || 'pending'
      };
    } catch (e) {
      // i=152: JSON 解析失败，不把 __ACTION__{...}__END__ 原始标记渲染给用户
      return {
        ...base,
        displayContent: stripProtocolMarkers(m.content) || '（操作卡片解析失败，请重新发送指令）'
      };
    }
  },

  // AI-10: 将 actionStatus/actionResultText 持久化到 ai_messages（仅数据库消息）
  _persistActionStatus: function(msg, status, resultText) {
    if (!msg || !msg._id) return;
    const id = String(msg._id);
    if (id.indexOf('tmp_') === 0 || id.indexOf('ai_') === 0 || id.indexOf('err_') === 0 || id.indexOf('select_') === 0) {
      return;
    }
    request('ai-history', 'updateActionStatus', { messageId: id, actionStatus: status, actionResultText: resultText || '' }).catch(function() {});
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
      loading: true
    });
    this._appendMessage(userMsg);
    this.scrollToBottom();

    // D-2: 传递多轮上下文 history 给 AI
    const history = this.data.messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content && !String(m._id).startsWith('tmp_'))
      .slice(-20)
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
    this._callAI({ message: content, history: history });
  },

  // ======================================================
  // 调用 AI 云函数（带超时处理 + 请求序号失效判断）
  // ======================================================
  _callAI: function(params) {
    // AI-33: 请求序号，超时后迟到结果不再插入
    const seq = ++this._aiSeq;
    // 设置超时处理（30秒）
    const timeoutId = setTimeout(() => {
      if (seq === this._aiSeq && this.data.loading) {
        this._aiSeq++;
        this.setData({ loading: false });
        wx.showToast({ title: 'AI响应超时，请重试', icon: 'none', duration: 3000 });
      }
    }, 26000);

    request('ai-chat', 'chat', params).then(res => {
      clearTimeout(timeoutId);
      // AI-33: 已超时或已有更新请求时丢弃迟到结果
      if (seq !== this._aiSeq) return;
      this.setData({ loading: false });
      if (res.result && res.result.success) {
        const d = res.result.data || {};
        const raw = {
          _id: d.assistantMessageId || ('ai_' + Date.now()),
          role: 'assistant',
          content: d.content || d.reply || '',
          actionStatus: d.actionStatus || '',
          created_at: null
        };
        const aiMsg = this._parseMessage(raw);
        aiMsg.timeStr = '刚刚';
        this._appendMessage(aiMsg);
        this._historyDirty = true;
        this.scrollToBottom();
      } else {
        // 显示错误信息，但不阻断对话
        const errorMsg = res.result?.message || '发送失败';
        wx.showToast({ title: errorMsg, icon: 'none', duration: 3000 });
        // 添加错误提示消息
        const errMsg = {
          _id: 'err_' + Date.now(),
          role: 'assistant',
          content: '抱歉，AI暂时无法响应：' + errorMsg,
          displayContent: '抱歉，AI暂时无法响应：' + errorMsg,
          hasAction: false,
          hasSelect: false,
          actionStatus: '',
          timeStr: '刚刚'
        };
        this._appendMessage(errMsg);
      }
    }).catch(err => {
      clearTimeout(timeoutId);
      // AI-33: 丢弃迟到的错误结果
      if (seq !== this._aiSeq) return;
      this.setData({ loading: false });
      console.error('ai-chat 云函数调用失败:', err);
      wx.showToast({ title: '网络错误，请检查网络后重试', icon: 'none', duration: 3000 });
      // 添加网络错误提示消息
      const errMsg = {
        _id: 'err_' + Date.now(),
        role: 'assistant',
        content: '网络连接失败，请检查网络后重试。',
        displayContent: '网络连接失败，请检查网络后重试。',
        hasAction: false,
        hasSelect: false,
        actionStatus: '',
        timeStr: '刚刚'
      };
      this._appendMessage(errMsg);
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
    const newMsg = { ...msg, actionStatus: 'executing' };
    this._updateMessageAt(idx, newMsg);
    this._persistActionStatus(newMsg, 'executing');

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

    const newMsg = { ...msg, actionStatus: 'cancelled' };
    this._updateMessageAt(idx, newMsg);
    this.setData({ loading: true });
    this._persistActionStatus(newMsg, 'cancelled');

    // AI-33: 使旧请求失效；AI-20: 带上 activityId
    this._aiSeq++;
    const params = (msg.actionData && msg.actionData.params) || {};
    const hist1 = this.data.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content && !String(m._id).startsWith('tmp_')).slice(-20).map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
    this._callAI({
      message: '[系统通知] 用户取消了操作：' + (msg.actionData.confirm_text || msg.actionData.action),
      activityId: params.activityId || '',
      history: hist1
    });
  },

  // ======================================================
  // 用户点击【选择活动】
  // ======================================================
  onSelectActivity: function(e) {
    const activity = e.currentTarget.dataset.activity;
    if (!activity) return;

    // 发送选择的消息给AI，触发报名流程
    const selectText = '我选择报名「' + activity.name + '」';
    this.setData({ loading: true });

    // 添加用户消息到列表
    const userMsg = {
      _id: 'tmp_' + Date.now(),
      role: 'user',
      content: selectText,
      displayContent: selectText,
      hasAction: false,
      hasSelect: false,
      actionStatus: '',
      timeStr: '刚刚'
    };
    this._appendMessage(userMsg);
    this.scrollToBottom();

    // 调用AI，让AI生成操作块
    const hist2 = this.data.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content && !String(m._id).startsWith('tmp_')).slice(-20).map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
    this._callAI({ message: selectText, history: hist2 });
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

    request('create-activity', 'create', {
      name: params.name,
      time: timeMs,
      location: params.location,
      type: params.type || 'doubles',
      province: '',
      city: '',
      district: ''
    }).then(res => {
      if (res.result && res.result.success) {
        const newActId = (res.result.data && res.result.data.activityId) || '';
        this._finishAction(idx, true, '活动「' + params.name + '」创建成功！活动ID：' + newActId, newActId);
      } else {
        this._finishAction(idx, false, '创建活动失败：' + (res.result?.message || '未知错误'), '');
      }
    }).catch(err => {
      this._finishAction(idx, false, '创建活动失败：' + (err.errMsg || '网络错误'), '');
    });
  },

  // ======================================================
  // 执行：参加活动（需先获取用户信息）
  // ======================================================
  _doJoinActivity: function(idx, params) {
    // 校验 activityId 格式（如果提供了 activityId）
    const aid = params.activityId || '';
    if (aid && /[\u4e00-\u9fff\s]/.test(aid)) {
      this._finishAction(idx, false, '操作失败：activityId 格式错误，请让 AI 使用正确的活动ID（纯字母数字，如 a1b2c3）');
      return;
    }
    if (!aid && !params.activityName) {
      this._finishAction(idx, false, '操作失败：缺少活动ID和活动名称');
      return;
    }
    // 参加活动需要用户的昵称、等级、头像
    // 从 globalData 或数据库获取用户信息
    const userInfo = app.globalData && app.globalData.userInfo;
    if (!userInfo || !userInfo.nickname) {
      this._finishAction(idx, false, '参加活动失败：请先在「首页」完善个人信息（昵称/等级）');
      return;
    }

    request('join-activity', 'join', {
      activityId: params.activityId || '',
      activityName: params.activityName || '',
      nickname: userInfo.nickname,
      level: userInfo.level || constants.DEFAULT_LEVEL,
      avatar: userInfo.avatar || ('avatar_' + (userInfo.nickname || '?').charAt(0))
    }).then(res => {
      if (res.result && res.result.success) {
        // BUG-49: 回显云函数返回文案（已区分候补/正式）；isWaiting 仅决定缺省文案
        const isWaiting = !!(res.result.data && res.result.data.isWaiting);
        const msg = res.result.message || (isWaiting ? '已加入候补名单' : '已成功报名参加活动「' + params.activityName + '」！');
        this._finishAction(idx, true, msg, params.activityId);
      } else {
        this._finishAction(idx, false, '报名失败：' + (res.result?.message || '未知错误'), params.activityId);
      }
    }).catch(err => {
      this._finishAction(idx, false, '报名失败：' + (err.errMsg || '网络错误'), params.activityId);
    });
  },

  // ======================================================
  // 执行：取消报名
  // ======================================================
  _doCancelRegistration: function(idx, params) {
    // 校验 activityId 格式（如果提供了 activityId）
    const aid = params.activityId || '';
    if (aid && /[\u4e00-\u9fff\s]/.test(aid)) {
      this._finishAction(idx, false, '操作失败：activityId 格式错误，请让 AI 使用正确的活动ID（纯字母数字，如 a1b2c3）');
      return;
    }
    if (!aid && !params.activityName) {
      this._finishAction(idx, false, '操作失败：缺少活动ID和活动名称');
      return;
    }
    request('cancel-registration', 'cancel', {
      activityId: params.activityId || '',
      activityName: params.activityName || ''
    }).then(res => {
      if (res.result && res.result.success) {
        this._finishAction(idx, true, '已提交取消报名申请（活动：「' + params.activityName + '」），等待组织者审批。', params.activityId);
      } else {
        this._finishAction(idx, false, '取消报名失败：' + (res.result?.message || '未知错误'), params.activityId);
      }
    }).catch(err => {
      this._finishAction(idx, false, '取消报名失败：' + (err.errMsg || '网络错误'), params.activityId);
    });
  },

  // ======================================================
  // 操作完成：更新状态 + 反馈给 AI
  // ======================================================
  _finishAction: function(idx, success, resultText, activityId) {
    const finalStatus = success ? 'success' : 'error';
    const updated = {
      ...this.data.messages[idx],
      actionStatus: finalStatus,
      actionResultText: resultText
    };
    this._updateMessageAt(idx, updated);
    this.setData({ loading: true });
    this._persistActionStatus(updated, finalStatus, resultText);

    // AI-33: 使旧请求失效，防止超时后的迟到结果插入
    this._aiSeq++;
    // 把操作结果告知 AI，让 AI 继续回复；AI-20: 带上 activityId 供级联清理
    const hist3 = this.data.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content && !String(m._id).startsWith('tmp_')).slice(-20).map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
    this._callAI({ message: '[系统通知] 操作执行结果：' + resultText, activityId: activityId || '', history: hist3 });
  },

  // ======================================================
  // 滚动到底部（AI-11：固定 id，不带时间戳后缀）
  // ======================================================
  scrollToBottom: function() {
    this.setData({ scrollToView: '' });
    setTimeout(() => {
      this.setData({ scrollToView: 'msg-bottom' });
    }, 100);
  },

  // ======================================================
  // 格式化时间
  // ======================================================
  // ENG-04: 时间格式化统一到 utils/time.js
  formatTime: function(timeValue) {
    return timeUtil.formatClock(timeValue, '');
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
          request('ai-history', 'clear', {}).then(res => {
            if (res.result && res.result.success) {
              this.setData({ messages: [] });
              wx.showToast({ title: '已开始新对话', icon: 'success' });
            }
          });
        }
      }
    });
  },

  onShareAppMessage: function() {
    return {
      title: '羽毛球 AI 助手',
      path: '/pages/ai-chat/ai-chat'
    };
  },

  onShareTimeline: function() {
    return {
      title: '羽毛球 AI 助手'
    };
  }
});
