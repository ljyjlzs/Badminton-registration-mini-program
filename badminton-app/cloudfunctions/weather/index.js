/**
 * weather 云函数 - 天气查询（07.3，高德）
 * payload: { city(城市名或 adcode), date?(YYYY-MM-DD, 默认今天) }
 * 依赖 AMAP_KEY；未配置返回提示
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) {
    logger.error('weather', (typeof action !== 'undefined' ? action : '-'), { err: e }); reject(e); } });
    }).on('error', e => reject(e));
  });
}

exports.main = async (event) => {
  const { payload = {} } = event;
  const { city, date } = payload;
  if (!city) return { success: false, message: 'city 不能为空' };
  const key = process.env.AMAP_KEY;
  if (!key) return { success: false, message: '天气服务未配置', data: null };
  try {
    // COST-12: extensions=base 只取实况，不拉 24h/7d 预报，降低高德 API 成本
    const ext = 'base';
    const url = `https://restapi.amap.com/v3/weather/weatherInfo?city=${encodeURIComponent(city)}&key=${key}&extensions=${ext}`;
    const json = await getJson(url);
    if (json.status !== '1') return { success: false, message: json.info || '天气查询失败' };
    // base 返回 lives[]（实况），不再有 forecasts/casts；date 参数已无预报可选，仅作兼容透传
    const live = json.lives && json.lives[0] ? json.lives[0] : null;
    if (!live) return { success: false, message: '天气查询失败' };
    const result = {
      city: live.city || city,
      province: live.province || '',
      date: (live.reporttime || '').slice(0, 10) || date || '',
      dayweather: live.weather, nightweather: live.weather,
      daytemp: live.temperature, nighttemp: live.temperature,
      daywind: live.winddirection, daypower: live.windpower,
      text: `${live.weather}，${live.temperature}℃，风力${live.windpower}级`
    };
    return { success: true, data: { weather: result }, message: 'ok' };
  } catch (err) {
    logger.error('weather', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '天气查询失败' };
  }
};
