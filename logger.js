// Generated by CoffeeScript 2.5.1
(function() {
  /*
   * Usage

      logger = require './logger'

   * Set log level to filter out unwanted log messages
      logger.setLevel logger.LEVEL_INFO
      logger.debug 'debug message'
      logger.info 'info message'
      logger.warn 'warn message'
      logger.error 'error message'
      logger.fatal 'fatal message'

   * Enable a tag to activate log messages for the tag
      logger.enableTag 'testtag'
      logger.tag 'testtag', 'testtag message'
      logger.tag 'anothertag', 'anothertag message'

   * Print raw string. Equivalent of console.log().
      logger.raw "hello\nraw\nstring"
   */
  var activeTags, api, logLevel, zeropad;

  // Current log level
  logLevel = null;

  activeTags = {};

  zeropad = function(columns, num) {
    num += '';
    while (num.length < columns) {
      num = '0' + num;
    }
    return num;
  };

  api = {
    LEVEL_DEBUG: 0,
    LEVEL_INFO: 1,
    LEVEL_WARN: 2,
    LEVEL_ERROR: 3,
    LEVEL_FATAL: 4,
    LEVEL_OFF: 5,
    enableTag: function(tag) {
      return activeTags[tag] = true;
    },
    disableTag: function(tag) {
      return delete activeTags[tag];
    },
    print: function(str, raw = false) {
      var d;
      if (!raw) {
        d = new Date();
        process.stdout.write(`${d.getFullYear()}-${zeropad(2, d.getMonth() + 1)}-` + `${zeropad(2, d.getDate())} ${zeropad(2, d.getHours())}:` + `${zeropad(2, d.getMinutes())}:${zeropad(2, d.getSeconds())}.` + `${zeropad(3, d.getMilliseconds())} `);
      }
      return console.log(str);
    },
    tag: function(tag, str, raw = false) {
      if (activeTags[tag] != null) {
        return api.print(str, raw);
      }
    },
    msg: function(level, str, raw = false) {
      if (level >= logLevel) {
        return api.print(str, raw);
      }
    },
    // Prints message without header
    raw: function(str) {
      return api.print(str, true);
    },
    setLevel: function(level) {
      return logLevel = level;
    },
    getLevel: function() {
      return logLevel;
    },
    debug: function(str, raw = false) {
      return api.msg(api.LEVEL_DEBUG, str, raw);
    },
    info: function(str, raw = false) {
      return api.msg(api.LEVEL_INFO, str, raw);
    },
    warn: function(str, raw = false) {
      return api.msg(api.LEVEL_WARN, str, raw);
    },
    error: function(str, raw = false) {
      return api.msg(api.LEVEL_ERROR, str, raw);
    },
    fatal: function(str, raw = false) {
      return api.msg(api.LEVEL_FATAL, str, raw);
    }
  };

  logLevel = api.LEVEL_INFO; // default verbosity

  module.exports = api;

}).call(this);
