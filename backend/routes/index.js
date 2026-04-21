const router = require('express').Router();

router.use('/dashboard', require('./dashboard.routes'));
router.use('/tally', require('./tally.routes'));
router.use('/ai', require('./ai.routes')); // not used now
router.use('/asanify', require('./asanify.routes'));

module.exports = router;