// Generated by CoffeeScript 2.5.1
(function() {
  // EventEmitter with support for catch-all listeners and mixin
  // TODO: Write tests
  var EventEmitterModule,
    splice = [].splice;

  /*
   * Usage

  Extend EventEmitterModule class to use its features.

      EventEmitterModule = require './event_emitter'

      class MyClass extends EventEmitterModule

      obj = new MyClass
      obj.on 'testevent', (a, b, c) ->
        logger.log "received testevent a=#{a} b=#{b} c=#{c}"

      obj.onAny (eventName, data...) ->
        logger.log "received by onAny: eventName=#{eventName} data=#{data}"

      obj.emit 'testevent', 111, 222, 333
      obj.emit 'anotherevent', 'hello'

  Alternatively, you can add EventEmitterModule features to
  an existing class with `mixin`.

      class MyClass

   * Add EventEmitterModule features to MyClass
      EventEmitterModule.mixin MyClass

      obj = new MyClass
      obj.on 'testevent', ->
        logger.log "received testevent"

      obj.emit 'testevent'

  Also, EventEmitterModule can be injected dynamically into
  an object, but with slightly worse performance.

      class MyClass
        constructor: ->
          EventEmitterModule.inject this

      obj = new MyClass
      obj.on 'testevent', ->
        logger.log "received testevent"

      obj.emit 'testevent'
   */
  EventEmitterModule = class EventEmitterModule {
    // Apply EventEmitterModule to the class
    static mixin(cls) {
      var e, j, len, name, proto, ref;
      proto = EventEmitterModule.prototype;
      ref = Object.getOwnPropertyNames(proto);
      for (j = 0, len = ref.length; j < len; j++) {
        name = ref[j];
        if (name === "constructor") {
          continue;
        }
        try {
          cls.prototype[name] = proto[name];
        } catch (error) {
          e = error;
          throw new Error(
            "Call EventEmitterModule.mixin() after the class definition"
          );
        }
      }
    }

    // Inject EventEmitterModule into the object
    static inject(obj) {
      var j, len, name, proto, ref;
      proto = EventEmitterModule.prototype;
      ref = Object.getOwnPropertyNames(proto);
      for (j = 0, len = ref.length; j < len; j++) {
        name = ref[j];
        if (name === "constructor") {
          continue;
        }
        obj[name] = proto[name];
      }
      obj.eventListeners = {};
      obj.catchAllEventListeners = [];
    }

    emit(name, ...data) {
      var j, k, len, len1, listener, ref, ref1, ref2;
      if (((ref = this.eventListeners) != null ? ref[name] : void 0) != null) {
        ref1 = this.eventListeners[name];
        for (j = 0, len = ref1.length; j < len; j++) {
          listener = ref1[j];
          listener(...data);
        }
      }
      if (this.catchAllEventListeners != null) {
        ref2 = this.catchAllEventListeners;
        for (k = 0, len1 = ref2.length; k < len1; k++) {
          listener = ref2[k];
          listener(name, ...data);
        }
      }
    }

    onAny(listener) {
      if (this.catchAllEventListeners != null) {
        return this.catchAllEventListeners.push(listener);
      } else {
        return (this.catchAllEventListeners = [listener]);
      }
    }

    offAny(listener) {
      var _listener, i, j, len, ref, ref1;
      if (this.catchAllEventListeners != null) {
        ref = this.catchAllEventListeners;
        for (i = j = 0, len = ref.length; j < len; i = ++j) {
          _listener = ref[i];
          if (_listener === listener) {
            splice.apply(
              this.catchAllEventListeners,
              [i, i - i + 1].concat((ref1 = []))
            ),
              ref1;
          }
        }
      }
    }

    on(name, listener) {
      if (this.eventListeners == null) {
        this.eventListeners = {};
      }
      if (this.eventListeners[name] != null) {
        return this.eventListeners[name].push(listener);
      } else {
        return (this.eventListeners[name] = [listener]);
      }
    }

    removeListener(name, listener) {
      var _listener, i, j, len, ref, ref1, ref2;
      if (((ref = this.eventListeners) != null ? ref[name] : void 0) != null) {
        ref1 = this.eventListeners[name];
        for (i = j = 0, len = ref1.length; j < len; i = ++j) {
          _listener = ref1[i];
          if (_listener === listener) {
            splice.apply(
              this.eventListeners,
              [i, i - i + 1].concat((ref2 = []))
            ),
              ref2;
          }
        }
      }
    }

    off(name, listener) {
      return this.removeListener(...arguments);
    }
  };

  module.exports = EventEmitterModule;
}.call(this));
