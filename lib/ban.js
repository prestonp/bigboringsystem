'use strict';

var level = require('level');

var db;

exports.setDB = function (dbPath) {
  db = level(dbPath || './db/bans', {
    createIfMissing: true,
    valueEncoding: 'json'
  });
};

exports.db = function () {
  return db;
};

exports.hammer = function (ip, next) {
  db.put(ip, ip, function (err) {
    if (err) {
      return next(err);
    }

    next(null, ip);
  });
};

exports.unhammer = function (ip, next) {
  db.del(ip, function (err) {
    if (err) {
      return next(err);
    }

    next(null, true);
  });
};

exports.status = function (ip, next) {
  db.get(ip, function (err) {
    if (err) {
      return next(err);
    }

    next(null, true);
  });
};
