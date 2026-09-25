/**
 * 分享文案/路径拼装（UX-08）
 * 各页 onShareAppMessage / onShareTimeline 复用，避免 30+ 处手写 path。
 */
function makeShare(opts) {
  opts = opts || {};
  var title = String(opts.title || '羽毛球活动').slice(0, 32);
  var path = opts.path || '/pages/index/index';
  var query = opts.query || '';
  return {
    title: title,
    path: path + (query ? (path.indexOf('?') >= 0 ? '&' : '?') + query : ''),
    // 朋友圈：title + query（path 不生效）
    timeline: {
      title: title,
      query: query
    }
  };
}

function bindShare(page, getOpts) {
  page.onShareAppMessage = function() {
    var s = makeShare(typeof getOpts === 'function' ? getOpts.call(this) : getOpts);
    return { title: s.title, path: s.path };
  };
  page.onShareTimeline = function() {
    var s = makeShare(typeof getOpts === 'function' ? getOpts.call(this) : getOpts);
    return { title: s.title, query: s.timeline.query };
  };
  return page;
}

module.exports = {
  makeShare: makeShare,
  bindShare: bindShare
};
