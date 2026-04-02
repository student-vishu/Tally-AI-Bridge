const router = require('express').Router();
const {
    getCompanyCashFlow, getProjectCashFlow, getProjectCashFlowExpand,
    getConfig, getSections, getTallyStatus, diagCCBreakup
} = require('../controller/dashboard.controller');

router.get('/sections', getSections);
router.get('/config', getConfig);
router.get('/tally-status', getTallyStatus);
router.get('/company-cashflow', getCompanyCashFlow);
router.get('/project-cashflow', getProjectCashFlow);
router.get('/project-cashflow-expand', getProjectCashFlowExpand);
router.get('/diag-cc-breakup', diagCCBreakup);

module.exports = router;