/**
 * 按星期 + 时段推算下一次具体开赛时间。
 * 对齐 recommend-time 云函数的 suggestedTime 算法（AI-27）：
 * 落到「下一个目标星期的时段起点」，若该时刻已过则顺延 7 天。
 */

/**
 * @param {number} weekday 0-6（0=周日），来自 recommend-time 出参 recommendations[].weekday
 * @param {string} slot 时段字符串，例如 "14-16"
 * @returns {string} "yyyy-MM-dd HH:mm"，入参不合法时返回 ''
 */
function nextSlotTime(weekday, slot) {
  if (weekday == null || !slot) return '';
  var hourStr = String(slot).split('-')[0];
  var hour = parseInt(hourStr, 10);
  if (isNaN(hour)) return '';
  var now = new Date();
  var target = new Date(now);
  target.setDate(now.getDate() + ((weekday - now.getDay() + 7) % 7));
  // AI-27: 先落到当天目标时刻，再比较是否已过；同星期不再恒跳到下周
  target.setHours(hour, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 7);
  return target.getFullYear() + '-' + String(target.getMonth() + 1).padStart(2, '0') + '-' + String(target.getDate()).padStart(2, '0') + ' ' + hourStr + ':00';
}

module.exports = {
  nextSlotTime: nextSlotTime
};
