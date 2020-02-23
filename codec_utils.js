// Generated by CoffeeScript 2.5.1
(function() {
  var crypto;

  crypto = require('crypto');

  module.exports = {
    // Calculate the digest of data and return a buffer
    calcHmac: function(data, key) {
      var hmac;
      hmac = crypto.createHmac('sha256', key);
      hmac.update(data);
      return hmac.digest();
    }
  };

}).call(this);
