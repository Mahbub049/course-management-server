// Standalone startup-route smoke test. Does not require npm install or MongoDB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const controllerPath = path.resolve(__dirname, '../src/controllers/examDutyController.js');
const routesPath = path.resolve(__dirname, '../src/routes/examDutyRoutes.js');

// Evaluate controller exports without connecting to a DB.
function loadController() {
  const m = new Module(controllerPath, module);
  m.filename = controllerPath;
  m.paths = [];
  m.require = name => {
    if (name === 'crypto') return require('node:crypto');
    if (name === 'mongoose') return { isValidObjectId: () => true };
    if (name === '../utils/examDutyBilling') return { classifyExamDuty: () => 'day' };
    if (name.startsWith('../models/')) return {};
    throw new Error(`Unexpected dependency ${name}`);
  };
  m._compile(fs.readFileSync(controllerPath, 'utf8'), controllerPath);
  return m.exports;
}
const controller = loadController();
const expected = {
  'GET /sessions':'listSessions',
  'POST /import':'importRows',
  'DELETE /sessions/:id':'deleteSession',
  'GET /sessions/:id/mine':'mySchedule',
  'GET /sessions/:id/search':'searchFaculty',
  'POST /sessions/:id/proxies':'addProxy',
  'DELETE /sessions/:id/proxies/:recordId':'removeProxy',
  'POST /sessions/:id/changes':'createChange',
  'DELETE /sessions/:id/changes/:changeId':'revertChange',
};
for (const method of Object.values(expected)) {
  assert.equal(typeof controller[method], 'function', `Missing controller function ${method}`);
}

function loadRouter(ctrl) {
  const registered = [];
  const router = { use(...handlers) {
    handlers.forEach(h => assert.equal(typeof h, 'function', 'Non-function auth middleware'));
  }};
  for (const verb of ['get','post','delete']) {
    router[verb] = (url, h) => {
      assert.equal(typeof h, 'function', `Invalid ${verb.toUpperCase()} ${url} handler`);
      registered.push([`${verb.toUpperCase()} ${url}`, h]);
    };
  }
  const m = new Module(routesPath, module);
  m.filename = routesPath;
  m.paths = [];
  m.require = name => {
    if (name === 'express') return { Router: () => router };
    if (name === '../middleware/authMiddleware') return {
      authMiddleware() {}, requireTeacher() {},
    };
    if (name === '../controllers/examDutyController') return ctrl;
    throw new Error(`Unexpected dependency ${name}`);
  };
  m._compile(fs.readFileSync(routesPath, 'utf8'), routesPath);
  return registered;
}
const actual = loadRouter(controller);
assert.deepEqual(actual.map(([route])=>route), Object.keys(expected), 'Route manifest changed unexpectedly');
for (const [route,fn] of actual) assert.equal(fn, controller[expected[route]]);
// Verify missing exports get a useful explanation, not an opaque Express crash.
assert.throws(() => loadRouter({ ...controller, importRows:undefined }),
  /Exam Duties backend version mismatch: controller\.importRows is undefined/);
console.log(`PASS: ${actual.length} Exam Duties endpoints and all controller exports match.`);
