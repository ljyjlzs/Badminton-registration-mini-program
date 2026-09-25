/**
 * 云函数权限策略注册表
 * policy:
 *   public     - 任何人可调（只读公开接口）
 *   auth       - 需要登录（有 openid）
 *   organizer  - 需要活动组织者
 *   member     - 需要活动成员或组织者
 *   admin      - 仅调试/管理用途，应限制或删除
 */
module.exports = {
  // 公开只读
  'weather': 'public',
  'get-rankings': 'public',
  'get-rules': 'public',
  // 需要登录
  'ai-chat': 'auth',
  'ai-history': 'auth',
  'login': 'auth',
  'get-user-stats': 'auth',
  'update-user-avatar': 'auth',
  'update-user-info': 'auth',
  'rules-qa': 'auth',
  'photo-like': 'auth',
  'photo-comments': 'auth',
  'voice-score-parse': 'auth',
  'get-fill-gap': 'auth',
  'init-rules': 'auth',
  'parse-activity': 'auth',
  'recommend-time': 'auth',
  'get-match-detail': 'auth',
  'album': 'auth',
  // 需要组织者
  'create-activity': 'organizer',
  'update-activity-status': 'organizer',
  'delete-activity': 'organizer',
  'update-registration-level': 'organizer',
  'handle-cancel-request': 'organizer',
  'start-grouping': 'organizer',
  'court-add': 'organizer',
  'court-delete': 'organizer',
  'court-config': 'organizer',
  'court-assign': 'organizer',
  'court-save-label': 'organizer',
  'court-start': 'organizer',
  'update-match-order': 'organizer',
  'generate-copy': 'organizer',
  'invite': 'organizer',
  'invite-candidates': 'organizer',
  'get-fill-suggestions': 'organizer',
  'match-reminders': 'organizer',
  'match-live-score': 'organizer',
  'voice-score-config': 'organizer',
  'photo-feature': 'organizer',
  'photo-ai-note': 'organizer',
  'get-activity-report': 'organizer',
  // 成员或组织者
  'join-activity': 'auth',
  'cancel-registration': 'auth',
  'submit-score': 'member',
  'court-submit-score': 'member',
  'court-matches': 'member',
  'court-list': 'member',
  'court-rank': 'member',
  'court-ready': 'member',
  'photo-upload': 'member',
  'get-activity-detail': 'member',
  'get-activities': 'auth',
  'unbind-partner': 'auth'
};
