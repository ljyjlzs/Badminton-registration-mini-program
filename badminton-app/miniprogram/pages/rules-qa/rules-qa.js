var callFunction = require('../../utils/request.js').callFunction;

Page({
  data: {
    messages: [],
    inputText: '',
    loading: false,
    loadError: false,
    scrollToId: '',
    lastQuestion: '',
    quickQuestions: [
      '单打和双打有什么区别？',
      '积分是怎么计算的？',
      '如何申请取消报名？',
      '候补是什么意思？',
      '固搭和轮转有什么区别？'
    ]
  },

  onInput: function(e) {
    this.setData({ inputText: e.detail.value });
  },

  askQuickQuestion: function(e) {
    var question = e.currentTarget.dataset.question;
    this.setData({ inputText: question });
    this.sendMessage();
  },

  _scrollToLast: function(messages) {
    var lastIndex = messages.length - 1;
    if (lastIndex < 0) return;
    this.setData({ scrollToId: 'msg-' + lastIndex });
  },

  sendMessage: function() {
    var text = this.data.inputText.trim();
    if (!text || this.data.loading) return;
    this._ask(text);
  },

  // AI-38: 失败气泡点击重试，用上次保存的问题重新发起提问
  retry: function(e) {
    if (this.data.loading) return;
    var question = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.question) || this.data.lastQuestion;
    if (!question) return;
    this._ask(question);
  },

  _ask: function(text) {
    var self = this;
    var messages = self.data.messages.concat([{ role: 'user', content: text }]);
    self.setData({ messages: messages, inputText: '', loading: true, loadError: false, lastQuestion: text });
    self._scrollToLast(messages);

    callFunction('rules-qa', 'ask', { question: text }).then(function(res) {
      var answer = '';
      var references = [];
      var isFallback = false;
      var isError = false;
      if (res && res.data && res.data.answer) {
        answer = res.data.answer;
        // AI-38: 保留 references 防幻觉引用，供出处展示
        references = res.data.references || [];
        // AI-38: 读取兜底标记（兼容 fallback 旧字段），供 wxml 显示兜底横幅
        isFallback = !!(res.data.isFallback || res.data.fallback);
      } else if (res && res.answer) {
        answer = res.answer;
        references = res.references || [];
        isFallback = !!(res.isFallback || res.fallback);
      } else {
        answer = '抱歉，暂时无法回答这个问题。';
        isError = true;
      }
      var newMessages = self.data.messages.concat([{ role: 'assistant', content: answer, references: references, isFallback: isFallback, isError: isError, question: text }]);
      self.setData({ messages: newMessages, loading: false });
      self._scrollToLast(newMessages);
    }).catch(function() {
      var newMessages = self.data.messages.concat([{ role: 'assistant', content: '抱歉，服务暂时不可用，请稍后再试。', references: [], isFallback: false, isError: true, question: text }]);
      // BUG-46: 提问失败置 loadError，展示可重试错误态
      self.setData({ messages: newMessages, loading: false, loadError: true });
      self._scrollToLast(newMessages);
    });
  },

  // BUG-46: 加载失败后用上次问题重新提问
  retryLoad: function() {
    if (this.data.loading) return;
    var question = this.data.lastQuestion;
    if (!question) return;
    this._ask(question);
  },

  onShareAppMessage: function() {
    return {
      title: '羽毛球规则问答',
      path: '/pages/rules-qa/rules-qa'
    };
  },

  onShareTimeline: function() {
    return {
      title: '羽毛球规则问答'
    };
  }
});
