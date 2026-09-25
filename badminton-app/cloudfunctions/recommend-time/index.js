/**
 * recommend-time 云函数 - 开赛时间推荐（历史满员率驱动）
 * 对齐 ActivityRecommendServiceImpl（05.6）
 * payload: { activityId?, type?, location? }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const { rateLimit } = require('./rateLimit.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const SLOTS = ['08-10', '10-12', '14-16', '16-18', '18-20', '20-22'];
function slotOf(hour) {
  if (hour >= 8 && hour < 10) return '08-10';
  if (hour >= 10 && hour < 12) return '10-12';
  if (hour >= 14 && hour < 16) return '14-16';
  if (hour >= 16 && hour < 18) return '16-18';
  if (hour >= 18 && hour < 20) return '18-20';
  if (hour >= 20 && hour < 22) return '20-22';
  return null;
}
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

exports.main = async (event, context) => {
  const { action = 'recommend', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  // COST-07: 限流 20 次/分钟
  const rl = rateLimit(openid, { limit: 20, windowMs: 60 * 1000 });
  if (!rl.ok) return { success: false, message: '操作太频繁，请稍后再试' };
  try {
    if (action !== 'recommend' && action !== 'suggest') return { success: false, message: '未知 action: ' + action };
    const { type, location } = payload;

    let history = await db.collection('activities').where({ organizerId: openid, status: 'finished' }).get();
    let list = history.data || [];
    if (list.length < 3) {
      const all = await db.collection('activities').where({ organizerId: openid }).get();
      list = all.data || [];
    }
    if (type && type !== 'all') list = list.filter(a => a.type === type);
    if (location && location !== 'all') list = list.filter(a => a.location === location);

    const agg = {};
    list.forEach(a => {
      const d = new Date(a.time);
      const slot = slotOf(d.getHours());
      if (!slot) return;
      const wd = d.getDay();
      const denom = a.maxPlayers > 0 ? a.maxPlayers : 4;
      const rate = Math.min((a.currentPlayers || 0) / denom, 1.0);
      const key = wd + '_' + slot;
      if (!agg[key]) agg[key] = { weekday: wd, slot, rates: [], n: 0 };
      agg[key].rates.push(rate); agg[key].n++;
    });

    const arr = Object.values(agg).map(g => {
      const avgRate = g.rates.reduce((a, b) => a + b, 0) / g.rates.length;
      const score = avgRate * 0.7 + Math.min(g.n / 5, 1) * 0.3;
      return { weekday: g.weekday, weekdayText: WEEKDAYS[g.weekday], slot: g.slot, avgRate, n: g.n, score, reliable: g.n >= 3 };
    });
    arr.sort((a, b) => (b.reliable - a.reliable) || (b.avgRate - a.avgRate) || (b.n - a.n) || (a.weekday - b.weekday));

    const top3 = arr.slice(0, 3);
    let suggestedTime = null;
    if (top3.length > 0) {
      const best = top3[0];
      const now = new Date();
      let target = new Date(now);
      target.setDate(now.getDate() + ((best.weekday - now.getDay() + 7) % 7));
      // AI-27: 先落到当天目标时刻，再比较是否已过；同星期不再恒跳到下周
      target.setHours(Number(best.slot.split('-')[0].slice(0, 2)), 0, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 7);
      suggestedTime = target.getFullYear() + '-' + String(target.getMonth() + 1).padStart(2, '0') + '-' + String(target.getDate()).padStart(2, '0') + ' ' + best.slot.split('-')[0] + ':00';
    }

    let aiNote = null;
    if (top3.length > 0 && typeof top3[0].avgRate === 'number' && isFinite(top3[0].avgRate) && typeof top3[0].n === 'number') {
      const pct = Math.round(top3[0].avgRate * 100);
      aiNote = top3[0].weekdayText + ' ' + top3[0].slot + ' 近' + top3[0].n + '场平均满员率' + pct + '%'
        + (top3.length > 1 ? '；次选 ' + top3.slice(1).map(t => t.weekdayText + ' ' + t.slot).join('、') : '')
        + '，建议优先开这一档。';
    }

    return {
      success: true,
      data: {
        recommendations: top3,
        suggestedTime,
        aiNote,
        reliable: top3.length > 0 && top3[0].reliable,
        fallbackTip: top3.length === 0 ? '历史数据不足，先凭经验建一场' : null
      },
      message: 'ok'
    };
  } catch (err) {
    logger.error('recommend-time', (typeof action !== 'undefined' ? action : '-'), { err: err });
    // AI-27: 真实错误返回 success:false，只有业务性无历史才回 fallbackTip
    console.error('recommend-time 失败:', err && err.message);
    if (err && err.message && err.message.indexOf('无历史') >= 0) {
      return {
        success: true,
        data: { recommendations: [], suggestedTime: null, aiNote: null, reliable: false, fallbackTip: '历史数据不足，先凭经验建一场' },
        message: 'ok'
      };
    }
    return { success: false, message: err.message || '推荐失败' };
  }
};
