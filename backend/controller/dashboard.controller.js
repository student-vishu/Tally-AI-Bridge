const { callTally, fetchCostCategories } = require('../services/tally.services');
const { buildCostCategorySummaryXML } = require('../templates/costcategorysummary.xml');
const { parseCostCategorySummaryXML } = require('../services/parser.services');
const { transformFromCostCategorySummary } = require('../services/transformer.services');


exports.getCompanyCashFlow = async (req, res, next) => {
    try {
        const fromDate = process.env.FY_FROM_DATE;
        const toDate = process.env.FY_TO_DATE;

        const [costCategories, raw] = await Promise.all([
            fetchCostCategories(),
            callTally(buildCostCategorySummaryXML(fromDate, toDate))
        ]);

        const parsed = parseCostCategorySummaryXML(raw);
        const projects = transformFromCostCategorySummary(parsed, costCategories);

        const moneyIn = projects.reduce((sum, p) => sum + p.feesReceived, 0);
        const moneyOut = projects.reduce((sum, p) => sum + p.expensesDone, 0);

        res.json({ success: true, data: { moneyIn, moneyOut } });

    } catch (err) {
        next(err);
    }
};

exports.getConfig = (req, res) => {
    const fromDate = process.env.FY_FROM_DATE || '';
    const startYear = parseInt(fromDate.substring(0, 4), 10);
    const endYear = (startYear + 1).toString().slice(-2);
    const fyLabel = `${startYear}-${endYear}`;
    res.json({ success: true, data: { fyLabel } });
};

exports.getProjectCashFlow = async (req, res, next) => {
    try {
        const fromDate = process.env.FY_FROM_DATE;
        const toDate = process.env.FY_TO_DATE;

        const [costCategories, raw] = await Promise.all([
            fetchCostCategories(),
            callTally(buildCostCategorySummaryXML(fromDate, toDate))
        ]);

        const parsed = parseCostCategorySummaryXML(raw);
        const result = transformFromCostCategorySummary(parsed, costCategories);

        res.json({ success: true, data: result });

    } catch (err) {
        next(err);
    }
};

