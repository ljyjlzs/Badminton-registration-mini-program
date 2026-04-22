// 比分滑动器组件
Component({
  properties: {
    value: {
      type: Number,
      value: 0
    },
    max: {
      type: Number,
      value: 30
    },
    disabled: {
      type: Boolean,
      value: false
    }
  },

  data: {
    sliderValue: 0,
    quickScores: [0, 11, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]
  },

  lifetimes: {
    attached: function() {
      this.setData({
        sliderValue: this.properties.value
      });
    }
  },

  methods: {
    onSliderChange: function(e) {
      const value = parseInt(e.detail.value);
      this.setData({
        sliderValue: value
      });
      this.triggerEvent('change', { value });
    },

    onQuickSelect: function(e) {
      if (this.properties.disabled) return;
      
      const value = e.currentTarget.dataset.value;
      this.setData({
        sliderValue: value
      });
      this.triggerEvent('change', { value });
    },

    onInput: function(e) {
      if (this.properties.disabled) return;
      
      let value = parseInt(e.detail.value) || 0;
      value = Math.max(0, Math.min(this.properties.max, value));
      this.setData({
        sliderValue: value
      });
      this.triggerEvent('change', { value });
    }
  }
});
