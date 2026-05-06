/**
 * clear-database 云函数 - 清空所有数据集合
 * 
 * ⚠️ 危险操作！此函数会删除所有数据，不可恢复！
 * 仅限测试环境使用，用完请立即删除此云函数！
 * 
 * 清空集合：users, activities, registrations, teams, matches, scores
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

// 批量删除集合中所有数据
async function clearCollection(collectionName) {
  let deletedTotal = 0;
  
  try {
    // 循环删除，每次最多删20条（云函数限制）
    while (true) {
      const result = await db.collection(collectionName).where({
        _id: _.exists(true)
      }).limit(20).get();
      
      if (!result.data || result.data.length === 0) {
        break;
      }
      
      // 并行删除这批数据
      const deletePromises = result.data.map(item => 
        db.collection(collectionName).doc(item._id).remove()
      );
      await Promise.all(deletePromises);
      
      deletedTotal += result.data.length;
      console.log(`${collectionName}: 已删除 ${deletedTotal} 条`);
      
      if (result.data.length < 20) {
        break;
      }
    }
    
    return { success: true, deleted: deletedTotal };
  } catch (err) {
    console.error(`清空 ${collectionName} 失败:`, err);
    return { success: false, error: err.message, deleted: deletedTotal };
  }
}

exports.main = async (event, context) => {
  // 安全确认码，防止误触发
  if (event.confirmCode !== 'CLEAR_ALL_DATA_CONFIRM') {
    return {
      success: false,
      error: '请提供确认码 confirmCode: "CLEAR_ALL_DATA_CONFIRM"'
    };
  }
  
  const collections = ['scores', 'matches', 'teams', 'registrations', 'activities', 'users'];
  const results = {};
  
  console.log('开始清空所有数据...');
  
  for (const collection of collections) {
    console.log(`正在清空 ${collection}...`);
    results[collection] = await clearCollection(collection);
  }
  
  const summary = Object.entries(results).map(([col, res]) => 
    `${col}: ${res.success ? `删除 ${res.deleted} 条` : `失败 - ${res.error}`}`
  ).join(', ');
  
  console.log('清空完成:', summary);
  
  return {
    success: true,
    message: '数据清空完成',
    details: results,
    summary
  };
};
