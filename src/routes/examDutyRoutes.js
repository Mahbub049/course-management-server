// Keep this route manifest in sync with src/controllers/examDutyController.js.
// All endpoints below must be backed by functions, not missing/old exports.
const router = require('express').Router();
const { authMiddleware, requireTeacher } = require('../middleware/authMiddleware');
const controller = require('../controllers/examDutyController');

function handler(name) {
  const fn = controller[name];
  if (typeof fn !== 'function') {
    throw new TypeError(
      `Exam Duties backend version mismatch: controller.${name} is ${typeof fn}, ` +
      'expected a function. Replace BOTH src/routes/examDutyRoutes.js and ' +
      'src/controllers/examDutyController.js from the same update.'
    );
  }
  return fn;
}

router.use(authMiddleware, requireTeacher);
router.get('/sessions', handler('listSessions'));
router.post('/import', handler('importRows'));
router.delete('/sessions/:id', handler('deleteSession'));
router.get('/sessions/:id/mine', handler('mySchedule'));
router.get('/sessions/:id/search', handler('searchFaculty'));
router.post('/sessions/:id/proxies', handler('addProxy'));
router.delete('/sessions/:id/proxies/:recordId', handler('removeProxy'));
router.post('/sessions/:id/changes', handler('createChange'));
router.delete('/sessions/:id/changes/:changeId', handler('revertChange'));

module.exports = router;
