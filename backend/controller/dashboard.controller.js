const { callTally, fetchCostCategories, fetchCurrentPeriod } = require('../services/tally.services');
const { fetchBankCashData } = require('../services/bankcash.services');
const SECTIONS_REGISTRY = require('../config/sections.registry');
const { buildCostCategorySummaryXML } = require('../templates/costcategorysummary.xml');
const { parseCostCategorySummaryXML } = require('../services/parser.services');
const { transformFromCostCategorySummary } = require('../services/transformer.services');

// Compute current Indian FY start year for a given date
function currentFYStartYear(date = new Date()) {
    const yr = date.getFullYear();
    const mo = date.getMonth() + 1; // 1-based
    return mo >= 4 ? yr : yr - 1; // FY starts April
}

exports.getCompanyCashFlow = async (req, res, next) => {
    try {
        const period = await fetchCurrentPeriod();

        // Allow caller to override year: ?fy=2022 → FY 2022-23 (Apr 2022 – Mar 2023)
        const fyParam = req.query.fy ? parseInt(req.query.fy, 10) : null;
        let from, to;
        if (fyParam && !isNaN(fyParam)) {
            from = `${fyParam}0401`;
            to   = `${fyParam + 1}0331`;
        } else {
            from = period.from;
            to   = period.to;
        }

        if (!from) return res.json({ success: true, data: { ledgers: [] } });

        const result = await fetchBankCashData(from, to);
        res.json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};

exports.getConfig = async (req, res, next) => {
    try {
        const period = await fetchCurrentPeriod();
        const booksFromYear = period.booksFromYear;
        const latestFY = currentFYStartYear();

        // Available FY years: from books-start year up to current FY year
        const availableYears = [];
        if (booksFromYear) {
            for (let y = booksFromYear; y <= latestFY; y++) {
                availableYears.push({
                    fy: y,
                    label: `${y}-${String(y + 1).slice(-2)}` // "2022-23"
                });
            }
        }

        const fyStart = booksFromYear || (period.from ? parseInt(period.from.substring(0, 4), 10) : null);
        const fyLabel = fyStart ? `${fyStart}-${String(fyStart + 1).slice(-2)}` : 'No data';

        res.json({
            success: true,
            data: { fyLabel, availableYears, defaultFY: latestFY }
        });
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

const PING_XML = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PingCompanies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="PingCompanies"><TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;

exports.getTallyStatus = async (req, res) => {
    try {
        await callTally(PING_XML);
        res.json({ success: true, data: { connected: true } });
    } catch {
        res.json({ success: true, data: { connected: false } });
    }
};
