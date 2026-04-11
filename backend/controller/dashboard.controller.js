const { callTally, fetchCostCategories, fetchCurrentPeriod, fetchCompanyBooksFrom, decodeXml } = require('../services/tally.services');
const { fetchBankCashData } = require('../services/bankcash.services');
const { fetchProjectExpand, fetchAllProjectsExpand, warmFYCache } = require('../services/projectcashflow.services');
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

// Resolve period strictly from request query params only (?from+?to or ?fy).
// Never falls back to Tally's currently selected period — dashboard state is owned by the dashboard.
function resolvePeriod(req) {
    const company = req.query.company || null;
    let from, to;
    if (req.query.from && req.query.to) {
        from = req.query.from; // YYYYMMDD passed directly
        to   = req.query.to;
    } else if (req.query.fy) {
        const fy = parseInt(req.query.fy, 10);
        if (!isNaN(fy)) {
            from = `${fy}0401`;
            to   = `${fy + 1}0331`;
        }
    }
    return { from: from || null, to: to || null, company };
}

exports.getCompanyCashFlow = async (req, res, next) => {
    try {
        const { tallyUrl } = req;
        const { from, to, company } = resolvePeriod(req);
        if (!from) return res.json({ success: true, data: { ledgers: [] } });
        const result = await fetchBankCashData(from, to, tallyUrl, company);
        res.json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};

exports.getConfig = async (req, res, next) => {
    try {
        const { tallyUrl } = req;
        const company = req.query.company || null;
        // Use BOOKSFROM from the Company master — fixed date, never changes with period selection in Tally UI
        const booksFromYear = await fetchCompanyBooksFrom(tallyUrl, company);
        const latestFY = currentFYStartYear();

        const availableYears = [];
        if (booksFromYear) {
            for (let y = booksFromYear; y <= latestFY; y++) {
                availableYears.push({
                    fy: y,
                    label: `${y}-${String(y + 1).slice(-2)}` // "2022-23"
                });
            }
        }

        res.json({ success: true, data: { availableYears } });
    } catch (err) {
        next(err);
    }
};

exports.getProjectCashFlow = async (req, res, next) => {
    try {
        const { tallyUrl } = req;
        const { from, to, company } = resolvePeriod(req);
        if (!from) return res.json({ success: true, data: [] });
        const [costCategories, raw] = await Promise.all([
            fetchCostCategories(tallyUrl, company),
            callTally(buildCostCategorySummaryXML(from, to, company), 35000, tallyUrl)
        ]);
        const parsed = parseCostCategorySummaryXML(raw);
        const result = transformFromCostCategorySummary(parsed, costCategories);
        res.json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};

exports.getProjectCashFlowExpand = async (req, res, next) => {
    try {
        const { tallyUrl } = req;
        const project = req.query.project;
        if (!project) return res.status(400).json({ success: false, error: 'project param required' });

        const { from, to, company } = resolvePeriod(req);
        if (!from) return res.json({ success: true, data: { project, items: [] } });

        const items = await fetchProjectExpand(project, from, to, tallyUrl, company);
        res.json({ success: true, data: { project, from, to, items } });
    } catch (err) {
        next(err);
    }
};

exports.getAllProjectsExpand = async (req, res, next) => {
    try {
        const { tallyUrl } = req;
        const { from, to, company } = resolvePeriod(req);
        if (!from) return res.json({ success: true, data: { projects: [] } });
        const projects = await fetchAllProjectsExpand(from, to, tallyUrl, company);
        res.json({ success: true, data: { from, to, projects } });
    } catch (err) {
        next(err);
    }
};

exports.warmCache = async (req, res, next) => {
    try {
        const { tallyUrl } = req;
        const { from, company } = resolvePeriod(req);
        if (from) warmFYCache(from, tallyUrl, company).catch(() => {}); // fire-and-forget
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
};

exports.getSections = (req, res) => {
    res.json({ success: true, data: SECTIONS_REGISTRY });
};

const PING_XML = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PingCompanies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="PingCompanies"><TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;

exports.getCompanies = async (req, res, next) => {
    try {
        const { tallyUrl } = req;
        const raw = await callTally(PING_XML, 35000, tallyUrl);
        const companies = [...raw.matchAll(/COMPANY NAME="([^"]+)"/g)].map(m => decodeXml(m[1]));
        res.json({ success: true, data: { companies } });
    } catch (err) {
        next(err);
    }
};

exports.getCurrentCompany = async (req, res, next) => {
    try {
        const { tallyUrl } = req;
        // Always fresh — clear cache so company switch in Tally reflects immediately
        const { clearPeriodCache, fetchCurrentPeriod } = require('../services/tally.services');
        clearPeriodCache(tallyUrl);
        const period = await fetchCurrentPeriod(tallyUrl);
        const fyStart = period.booksFromYear || (period.from ? parseInt(period.from.substring(0, 4), 10) : null);
        const fyLabel = fyStart ? `${fyStart}-${String(fyStart + 1).slice(-2)}` : '';
        res.json({ success: true, data: { companyName: period.companyName || '', fyLabel } });
    } catch (err) {
        next(err);
    }
};

exports.getTallyStatus = async (req, res) => {
    try {
        await callTally(PING_XML, 35000, req.tallyUrl);
        res.json({ success: true, data: { connected: true } });
    } catch {
        res.json({ success: true, data: { connected: false } });
    }
};
