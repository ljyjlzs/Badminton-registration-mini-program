const LIMITS = { NAME: 40, TEXT: 500, COMMENT: 200, NICKNAME: 20 };
function requireStr(v, name, max) {
  if (v == null || v === '') return { ok: false, message: name + '不能为空' };
  if (typeof v !== 'string') return { ok: false, message: name + '格式错误' };
  if (v.length > (max || LIMITS.TEXT)) return { ok: false, message: name + '过长' };
  return { ok: true, value: v.trim() };
}
function requireArr(v, name, maxLen) {
  if (!Array.isArray(v)) return { ok: false, message: name + '格式错误' };
  if (v.length > (maxLen || 50)) return { ok: false, message: name + '数量过多' };
  return { ok: true, value: v };
}
// ARCH-04: 场地标签统一实现，避免三处内联漂移
function courtLabel(n) {
  if (n <= 26) return '场地' + String.fromCharCode(64 + n);
  return '场地' + n;
}
module.exports = { LIMITS, requireStr, requireArr, courtLabel };
