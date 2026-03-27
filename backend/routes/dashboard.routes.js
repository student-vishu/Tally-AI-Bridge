const router = require('express').Router();
const {
    getCompanyCashFlow, getProjectCashFlow, getConfig, getSections, getTallyStatus
} = require('../controller/dashboard.controller');

router.get('/sections', getSections);
router.get('/config', getConfig);
router.get('/tally-status', getTallyStatus);
router.get('/company-cashflow', getCompanyCashFlow);
router.get('/project-cashflow', getProjectCashFlow);

module.exports = router;