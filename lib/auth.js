'use strict';

var uuid = require('uuid');
var Boom = require('boom');
var nconf = require('nconf');
var level = require('level');
var ttl = require('level-ttl');

var profile = require('./profile');
var utils = require('./utils');
var ban = require('./ban');
ban.setDB();
var pin = require('./pin');
var fixtures = require('../test/fixtures.json');

nconf.argv().env().file({ file: 'local.json' });

var db;

var addNewUser = function (uid, phone, request, reply) {
  profile.db().put('uid!' + uid, phone, function (err) {
    if (err) {
      return reply(Boom.wrap(err, 400));
    }

    profile.db().put('user!' + phone, {
      uid: uid,
      phone: phone,
      secondary: {}
    }, function (err) {
      if (err) {
        return reply(Boom.wrap(err, 400));
      }

      request.session.set('uid', uid);
      reply.redirect('/');
    });
  });
};

var checkAdmin = function (uid, request) {
  if (nconf.get('ops').indexOf(uid) > -1) {
    request.session.set('op', true);
    return;
  }
};

var register = function (request, reply) {
  var phone = request.session.get('phone');

  if (process.env.NODE_ENV === 'test') {
    phone = fixtures.phone;
  }

  console.log('logging in ', phone);

  profile.db().get('user!' + phone, function (err, user) {
    if (err || !user) {
      // Test secondary phone first before assuming it is a new registration
      profile.db().get('secondary!' + phone, function (err, primary) {
        if (err ||  !primary) {
          // register new user
          var uid = uuid.v4();
          addNewUser(uid, phone, request, reply);
          return;
        }

        profile.db().get('user!' + primary, function (err, user) {
          if (err) {
            // This shouldn't happen at all since attaching a secondary phone to
            // a non-existent primary means the data is faulty.
            return reply(Boom.wrap(err, 500));
          }

          checkAdmin(user.uid, request);
          request.session.set('phone', primary);
          request.session.set('uid', user.uid);
          request.session.set('name', user.name);
          return reply.redirect('/');
        });
      });
    } else {
      checkAdmin(user.uid, request);
      request.session.set('uid', user.uid);
      request.session.set('name', user.name);
      reply.redirect('/');
    }
  });
};

exports.setDB = function (dbPath) {
  db = ttl(level(dbPath || './db/logins', {
    createIfMissing: true,
    valueEncoding: 'json'
  }));
};

exports.login = function (request, reply) {
  var phone = request.payload.phone;
  var ip = request.info.remoteAddress;

  var generate = function () {
    pin.generate(phone, function (err, status) {
      if (err) {
        return reply(Boom.wrap(err, 400));
      }

      request.session.set('phone', phone);
      reply.redirect('/authenticate');
    });
  };

  var getLoginAttempts = function () {
    db.get(ip, function (err, count) {
      if (!err) {
        count ++;
        if (count > 3) {
          // ban if login attempts are more then 3 in a span of 5 minutes
          ban.hammer(ip, function (err) {
            if (err) {
              console.error(err);
            }
          });
          return reply(Boom.wrap(new Error('Your ip address has been banned. Please contact an operator.'), 400));
        }
      } else {
        count = 0;
      }

      db.put(ip, count, { ttl: 300000 }, function (err) {
        if (err) {
          return reply(Boom.wrap(err, 400));
        }

        generate();
      });
    });
  };

  ban.db().get(ip, function (err, p) {
    if (!err) {
      return reply(Boom.wrap(new Error('Your ip address has been banned. Please contact an operator.'), 400));
    }

    getLoginAttempts();
  });
};

exports.authenticate = function (request, reply) {
  var phone = request.session.get('phone');

  if (process.env.NODE_ENV === 'test') {
    phone = fixtures.phone;
  }

  pin.verify(phone, request.payload.pin, function (err, pin) {
    if (err) {
      return reply(Boom.wrap(err, 400));
    }

    register(request, reply);
  });
};

exports.logout = function (request, reply) {
  request.session.reset();
  reply.redirect('/');
};
