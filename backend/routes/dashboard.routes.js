const router = require('express').Router();
const {
    getCompanyCashFlow, getProjectCashFlow, getConfig
} = require('../controller/dashboard.controller');

router.get('/config', getConfig);

router.get('/company-cashflow', getCompanyCashFlow);

router.get('/project-cashflow', getProjectCashFlow);

module.exports = router;