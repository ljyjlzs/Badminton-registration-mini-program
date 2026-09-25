/**
 * 同步 _shared/*.js 到各云函数目录（部署前必须运行）
 * 云函数打包目录不支持跨目录 require，必须把共享模块复制到函数目录内再部署。
 * 用法：node cloudfunctions/sync-shared.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SHARED = path.join(ROOT, '_shared');

function main() {
  if (!fs.existsSync(SHARED)) {
    console.error('未找到 _shared 目录:', SHARED);
    process.exit(1);
  }
  const files = fs.readdirSync(SHARED).filter(f => f.endsWith('.js') && !f.includes('snapshot.test'));
  const entries = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '_shared' && d.name !== 'node_modules' && d.name !== 'utils')
    .map(d => d.name);

  let copied = 0;
  for (const dir of entries) {
    const indexJs = path.join(ROOT, dir, 'index.js');
    if (!fs.existsSync(indexJs)) continue;
    for (const f of files) {
      const src = path.join(SHARED, f);
      const dest = path.join(ROOT, dir, f);
      fs.copyFileSync(src, dest);
      copied++;
    }
  }
  console.log('sync-shared: 复制 ' + files.length + ' 个共享模块到 ' + entries.length + ' 个云函数目录，共 ' + copied + ' 个文件');
  console.log('共享模块:', files.join(', '));
}

if (require.main === module) main();
module.exports = { main };
