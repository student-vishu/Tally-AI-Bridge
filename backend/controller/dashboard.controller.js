const { callTally, fetchCostCategories, fetchCurrentPeriod } = require('../services/tally.services');
const { fetchBankCashData } = require('../services/bankcash.services');
const SECTIONS_REGISTRY = require('../config/sections.registry');
const { buildCostCategorySummaryXML } = require('../templates/costcategorysummary.xml');
const { parseCostCategorySummaryXML } = require('../services/parser.services');
const { transformFromCostCategorySummary } = require('../services/transformer.services');


exports.getCompanyCashFlow = async (req, res, next) => {
    try {
        const { from, to } = await fetchCurrentPeriod();
        if (!from) {
            return res.json({ success: true, data: { ledgers: [] } });
        }
        const result = await fetchBankCashData(from, to);
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

exports.getSections = (req, res) => {
    res.json({ success: true, data: SECTIONS_REGISTRY });
};

// Lightweight ping — just fetches company names, returns in < 1 second
const PING_XML = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PingCompanies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="PingCompanies"><TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;

exports.getTallyStatus = async (req, res) => {
    try {
        await callTally(PING_XML);
        res.json({ success: true, data: { connected: true } });
    } catch {
        res.json({ success: true, data: { connected: false } });
    }
};

