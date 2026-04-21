const { getAllEmployees, getEmployeesWithProjects, fetchTimesheet, fetchSalaries } = require('../services/asanify.services');
const { buildTeamAllocationExcel } = require('../services/asanify.export');

const DEPT_ORDER = ['Executive team', 'QA', 'Site team'];

function filterAndSort(employees) {
    return employees
        .filter(e => DEPT_ORDER.some(d => d.toLowerCase() === (e.DEPARTMENT_NAME || e.DEPARTMENT || '').toLowerCase()))
        .sort((a, b) => {
            const ai = DEPT_ORDER.findIndex(d => d.toLowerCase() === (a.DEPARTMENT_NAME || a.DEPARTMENT || '').toLowerCase());
            const bi = DEPT_ORDER.findIndex(d => d.toLowerCase() === (b.DEPARTMENT_NAME || b.DEPARTMENT || '').toLowerCase());
            return ai - bi;
        });
}

exports.getEmployees = async (req, res) => {
    try {
        const employees = await getAllEmployees();
        res.json({ success: true, employees });
    } catch (err) {
        console.error('[Asanify] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.getEmployeesWithProjects = async (req, res) => {
    try {
        const all = await getEmployeesWithProjects();
        res.json({ success: true, employees: filterAndSort(all) });
    } catch (err) {
        console.error('[Asanify] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.exportTeamAllocation = async (req, res) => {
    try {
        const now = new Date();
        const year  = parseInt(req.query.year  || now.getFullYear());
        const month = parseInt(req.query.month || now.getMonth() + 1);

        // Build date range for the month
        const mm = String(month).padStart(2, '0');
        const lastDay = new Date(year, month, 0).getDate();
        const fromDate = `${year}-${mm}-01`;
        const toDate   = `${year}-${mm}-${lastDay}`;

        const allEmployees = filterAndSort(await getEmployeesWithProjects());

        const [timesheetRows, salaryMap] = await Promise.all([
            fetchTimesheet(fromDate, toDate).catch(err => {
                console.warn('[Asanify Export] Timesheet fetch failed:', err.message);
                return [];
            }),
            fetchSalaries(allEmployees).catch(err => {
                console.warn('[Asanify Export] Salary fetch failed:', err.message);
                return {};
            }),
        ]);

        const wb = await buildTeamAllocationExcel(allEmployees, year, month, timesheetRows, salaryMap);
        const monthName = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Team-Allocation-${monthName}-${year}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('[Asanify Export] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
