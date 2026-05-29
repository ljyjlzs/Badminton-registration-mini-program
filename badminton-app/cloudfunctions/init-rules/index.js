// init-rules 云函数 - 初始化比赛规则数据
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const rulesData = {
  type: 'rules',
  title: '比赛规则',
  sections: [
    {
      id: 'singles',
      name: '单打',
      icon: '🏸',
      match_rules: [
        '每场比赛采用21分制',
        '先得21分者获胜',
        '每人单独对阵，无搭档',
        '比分需要双方确认后生效',
        '比赛采用单循环赛制'
      ],
      scoring_rules: [
        '胜者积分 = 自己的分数 - 对手的分数',
        '败者积分 = 自己的分数 - 对手的分数（负数）',
        '示例：比分21-15，胜者得+6分，败者得-6分',
        '示例：比分21-19，胜者得+2分，败者得-2分'
      ],
      common_rules: [
        '所有小组赛结束后，积分最高的选手进入挑战赛',
        '挑战赛胜者+10分，败者-10分'
      ]
    },
    {
      id: 'doubles',
      name: '双打轮换',
      icon: '🏸',
      match_rules: [
        '每场比赛采用21分制',
        '系统自动均衡分组：高等级+低等级配对',
        '每场比赛4人（2支队伍，每队2人）',
        '比分需要双方确认后生效',
        '搭档由系统随机分配，每轮可能不同'
      ],
      scoring_rules: [
        '个人积分 = 自己的分数 - 对手的分数',
        '队伍积分 = 队伍成员积分总和',
        '示例：队伍A以21-15获胜，每人得+6分',
        '示例：队伍B以15-21落败，每人得-6分'
      ],
      common_rules: [
        '分组算法：按等级排序，最高+最低配对',
        '所有小组赛结束后，积分最高的2人进入挑战赛',
        '挑战赛胜者+10分，败者-10分'
      ]
    },
    {
      id: 'fixed-doubles',
      name: '双打固搭',
      icon: '🤝',
      match_rules: [
        '每场比赛采用21分制',
        '报名时自选搭档，全程固定搭配',
        '每场比赛4人（2支队伍，每队2人）',
        '比分需要双方确认后生效',
        '搭档关系在整个活动中不变'
      ],
      scoring_rules: [
        '个人积分 = 自己的分数 - 对手的分数',
        '队伍积分 = 队伍成员积分总和',
        '示例：队伍A以21-15获胜，每人得+6分',
        '示例：队伍B以15-21落败，每人得-6分'
      ],
      common_rules: [
        '报名时需选择搭档，搭档需已报名',
        '所有小组赛结束后，积分最高的2人进入挑战赛',
        '挑战赛胜者+10分，败者-10分'
      ]
    }
  ],
  updated_at: new Date()
};

exports.main = async (event, context) => {
  try {
    // 检查是否已存在规则数据
    const existing = await db.collection('announcements')
      .where({ type: 'rules' })
      .limit(1)
      .get();

    if (existing.data && existing.data.length > 0) {
      // 更新现有数据
      await db.collection('announcements').doc(existing.data[0]._id).update({
        data: {
          sections: rulesData.sections,
          updated_at: db.serverDate()
        }
      });
      return {
        success: true,
        message: '规则数据已更新'
      };
    } else {
      // 创建新数据
      await db.collection('announcements').add({
        data: rulesData
      });
      return {
        success: true,
        message: '规则数据已初始化'
      };
    }
  } catch (err) {
    console.error('初始化规则失败:', err);
    return {
      success: false,
      error: err.message || '初始化规则失败'
    };
  }
};
