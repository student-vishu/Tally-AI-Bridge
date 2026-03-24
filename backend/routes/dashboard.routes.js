const router = require('express').Router();
const {
    getCompanyCashFlow, getProjectCashFlow
} = require('../controller/dashboard.controller');

router.get('/company-cashflow', getCompanyCashFlow);

router.get('/project-cashflow', getProjectCashFlow);

module.exports = router;