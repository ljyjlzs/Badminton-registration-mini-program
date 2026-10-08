// ENG-11: 活动名称上限与 ACTIVITY_LIMITS 同源，避免双处漂移
const { ACTIVITY_LIMITS } = require('./constants.js');
const LIMITS = { NAME: ACTIVITY_LIMITS.NAME, TEXT: 500, COMMENT: 200, NICKNAME: 20 };
// SEC-06: 数组入参统一长度上限
const MAX_ARR_LEN = 100;
function requireStr(v, name, max) {
  if (v == null || v === '') return { ok: false, message: name + '不能为空' };
  if (typeof v !== 'string') return { ok: false, message: name + '格式错误' };
  if (v.length > (max || LIMITS.TEXT)) return { ok: false, message: name + '过长' };
  return { ok: true, value: v.trim() };
}
function requireArr(v, name, maxLen) {
  if (!Array.isArray(v)) return { ok: false, message: name + '格式错误' };
  if (v.length > (maxLen || MAX_ARR_LEN)) return { ok: false, message: name + '数量过多' };
  return { ok: true, value: v };
}
function requireNum(v, name, min, max) {
  if (v == null || v === '') return { ok: false, message: name + '不能为空' };
  var n = Number(v);
  if (isNaN(n)) return { ok: false, message: name + '格式错误' };
  if (min != null && n < min) return { ok: false, message: name + '不能小于' + min };
  if (max != null && n > max) return { ok: false, message: name + '不能大于' + max };
  return { ok: true, value: n };
}
// ARCH-04: 场地标签统一实现，避免三处内联漂移
function courtLabel(n) {
  if (n <= 26) return '场地' + String.fromCharCode(64 + n);
  return '场地' + n;
}
module.exports = { LIMITS, MAX_ARR_LEN, requireStr, requireArr, requireNum, courtLabel };
