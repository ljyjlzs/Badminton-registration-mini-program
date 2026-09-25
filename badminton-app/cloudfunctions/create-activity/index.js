/**
 * create-activity 云函数 - 创建活动
 * 对齐 Java ActivityServiceImpl.createActivity
 * 入参（payload）：{ name, time, location, type, province, city, district, latitude?, longitude?, maxPlayers?, playersPerCourt? }
 * 出参：{ activityId, joinCode }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const https = require('https');
const { rateLimit } = require('./rateLimit.js');
const { requireStr, LIMITS } = require('./validate.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) {
    logger.error('create-activity', (typeof action !== 'undefined' ? action : '-'), { err: e }); reject(e); } });
    }).on('error', e => reject(e));
  });
}

// 经纬度逆地理编码，反查省/市/区（高德 regeo，location 顺序为 经度,纬度）
async function reverseGeocode(lat, lng, key) {
  const url = `https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${key}&extensions=base&radius=1000&coordsys=gps`;
  const json = await getJson(url);
  if (json.status !== '1' || !json.regeocode || !json.regeocode.addressComponent) {
    throw new Error(json.info || '逆地理编码失败');
  }
  const ac = json.regeocode.addressComponent;
  return {
    province: ac.province || '',
    city: ac.city || '',
    district: ac.district || ''
  };
}

// 校验文本安全（name 必检；desc 等由调用方保证传入时再检）
async function secCheck(content) {
  if (!content) return;
  try {
    // 官方 openapi 代理路径（cloud.security.msgSecCheck 不存在，会抛 TypeError）
    await cloud.openapi.security.msgSecCheck({ content });
  } catch (e) {
    logger.error('create-activity', (typeof action !== 'undefined' ? action : '-'), { err: e });
    const code = e && e.errCode;
    if (code === 87014) {
      throw new Error('内容包含敏感信息，请修改后重试');
    }
    // 非内容风险类错误（如环境未配置）不阻断主流程
  }
}

exports.main = async (event, context) => {
  const { action = 'create', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  // COST-07: 限流 20 次/分钟
  const rl = rateLimit(openid, { limit: 20, windowMs: 60 * 1000 });
  if (!rl.ok) return { success: false, message: '操作太频繁，请稍后再试' };

  try {
    if (action === 'create') {
      return await doCreate(payload, openid);
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('create-activity', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '创建活动失败' };
  }
};

async function doCreate(payload, openid) {
  const {
    name, time, location, type,
    latitude, longitude, maxPlayers, playersPerCourt
  } = payload;
  let { province, city, district } = payload;

  // SEC-06: 活动名校验（非空 + 长度上限）
  const nameCheck = requireStr(name, '活动名称', LIMITS.NAME);
  if (!nameCheck.ok) return { success: false, message: nameCheck.message };
  if (!location || !location.trim()) return { success: false, message: '活动地点不能为空' };

  // 省市区：客户端必须通过 region picker 传入（AI 来源可为空）
  if (!province) province = '';
  if (!city) city = '';
  if (!district) district = '';

  await secCheck(nameCheck.value);

  // 时间校验：格式 yyyy-MM-dd HH:mm:ss，必须晚于当前
  const t = new Date(time);
  if (isNaN(t.getTime())) return { success: false, message: '时间格式应为 yyyy-MM-dd HH:mm:ss' };
  if (t.getTime() <= Date.now()) return { success: false, message: '活动时间必须是未来的时间' };

  let activityType = type || 'doubles';
  if (!['singles', 'doubles', 'fixed-doubles', 'court-doubles'].includes(activityType)) {
    activityType = 'doubles';
  }
  const minPlayers = activityType === 'singles' ? 3 : 4;

  let maxP = maxPlayers;
  let playersPerCourtVal = null;
  let courtCount = null;

  if (activityType === 'court-doubles') {
    let m = playersPerCourt != null ? Number(playersPerCourt) : 4;
    if (isNaN(m) || m < 4) return { success: false, message: '按场地双打的每场人数至少 4 人' };
    playersPerCourtVal = m;
    courtCount = 1;
    maxP = m; // court-doubles 时 maxPlayers = playersPerCourt
  } else {
    maxP = maxPlayers != null ? Number(maxPlayers) : 8;
    if (isNaN(maxP)) maxP = 8;
    if (maxP < minPlayers) return { success: false, message: '报名人数上限不能低于 ' + minPlayers + ' 人' };
    if (maxP > 100) return { success: false, message: '报名人数上限不能超过 100 人' };
  }

  const joinCode = (Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3)).toUpperCase();
  const activity = {
    name: nameCheck.value,
    time: time,
    location: location.trim(),
    type: activityType,
    province: province,
    city: city,
    district: district,
    latitude: latitude != null ? Number(latitude) : null,
    longitude: longitude != null ? Number(longitude) : null,
    organizerId: openid,
    status: 'registering',
    minPlayers: minPlayers,
    maxPlayers: maxP,
    currentPlayers: 0,
    joinCode: joinCode,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };
  if (activityType === 'court-doubles') {
    activity.playersPerCourt = playersPerCourtVal;
    activity.courtCount = courtCount;
  }

  const res = await db.collection('activities').add({ data: activity });
  const activityId = res._id;

  // court-doubles：自动建 1 个场地（场地A）
  if (activityType === 'court-doubles') {
    await db.collection('activity_courts').add({
      data: {
        activityId: activityId,
        courtNo: 1,
        label: '场地A',
        capacity: playersPerCourtVal,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
  }

  return { success: true, data: { activityId: activityId, joinCode: joinCode }, message: '创建成功' };
}
