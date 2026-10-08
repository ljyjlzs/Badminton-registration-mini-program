const cloud = require('wx-server-sdk');
const logger = require('./logger');
const { requireArr } = require('./validate.js');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
var db = cloud.database();
var _ = db.command;

exports.main = async function(event, context) {
  var action = event.action || 'detail';
  var payload = event.payload || {};
  var wxContext = cloud.getWXContext();
  var openid = wxContext.OPENID;
  try {
    if (action !== 'detail') return { success: false, message: '未知 action: ' + action };
    var activityId = payload.activityId;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };

    // PERF-04: activities 先发起，与后续只依赖 activityId 的查询并行
    var actPromise = db.collection('activities').doc(activityId).get();

    // PERF-19: fields 为非空数组时，只返回这些顶层字段（轻量路径，跳过 teams/matches/photos 等重查询）
    var fields = payload.fields;
    var wantFields = Array.isArray(fields) && fields.length > 0;
    if (wantFields) {
      // SEC-06: 数组入参长度校验
      var fieldsCheck = requireArr(fields, 'fields');
      if (!fieldsCheck.ok) return { success: false, message: fieldsCheck.message };
      var needRegs = fields.indexOf('registrations') !== -1
        || fields.indexOf('userRegistration') !== -1
        || fields.indexOf('waitlist') !== -1
        || fields.indexOf('agentRegistrations') !== -1
        || fields.indexOf('stats') !== -1
        || fields.indexOf('pendingCancelCount') !== -1;
      var needTeams = fields.indexOf('teams') !== -1 || fields.indexOf('matches') !== -1;
      var needMatches = fields.indexOf('matches') !== -1 || fields.indexOf('matchesSummary') !== -1 || fields.indexOf('globalBanner') !== -1;
      var needAlbum = fields.indexOf('album') !== -1;

      // PERF-04: 轻量路径互不依赖查询并行；photos 为可选查询，失败降级 null 不致整页报错
      var lightRound = await Promise.all([
        actPromise,
        needRegs ? db.collection('registrations').where({ activityId: activityId }).get() : null,
        needAlbum ? db.collection('photos').where({ activityId: activityId }).count().catch(function() { return null; }) : null,
        needAlbum ? db.collection('photos').where({ activityId: activityId }).orderBy('createdAt', 'desc').limit(1).get().catch(function() { return null; }) : null
      ]);
      var actRes = lightRound[0];
      if (!actRes.data) return { success: false, message: '活动不存在' };
      var activity = actRes.data;
      var isOrganizer = activity.organizerId === openid;

      var lightRegList = [];
      var lightUserReg = null;
      if (needRegs && lightRound[1]) {
        lightRegList = lightRound[1].data || [];
        for (var lr = 0; lr < lightRegList.length; lr++) {
          if (lightRegList[lr].userId === openid && lightRegList[lr].cancelStatus !== 'approved') {
            lightUserReg = lightRegList[lr];
            break;
          }
        }
      }

      var lightDetail = {
        activity: {
          id: activity._id,
          name: activity.name,
          time: activity.time,
          location: activity.location,
          province: activity.province,
          city: activity.city,
          district: activity.district,
          type: activity.type,
          status: activity.status,
          maxPlayers: activity.maxPlayers,
          minPlayers: activity.minPlayers,
          currentPlayers: activity.currentPlayers,
          courtCount: activity.courtCount,
          playersPerCourt: activity.playersPerCourt,
          organizerId: activity.organizerId,
          latitude: activity.latitude != null ? activity.latitude : null,
          longitude: activity.longitude != null ? activity.longitude : null,
          joinCode: activity.joinCode || '',
          albumTitle: activity.albumTitle || '',
          albumNote: activity.albumNote || ''
        },
        isOrganizer: isOrganizer
      };
      if (fields.indexOf('userRegistration') !== -1) {
        lightDetail.userRegistration = lightUserReg ? {
          id: lightUserReg._id, userId: lightUserReg.userId,
          nickname: lightUserReg.nickname, avatar: lightUserReg.avatar,
          level: lightUserReg.level, partnerId: lightUserReg.partnerId,
          partnerNickname: '', agentUserId: lightUserReg.agentUserId,
          agentNickname: '', agentPhone: lightUserReg.agentPhone || '',
          teamId: lightUserReg.teamId,
          applyStatus: lightUserReg.applyStatus, cancelStatus: lightUserReg.cancelStatus,
          waitlistOrder: lightUserReg.waitlistOrder
        } : null;
      }
      if (needAlbum) {
        var lightAlbum = null;
        try {
          var lcnt = lightRound[2];
          var ltop = lightRound[3];
          if (lcnt && ltop) {
            var lt = (ltop.data && ltop.data[0]) || null;
            lightAlbum = {
              photoCount: lcnt.total,
              coverUrl: lt ? (lt.thumbUrl || lt.url || lt.fileID || null) : null,
              title: activity.albumTitle || '',
              note: activity.albumNote || ''
            };
          }
        } catch (e) {}
        lightDetail.album = lightAlbum;
      }
      // 只保留 fields 里列出的顶层键
      var filtered = {};
      for (var fi = 0; fi < fields.length; fi++) {
        var key = fields[fi];
        if (Object.prototype.hasOwnProperty.call(lightDetail, key)) {
          filtered[key] = lightDetail[key];
        }
      }
      return { success: true, data: filtered, message: 'ok' };
    }

    // PERF-04：activities/registrations/teams/matches 互不依赖，并行查询
    var firstRound = await Promise.all([
      actPromise,
      db.collection('registrations').where({ activityId: activityId }).get(),
      db.collection('teams').where({ activityId: activityId }).get(),
      db.collection('matches').where({ activityId: activityId }).get()
    ]);
    var actRes = firstRound[0];
    if (!actRes.data) return { success: false, message: '活动不存在' };
    var activity = actRes.data;
    var isOrganizer = activity.organizerId === openid;
    var regs = firstRound[1];
    var teams = firstRound[2];
    var matches = firstRound[3];
    var regList = regs.data || [];
    var waitlist = regList.filter(function(r) { return r.applyStatus === 'waiting' && r.cancelStatus !== 'approved'; });
    var actives = regList.filter(function(r) { return r.applyStatus === 'active' && r.cancelStatus !== 'approved'; });

    var regMap = {};
    regList.forEach(function(r) { regMap[r.userId] = r; });
    var teamMap = {};
    (teams.data || []).forEach(function(t) { teamMap[t._id] = t; });

    // Build nickname lookup for agent/partner display
    var allUserIds = [];
    regList.forEach(function(r) {
      if (r.agentUserId && allUserIds.indexOf(r.agentUserId) === -1) allUserIds.push(r.agentUserId);
      if (r.partnerId && allUserIds.indexOf(r.partnerId) === -1) allUserIds.push(r.partnerId);
    });
    var userNickMap = {};

    function memberNames(members) {
      return (members || []).map(function(uid) { return (regMap[uid] && regMap[uid].nickname) || uid; }).join('、');
    }
    function totalLevel(members) {
      return (members || []).reduce(function(sum, uid) {
        return sum + ((regMap[uid] && regMap[uid].level) || 5);
      }, 0);
    }

    var userReg = null;
    for (var i = 0; i < regList.length; i++) {
      if (regList[i].userId === openid && regList[i].cancelStatus !== 'approved') {
        userReg = regList[i];
        break;
      }
    }
    var pendingCancelCount = actives.filter(function(r) { return r.cancelStatus === 'pending'; }).length;

    // Album summary
    var album = null;
    var albumViewer = isOrganizer || (userReg && (userReg.applyStatus === 'active' || userReg.applyStatus === 'waiting'));

    // 第二轮：users（依赖 regs）与 photos（依赖 userReg）并行；各自 try/catch 容错，可选查询失败不致整页报错
    await Promise.all([
      (async function() {
        if (allUserIds.length === 0) return;
        try {
          var usersRes = await db.collection('users').where({ openid: _.in(allUserIds) }).get();
          (usersRes.data || []).forEach(function(u) { userNickMap[u.openid] = u.nickname || ''; });
        } catch (e) {}
      })(),
      (async function() {
        if (!albumViewer) return;
        try {
          // PERF-09/23 + COST-09：count + 最新 1 张，替代整表 get + 内存 sort
          var cntRes = await db.collection('photos').where({ activityId: activityId }).count();
          var topRes = await db.collection('photos').where({ activityId: activityId }).orderBy('createdAt', 'desc').limit(1).get();
          var top = (topRes.data && topRes.data[0]) || null;
          album = {
            photoCount: cntRes.total,
            coverUrl: top ? (top.thumbUrl || top.url || top.fileID || null) : null,
            title: activity.albumTitle || '',
            note: activity.albumNote || ''
          };
        } catch (e) {}
      })()
    ]);

    // Global banner
    var matchList = matches.data || [];
    var playingMatch = null;
    var nextMatch = null;
    for (var j = 0; j < matchList.length; j++) {
      if (matchList[j].status === 'playing') { playingMatch = matchList[j]; break; }
    }
    for (var k = 0; k < matchList.length; k++) {
      if (matchList[k].status === 'pending') { nextMatch = matchList[k]; break; }
    }
    var globalBanner = {
      currentText: playingMatch ? ('场地' + (playingMatch.court || '') + ' 比赛中') : '',
      nextText: nextMatch ? ('第' + (nextMatch.roundOrder || '') + '场 即将开始') : ''
    };

    function regVO(r) {
      return {
        id: r._id,
        userId: r.userId,
        nickname: r.nickname,
        avatar: r.avatar,
        level: r.level,
        partnerId: r.partnerId,
        partnerNickname: r.partnerId ? (userNickMap[r.partnerId] || '') : '',
        agentUserId: r.agentUserId,
        agentNickname: r.agentUserId ? (userNickMap[r.agentUserId] || '') : '',
        agentPhone: r.agentPhone || '',
        teamId: r.teamId,
        applyStatus: r.applyStatus,
        cancelStatus: r.cancelStatus,
        waitlistOrder: r.waitlistOrder
      };
    }

    // Agent registrations (current user is the agent)
    var agentRegistrations = regList.filter(function(r) {
      return r.agentUserId === openid && r.cancelStatus !== 'approved';
    }).map(function(r) {
      return {
        id: r._id,
        nickname: r.nickname,
        level: r.level,
        cancelStatus: r.cancelStatus,
        applyStatus: r.applyStatus,
        agentPhone: r.agentPhone || ''
      };
    });

    var detail = {
      activity: {
        id: activity._id,
        name: activity.name,
        time: activity.time,
        location: activity.location,
        province: activity.province,
        city: activity.city,
        district: activity.district,
        type: activity.type,
        status: activity.status,
        maxPlayers: activity.maxPlayers,
        minPlayers: activity.minPlayers,
        currentPlayers: activity.currentPlayers,
        courtCount: activity.courtCount,
        playersPerCourt: activity.playersPerCourt,
        organizerId: activity.organizerId,
        latitude: activity.latitude != null ? activity.latitude : null,
        longitude: activity.longitude != null ? activity.longitude : null,
        joinCode: activity.joinCode || '',
        // AI-16: 相册标题/说明随 activity 返回，修复 photo-album 读路径
        albumTitle: activity.albumTitle || '',
        albumNote: activity.albumNote || ''
      },
      isOrganizer: isOrganizer,
      registrations: actives.map(function(r) { return regVO(r); }),
      agentRegistrations: agentRegistrations,
      stats: {
        activeCount: actives.length,
        waitingCount: waitlist.length,
        maxPlayers: activity.maxPlayers,
        minPlayers: activity.minPlayers,
        currentPlayers: activity.currentPlayers,
        type: activity.type,
        courtCount: activity.courtCount,
        playersPerCourt: activity.playersPerCourt
      },
      matchesSummary: {
        total: matchList.length,
        finished: matchList.filter(function(m) { return m.status === 'finished'; }).length
      },
      teams: (teams.data || []).map(function(t) { return { id: t._id, name: t.name, members: t.members }; }),
      matches: matchList.map(function(m) {
        var t1 = teamMap[m.team1Id] || {};
        var t2 = teamMap[m.team2Id] || {};
        return {
          _id: m._id,
          id: m._id,
          team1Id: m.team1Id,
          team2Id: m.team2Id,
          team1_id: m.team1Id,
          team2_id: m.team2Id,
          status: m.status,
          roundOrder: m.roundOrder,
          court: m.court,
          venue: m.court,
          round: m.round,
          team1_score: m.team1Score,
          team2_score: m.team2Score,
          team1Score: m.team1Score,
          team2Score: m.team2Score,
          team1_name: t1.name || '队伍1',
          team1_members: memberNames(t1.members),
          team1_totalLevel: totalLevel(t1.members),
          team2_name: t2.name || '队伍2',
          team2_members: memberNames(t2.members),
          team2_totalLevel: totalLevel(t2.members)
        };
      }),
      userRegistration: userReg ? regVO(userReg) : null,
      pendingCancelCount: pendingCancelCount,
      album: album,
      globalBanner: globalBanner,
      waitlist: waitlist.map(function(r) {
        return {
          id: r._id, userId: r.userId, nickname: r.nickname, avatar: r.avatar,
          level: r.level, waitlistOrder: r.waitlistOrder, agentUserId: r.agentUserId
        };
      })
    };

    return { success: true, data: detail, message: 'ok' };
  } catch (err) {
    logger.error('get-activity-detail', action, { err: err });
    return { success: false, message: err.message || '获取活动详情失败' };
  }
};
