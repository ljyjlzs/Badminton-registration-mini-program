const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  const { avatar } = event;
  
  if (!avatar) {
    return {
      success: false,
      error: '头像不能为空'
    };
  }
  
  try {
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    
    if (userResult.data && userResult.data.length > 0) {
      await db.collection('users').doc(userResult.data[0]._id).update({
        data: {
          avatar: avatar,
          updated_at: db.serverDate()
        }
      });
    } else {
      await db.collection('users').add({
        data: {
          _openid: openid,
          avatar: avatar,
          nickname: '',
          level: 5,
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
    }
    
    return {
      success: true,
      data: { avatar }
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || '更新头像失败'
    };
  }
};
