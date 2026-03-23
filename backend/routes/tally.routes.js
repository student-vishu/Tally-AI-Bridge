const router = require('express').Router();
const { healthCheck } = require('../controller/tally.controller');

router.get('/health', healthCheck);

module.exports = router;