const router = require('express').Router();
const { getEmployees, getEmployeesWithProjects, exportTeamAllocation } = require('../controller/asanify.controller');

router.get('/employees', getEmployees);
router.get('/employees-with-projects', getEmployeesWithProjects);
router.get('/export/team-allocation', exportTeamAllocation);

module.exports = router;
