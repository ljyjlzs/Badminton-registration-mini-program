/**
 * Cloud function smoke script (ENG-07)
 * Usage: node scripts/smoke-fn.js
 * Optional: npm i -D @cloudbase/node-sdk and set TCB_ENV_ID for live calls.
 * Only invokes read-only actions. Envelope contract: { success, data, message }.
 */
const CASES = [
  { name: 'get-rules', action: 'list', payload: {} },
  { name: 'get-rankings', action: 'list', payload: {} },
  { name: 'weather', action: 'get', payload: { city: 'Hangzhou' } },
  { name: 'get-activities', action: 'list', payload: { type: 'available' } },
  { name: 'recommend-time', action: 'recommend', payload: {} }
];

function checkEnvelope(res) {
  if (!res || typeof res !== 'object') return 'not an object';
  if (typeof res.success !== 'boolean') return 'missing success bool';
  if (!('data' in res)) return 'missing data field';
  if (!('message' in res)) return 'missing message field';
  return null;
}

async function main() {
  let callFn;
  try {
    const CloudBase = require('@cloudbase/node-sdk');
    const app = CloudBase.init({ env: process.env.TCB_ENV_ID || 'cloud1-3guy8euw3babaf6d' });
    callFn = (name, payload) => app.callFunction({ name, data: payload }).then(function (r) { return r.result; });
  } catch (e) {
    console.log('[smoke] @cloudbase/node-sdk not installed. Static case list:');
    CASES.forEach(function (c) { console.log('  -', c.name, c.action); });
    console.log('[smoke] install then re-run: npm i -D @cloudbase/node-sdk && node scripts/smoke-fn.js');
    return;
  }

  let failed = 0;
  for (const c of CASES) {
    try {
      const res = await callFn(c.name, { action: c.action, payload: c.payload });
      const err = checkEnvelope(res);
      if (err) {
        console.error('FAIL', c.name, err, JSON.stringify(res).slice(0, 120));
        failed++;
      } else {
        console.log('OK  ', c.name, 'success=' + res.success);
      }
    } catch (e) {
      console.error('FAIL', c.name, e.message);
      failed++;
    }
  }
  console.log(failed ? '[smoke] ' + failed + ' failed' : '[smoke] all ok');
  process.exit(failed ? 1 : 0);
}

main();
