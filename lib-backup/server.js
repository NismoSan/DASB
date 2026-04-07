"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TemuairServer = exports.MedeniaServer = exports.LoginServer = void 0;
exports.getServerFromAddress = getServerFromAddress;
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
var Server = /*#__PURE__*/function () {
  function Server(address, port, name) {
    _classCallCheck(this, Server);
    this.address = address;
    this.port = port;
    this.name = name;
  }
  return _createClass(Server, [{
    key: "endPoint",
    value: function endPoint() {
      return "".concat(this.address, ":").concat(this.port);
    }
  }]);
}();
function getServerFromAddress(address, port) {
  var endPoint = "".concat(address, ":").concat(port);
  switch (endPoint) {
    case LoginServer.endPoint():
      return LoginServer;
    case TemuairServer.endPoint():
      return TemuairServer;
    case MedeniaServer.endPoint():
      return MedeniaServer;
  }
}
var address = '52.88.55.94';
var LoginServer = exports.LoginServer = new Server(address, 2610, 'Login');
var TemuairServer = exports.TemuairServer = new Server(address, 2611, 'Temuair');
var MedeniaServer = exports.MedeniaServer = new Server(address, 2612, 'Medenia');