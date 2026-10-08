#!/usr/bin/env node
/**
 * 照片点赞对账脚本（BUG-70）
 *
 * 对比 photos 集合的 likeCount（冗余计数）与 photo_likes 集合实际点赞记录数，
 * 输出不一致的照片列表；传 --fix 时按实际记录数回写 likeCount。
 *
 * 用法: node scripts/reconcile-likes.js [--fix] [--env <envId>] [--likes <collection>]
 *   --fix    发现不一致时自动回写 photos.likeCount（默认只读，不写库）
 *   --env    云开发环境 ID（默认取 TCB_ENV_ID 环境变量）
 *   --likes  点赞集合名（默认 photo_likes，兼容 likes）
 * 退出码: 全部一致（或已 --fix 修复）= 0；存在未修复的不一致 = 1
 */
'use strict';

const PAGE_SIZE = 100;

/** 解析命令行参数 */
function parseArgs(argv) {
  const args = { fix: false, env: process.env.TCB_ENV_ID || null, likesCollection: 'photo_likes' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fix') {
      args.fix = true;
    } else if (a === '--env') {
      args.env = argv[++i] || null;
    } else if (a === '--likes') {
      args.likesCollection = argv[++i] || 'photo_likes';
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      console.error('[reconcile] 未知参数: ' + a);
      process.exit(2);
    }
  }
  return args;
}

/**
 * 加载云开发 SDK。
 * 优先 wx-server-sdk（与云函数运行时一致）；本地未安装时回退 @cloudbase/node-sdk。
 * @returns {{ name: string, cloud: any } | null}
 */
function loadCloudSdk() {
  const candidates = ['wx-server-sdk', '@cloudbase/node-sdk'];
  for (const name of candidates) {
    try {
      return { name: name, cloud: require(name) };
    } catch (e) {
      // 继续尝试下一个
    }
  }
  return null;
}

/**
 * 分页拉取集合全部文档（云数据库单次 get 上限 100 条）。
 * @param {any} db
 * @param {string} collectionName
 * @returns {Promise<Array<object>>}
 */
async function fetchAll(db, collectionName) {
  const countRes = await db.collection(collectionName).count();
  const total = countRes.total;
  const docs = [];
  for (let skip = 0; skip < total; skip += PAGE_SIZE) {
    const res = await db.collection(collectionName).skip(skip).limit(PAGE_SIZE).get();
    docs.push.apply(docs, res.data);
  }
  return docs;
}

/**
 * 按 photoId 统计点赞记录数。
 * @param {Array<{ photoId?: string }>} likeDocs
 * @returns {Map<string, number>}
 */
function countLikesByPhoto(likeDocs) {
  const map = new Map();
  for (const doc of likeDocs) {
    if (!doc.photoId) continue;
    map.set(doc.photoId, (map.get(doc.photoId) || 0) + 1);
  }
  return map;
}

/**
 * 对比 likeCount 与实际点赞数，找出不一致的照片。
 * @param {Array<{ _id: string, likeCount?: number }>} photos
 * @param {Map<string, number>} likeCountMap
 * @returns {Array<{ photoId: string, stored: number, actual: number, diff: number }>}
 */
function diffLikeCounts(photos, likeCountMap) {
  const mismatches = [];
  for (const photo of photos) {
    const stored = typeof photo.likeCount === 'number' ? photo.likeCount : 0;
    const actual = likeCountMap.get(photo._id) || 0;
    if (stored !== actual) {
      mismatches.push({ photoId: photo._id, stored: stored, actual: actual, diff: actual - stored });
    }
  }
  return mismatches;
}

/**
 * --fix: 把不一致照片的 likeCount 回写为实际点赞数。
 * @param {any} db
 * @param {Array<{ photoId: string, actual: number }>} mismatches
 * @returns {Promise<number>} 实际修复条数
 */
async function fixLikeCounts(db, mismatches) {
  let fixed = 0;
  for (const m of mismatches) {
    try {
      await db.collection('photos').doc(m.photoId).update({ data: { likeCount: m.actual } });
      console.log('[reconcile] 已修复 ' + m.photoId + ': ' + m.stored + ' -> ' + m.actual);
      fixed++;
    } catch (e) {
      console.error('[reconcile] 修复失败 ' + m.photoId + ': ' + (e.message || e));
    }
  }
  return fixed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法: node scripts/reconcile-likes.js [--fix] [--env <envId>] [--likes <collection>]');
    return 0;
  }

  const sdk = loadCloudSdk();
  if (!sdk) {
    console.error('[reconcile] 未找到云开发 SDK，请先安装: npm i -D wx-server-sdk');
    console.error('[reconcile] （或 npm i -D @cloudbase/node-sdk 作为本地回退）');
    return 2;
  }

  const cloud = sdk.cloud;
  if (args.env) {
    cloud.init({ env: args.env });
  } else {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  }
  const db = cloud.database();

  console.log('[reconcile] SDK=' + sdk.name + ' env=' + (args.env || 'DYNAMIC_CURRENT_ENV') + ' likes=' + args.likesCollection);

  // 1/2. 读 photos 的 likeCount
  const photos = await fetchAll(db, 'photos');
  console.log('[reconcile] photos 共 ' + photos.length + ' 条');

  // 3. 统计点赞集合实际记录数
  const likeDocs = await fetchAll(db, args.likesCollection);
  const likeCountMap = countLikesByPhoto(likeDocs);
  console.log('[reconcile] ' + args.likesCollection + ' 共 ' + likeDocs.length + ' 条点赞记录');

  // 孤儿点赞：点赞记录指向不存在的照片（提示信息，不计入不一致列表）
  const photoIdSet = new Set(photos.map(function (p) { return p._id; }));
  let orphans = 0;
  likeCountMap.forEach(function (_count, photoId) {
    if (!photoIdSet.has(photoId)) orphans++;
  });
  if (orphans > 0) {
    console.warn('[reconcile] 警告: ' + orphans + ' 张照片的点赞记录找不到对应照片（孤儿点赞）');
  }

  // 4. 对比差异
  const mismatches = diffLikeCounts(photos, likeCountMap);
  if (mismatches.length === 0) {
    console.log('[reconcile] 全部一致，无需修复');
    return 0;
  }

  console.log('[reconcile] 发现 ' + mismatches.length + ' 条不一致:');
  console.log('photoId\tstored\tactual\tdiff');
  for (const m of mismatches) {
    console.log(m.photoId + '\t' + m.stored + '\t' + m.actual + '\t' + (m.diff > 0 ? '+' + m.diff : m.diff));
  }

  // 5. --fix 自动修正
  if (!args.fix) {
    console.log('[reconcile] 只读模式。加 --fix 自动回写 likeCount');
    return 1;
  }

  const fixed = await fixLikeCounts(db, mismatches);
  console.log('[reconcile] 修复完成: ' + fixed + '/' + mismatches.length + ' 条');
  return fixed === mismatches.length ? 0 : 1;
}

main()
  .then(function (code) {
    process.exit(code);
  })
  .catch(function (e) {
    console.error('[reconcile] 执行失败: ' + (e && e.message ? e.message : e));
    process.exit(2);
  });
