/**
 * 工具函数
 */

/**
 * 格式化时间戳
 */
function formatTime(timestamp, format = 'YYYY-MM-DD HH:mm') {
  if (!timestamp) return '';
  
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hour)
    .replace('mm', minute);
}

/**
 * 格式化日期
 */
function formatDate(timestamp) {
  if (!timestamp) return '';
  
  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  
  return `${month}月${day}日 ${hour}:${String(minute).padStart(2, '0')}`;
}

/**
 * 显示加载提示
 */
function showLoading(title = '加载中') {
  wx.showLoading({
    title: title,
    mask: true
  });
}

/**
 * 隐藏加载提示
 */
function hideLoading() {
  wx.hideLoading();
}

/**
 * 显示成功提示
 */
function showSuccess(title = '成功') {
  wx.showToast({
    title: title,
    icon: 'success'
  });
}

/**
 * 显示错误提示
 */
function showError(title = '出错了') {
  wx.showToast({
    title: title,
    icon: 'none'
  });
}

/**
 * 确认对话框
 */
function showConfirm(title, content) {
  return new Promise((resolve) => {
    wx.showModal({
      title: title,
      content: content,
      success: res => {
        resolve(res.confirm);
      }
    });
  });
}

module.exports = {
  formatTime,
  formatDate,
  showLoading,
  hideLoading,
  showSuccess,
  showError,
  showConfirm
};
