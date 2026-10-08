/**
 * gen-fn-doc.js — 生成云函数清单文档（ENG-06）
 *
 * Usage: node scripts/gen-fn-doc.js
 *
 * 读取根 cloudbaserc.json 的 functions 列表，生成 docs/云函数清单.md
 * （函数名 / 描述 / 入口）。描述提取自 cloudfunctions/<name>/index.js
 * 头注释「<name> 云函数 - ...」；缺失时回退为「—」。
 * 重新生成请再次运行本脚本，不要手改输出文件。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'cloudbaserc.json');
const OUTPUT_PATH = path.join(ROOT, 'docs', '云函数清单.md');

/**
 * 从云函数 index.js 头注释提取描述。
 * 形如： * ai-chat 云函数 - 小羽对话助手
 * @param {string} name 函数名
 * @param {string} fnRoot cloudbaserc.json 的 functionRoot
 * @returns {{desc: string, deprecated: boolean}}
 */
function extractDescription(name, fnRoot) {
  const indexPath = path.join(ROOT, fnRoot, name, 'index.js');
  if (!fs.existsSync(indexPath)) {
    return { desc: '—', deprecated: false };
  }
  const head = fs.readFileSync(indexPath, 'utf8').split('\n').slice(0, 30);
  let desc = '';
  let deprecated = false;
  for (const rawLine of head) {
    const line = rawLine.replace(/\r/g, ''); // 兼容 CRLF
    if (/@deprecated/i.test(line)) deprecated = true;
    const isComment = /^\s*(\/\*|\*)/.test(line);
    if (!isComment) break; // 头注释块结束，停止扫描
    const m = line.match(/云函数\s*[-–—:：]\s*(.+?)\s*$/);
    if (m && !desc) {
      desc = m[1].replace(/\*\/\s*$/, '').trim();
    }
    if (desc && deprecated) break;
  }
  return { desc: desc || '—', deprecated };
}

function buildMarkdown(rows, total) {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const lines = [
    '# 云函数清单',
    '',
    '> 本文件由 `scripts/gen-fn-doc.js` 自动生成，请勿手动修改。',
    '> 重新生成：`node scripts/gen-fn-doc.js`',
    `> 来源：根 cloudbaserc.json · 生成日期：${generatedAt} · 共 ${total} 个函数`,
    '',
    '| 函数名 | 描述 | 入口 |',
    '|--------|------|------|'
  ];
  for (const r of rows) {
    const desc = r.deprecated ? `${r.desc}（已废弃）` : r.desc;
    lines.push(`| \`${r.name}\` | ${desc} | \`${r.entry}\` |`);
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('[gen-fn-doc] 缺少 cloudbaserc.json:', CONFIG_PATH);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const fnRoot = config.functionRoot || 'cloudfunctions';
  const functions = Array.isArray(config.functions) ? config.functions : [];
  if (functions.length === 0) {
    console.error('[gen-fn-doc] cloudbaserc.json 中没有 functions 列表');
    process.exit(1);
  }

  const rows = functions
    .map((fn) => {
      const { desc, deprecated } = extractDescription(fn.name, fnRoot);
      return { name: fn.name, desc, deprecated, entry: fn.handler || 'index.main' };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const md = buildMarkdown(rows, rows.length);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, md, 'utf8');
  console.log(`[gen-fn-doc] 已生成 ${OUTPUT_PATH}（${rows.length} 个函数）`);
}

main();
