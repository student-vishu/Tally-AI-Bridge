const router = require('express').Router();
const { handleAI } = require('../controller/ai.controller');

router.post('/interpret', handleAI);

module.exports = router;