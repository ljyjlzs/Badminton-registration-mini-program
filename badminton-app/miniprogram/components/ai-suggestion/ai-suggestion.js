Component({
  properties: {
    title: { type: String, value: 'AI 建议' },
    desc: { type: String, value: '' },
    suggestions: { type: Array, value: [] },
    editable: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    confirmText: { type: String, value: '确认' },
    cancelText: { type: String, value: '取消' }
  },
  methods: {
    onTapItem: function(e) {
      var index = e.currentTarget.dataset.index;
      this.triggerEvent('tap', { index: index, item: this.properties.suggestions[index] });
    },
    onConfirm: function() { this.triggerEvent('confirm'); },
    onCancel: function() { this.triggerEvent('cancel'); }
  }
});
