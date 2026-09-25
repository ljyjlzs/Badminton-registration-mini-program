// 简单时间窗限流（内存级，云函数实例内有效；多实例下近似）
const buckets = {};
function rateLimit(openid, opts) {
  opts = opts || {};
  const limit = opts.limit || 10;
  const windowMs = opts.windowMs || 60 * 1000;
  const key = openid || 'anon';
  const now = Date.now();
  if (!buckets[key] || now - buckets[key].start > windowMs) {
    buckets[key] = { start: now, count: 0 };
  }
  buckets[key].count++;
  return { ok: buckets[key].count <= limit, remaining: Math.max(0, limit - buckets[key].count) };
}
module.exports = { rateLimit };
