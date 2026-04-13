const router = require('express').Router();
const {
    getCompanyCashFlow, getProjectCashFlow, getProjectCashFlowExpand,
    getAllProjectsExpand, warmCache,
    getConfig, getSections, getTallyStatus, getCurrentCompany, getCompanies,
    getLedgers,
    getLedgerDetail
} = require('../controller/dashboard.controller');

router.get('/sections', getSections);
router.get('/companies', getCompanies);
router.get('/config', getConfig);
router.get('/tally-status', getTallyStatus);
router.get('/current-company', getCurrentCompany);
router.get('/company-cashflow', getCompanyCashFlow);
router.get('/project-cashflow', getProjectCashFlow);
router.get('/project-cashflow-expand', getProjectCashFlowExpand);
router.get('/project-cashflow-all-expand', getAllProjectsExpand);
router.get('/project-cashflow-warm-cache', warmCache);
router.get('/ledgers', getLedgers);
router.get('/ledger-detail', getLedgerDetail);
module.exports = router;