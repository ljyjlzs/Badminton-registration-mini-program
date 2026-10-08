/**
 * 时间解析与格式化（ENG-04）
 * 统一 activity-detail / activity-list / ai-chat 三处重复的时间解析逻辑。
 * parseTime   —— 兼容 number / ISO 字符串 / 数字字符串 / 'YYYY-MM-DD HH:mm:ss' / {$date} 对象
 * formatTime  —— 日历格式「M月D日 H:mm」，空值占位默认 '待定'（活动页）
 * formatClock —— 时钟格式「H:mm」，空值占位默认 ''（聊天消息气泡）
 */

function parseTime(timeValue) {
  if (!timeValue && timeValue !== 0) return 0;

  var timestamp = timeValue;

  if (typeof timeValue === 'number') {
    timestamp = timeValue;
  } else if (typeof timeValue === 'string') {
    if (timeValue.indexOf('T') >= 0) {
      timestamp = new Date(timeValue).getTime();
    } else if (!isNaN(timeValue)) {
      timestamp = parseInt(timeValue, 10);
    } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timeValue)) {
      timestamp = new Date(timeValue.replace(/-/g, '/')).getTime();
    } else {
      return 0;
    }
  } else if (typeof timeValue === 'object') {
    if (timeValue.$date) {
      timestamp = timeValue.$date;
    } else {
      return 0;
    }
  }

  if (!timestamp || isNaN(timestamp)) return 0;

  var date = new Date(timestamp);
  if (isNaN(date.getTime())) return 0;
  return date.getTime();
}

/**
 * 日历格式：M月D日 H:mm
 * @param {*} timeValue
 * @param {string} [emptyText] 空值占位文案，默认 '待定'
 */
function formatTime(timeValue, emptyText) {
  var empty = emptyText === undefined || emptyText === null ? '待定' : emptyText;

  var timestamp = parseTime(timeValue);
  if (!timestamp) return empty;

  var date = new Date(timestamp);
  if (isNaN(date.getTime())) return empty;

  var month = date.getMonth() + 1;
  var day = date.getDate();
  var hour = date.getHours();
  var minute = date.getMinutes();
  return month + '月' + day + '日 ' + hour + ':' + (minute < 10 ? '0' + minute : minute);
}

/**
 * 时钟格式：H:mm（聊天消息时间戳使用）
 * @param {*} timeValue
 * @param {string} [emptyText] 空值占位文案，默认 ''
 */
function formatClock(timeValue, emptyText) {
  var empty = emptyText === undefined || emptyText === null ? '' : emptyText;

  var timestamp = parseTime(timeValue);
  if (!timestamp) return empty;

  var date = new Date(timestamp);
  if (isNaN(date.getTime())) return empty;

  var hour = date.getHours();
  var minute = String(date.getMinutes()).padStart(2, '0');
  return hour + ':' + minute;
}

module.exports = {
  parseTime: parseTime,
  formatTime: formatTime,
  formatClock: formatClock
};
