const { callTally, fetchCostCategories, fetchCurrentPeriod } = require('../services/tally.services');
const { buildCashFlowXML } = require('../templates/cashflow.xml');
const { buildCostCategorySummaryXML } = require('../templates/costcategorysummary.xml');
const { parseCashFlowXML, parseCostCategorySummaryXML } = require('../services/parser.services');
const { transformCompanyCashFlowFromReport, transformFromCostCategorySummary } = require('../services/transformer.services');


exports.getCompanyCashFlow = async (req, res, next) => {
    try {
        const raw = await callTally(buildCashFlowXML());
        const parsed = parseCashFlowXML(raw);
        const result = transformCompanyCashFlowFromReport(parsed);

        res.json({ success: true, data: result });

    } catch (err) {
        next(err);
    }
};

exports.getConfig = async (req, res, next) => {
    try {
        const { from } = await fetchCurrentPeriod();
        const startYear = parseInt((from || '').substring(0, 4), 10);
        const fyLabel = isNaN(startYear)
            ? 'No data for selected period'
            : `${startYear}-${(startYear + 1).toString().slice(-2)}`;
        res.json({ success: true, data: { fyLabel } });
    } catch (err) {
        next(err);
    }
};

exports.getProjectCashFlow = async (req, res, next) => {
    try {
        const [costCategories, raw] = await Promise.all([
            fetchCostCategories(),
            callTally(buildCostCategorySummaryXML())
        ]);

        const parsed = parseCostCategorySummaryXML(raw);
        const result = transformFromCostCategorySummary(parsed, costCategories);

        res.json({ success: true, data: result });

    } catch (err) {
        next(err);
    }
};

