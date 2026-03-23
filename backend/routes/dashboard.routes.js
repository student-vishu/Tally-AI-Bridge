const router = require('express').Router();
const {
    getCompanyCashFlow
} = require('../controller/dashboard.controller');

router.get('/company-cashflow', getCompanyCashFlow);

module.exports = router;