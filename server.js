require("v8-compile-cache");

(function () {
  var Bits, StreamServer, config, logger, streamServer, url;

  url = require("url");

  config = require("./config");

  StreamServer = require("./stream_server");

  Bits = require("./bits");

  logger = require("./logger");

  Bits.set_warning_fatal(true);

  logger.setLevel(logger[config.logLevel]);

  streamServer = new StreamServer();

  // Uncomment this block if you use Basic auth for RTSP
  //streamServer.setAuthenticator (username, password, callback) ->
  //  # If isAuthenticated is true, access is allowed
  //  isAuthenticated = false

  //  # Replace here
  //  if (username is 'user1') and (password is 'password1')
  //    isAuthenticated = true

  //  callback null, isAuthenticated
  streamServer.setLivePathConsumer(function (uri, callback) {
    var isAuthorized, pathname, ref;
    pathname = (ref = url.parse(uri).pathname) != null ? ref.slice(1) : void 0;
    isAuthorized = true;
    if (isAuthorized) {
      return callback(null); // Accept access
    } else {
      return callback(new Error("Unauthorized access")); // Deny access
    }
  });

  if (config.recordedDir != null) {
    streamServer.attachRecordedDir(config.recordedDir);
  }

  process.on("SIGINT", () => {
    logger.log("Got SIGINT");
    return streamServer.stop(function () {
      return process.kill(process.pid, "SIGTERM");
    });
  });

  process.on("uncaughtException", function (err) {
    streamServer.stop();
    throw err;
  });

  streamServer.start();
}.call(this));
