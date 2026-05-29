// get-rules 云函数 - 获取比赛规则
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 默认规则数据
const defaultSections = [
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
      '挑战赛：胜者+10分，败者-10分',
      '挑战赛后进入决赛：胜者+15分，败者-15分'
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
      '挑战赛：胜者+10分，败者-10分',
      '挑战赛后进入决赛：胜者+15分，败者-15分'
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
      '挑战赛：胜者+10分，败者-10分',
      '挑战赛后进入决赛：胜者+15分，败者-15分'
    ]
  }
];

exports.main = async (event, context) => {
  try {
    const result = await db.collection('announcements')
      .where({ type: 'rules' })
      .limit(1)
      .get();

    if (result.data && result.data.length > 0 && result.data[0].sections) {
      return {
        success: true,
        data: result.data[0].sections
      };
    }

    // 没有数据时返回默认规则
    return {
      success: true,
      data: defaultSections
    };
  } catch (err) {
    console.error('获取规则失败:', err);
    // 出错时也返回默认规则
    return {
      success: true,
      data: defaultSections
    };
  }
};
