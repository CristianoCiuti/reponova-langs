/**
 * CommonJS legacy config fixture. Exercises:
 *  - `var x = require('…')` imports
 *  - `module.exports = { … }` aggregate export
 *  - `exports.foo = …` named export shorthand
 *  - prototype-based class via factory function returning an object
 *  - internal helper functions
 */
'use strict';

var path = require('node:path');
var fs = require('node:fs');

/**
 * Reads a JSON file from disk and merges it on top of `defaults`.
 */
function loadConfig(file, defaults) {
  var resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    return Object.assign({}, defaults);
  }
  var raw = fs.readFileSync(resolved, 'utf8');
  var parsed = JSON.parse(raw);
  return Object.assign({}, defaults, parsed);
}

function mergeAll() {
  var args = Array.prototype.slice.call(arguments);
  return args.reduce(function (acc, cur) {
    return Object.assign(acc, cur);
  }, {});
}

function defineSource(name, options) {
  return {
    name: name,
    options: options || {},
    isPlugin: true,
  };
}

exports.loadConfig = loadConfig;
exports.mergeAll = mergeAll;

module.exports = {
  loadConfig: loadConfig,
  mergeAll: mergeAll,
  defineSource: defineSource,
  DEFAULT_TIMEOUT_MS: 5000,
};
