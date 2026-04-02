const { callTally, fetchCostCategories, fetchCurrentPeriod } = require('../services/tally.services');
const { fetchBankCashData } = require('../services/bankcash.services');
const { fetchProjectExpand } = require('../services/projectcashflow.services');
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
            to = `${fyParam + 1}0331`;
        } else {
            from = period.from;
            to = period.to;
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

exports.getProjectCashFlowExpand = async (req, res, next) => {
    try {
        const project = req.query.project;
        if (!project) return res.status(400).json({ success: false, error: 'project param required' });

        const period = await fetchCurrentPeriod();
        const fyParam = req.query.fy ? parseInt(req.query.fy, 10) : null;
        let from, to;
        if (fyParam && !isNaN(fyParam)) {
            from = `${fyParam}0401`;
            to = `${fyParam + 1}0331`;
        } else {
            from = period.from;
            to = period.to;
        }

        if (!from) return res.json({ success: true, data: { project, items: [] } });

        const items = await fetchProjectExpand(project, from, to);
        res.json({ success: true, data: { project, from, to, items } });
    } catch (err) {
        next(err);
    }
};

exports.getSections = (req, res) => {
    res.json({ success: true, data: SECTIONS_REGISTRY });
};

const PING_XML = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PingCompanies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="PingCompanies"><TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;

// Diagnostics for Tally Prime CC monthly data approaches
exports.diagCCBreakup = async (req, res) => {
    const results = {};
    const CC_NAME = req.query.cc || 'Amrit';
    const CC_CAT = req.query.cat || 'Primary Cost Category';
    const FROM = req.query.from || '20220401';
    const TO = req.query.to || '20230331';

    // ── Test 0: Cost Category Summary cumulative snapshots ────────────────────
    // Always FROM=FY Apr 1, TO=month-end → gives cumulative year-to-date.
    // Monthly = diff of consecutive snapshots.  If this matches expected Amrit
    // values (Jul=4428, Sep=390, Oct=1555) the approach is viable.
    const ccSumXML = (from, to) =>
        `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Cost Category Summary</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>${from}</SVFROMDATE><SVTODATE>${to}</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

    const fyStart = parseInt(FROM.substring(0, 4), 10);
    const fyFrom = `${fyStart}0401`;

    // Snapshot months: Jun, Jul, Aug, Sep, Oct (covers the Jul-Oct window for Amrit)
    const snapMonths = [
        { mk: 'Jun', to: `${fyStart}0630` },
        { mk: 'Jul', to: `${fyStart}0731` },
        { mk: 'Aug', to: `${fyStart}0831` },
        { mk: 'Sep', to: `${fyStart}0930` },
        { mk: 'Oct', to: `${fyStart}1031` },
    ];

    function parseCCSummary(xml, ccName) {
        // Find the DSPDISPNAME that matches, return its DSPDRAMTA/DSPCRAMTA
        const nameRe = /<DSPDISPNAME[^>]*>([\s\S]*?)<\/DSPDISPNAME>/g;
        const drRe = /<DSPDRAMTA[^>]*>([-\d.]*)<\/DSPDRAMTA>/g;
        const crRe = /<DSPCRAMTA[^>]*>([-\d.]*)<\/DSPCRAMTA>/g;
        const names = [...xml.matchAll(nameRe)].map(m => m[1].trim());
        const drs = [...xml.matchAll(drRe)].map(m => parseFloat(m[1]) || 0);
        const crs = [...xml.matchAll(crRe)].map(m => parseFloat(m[1]) || 0);
        const idx = names.findIndex(n => n.toLowerCase() === ccName.toLowerCase());
        if (idx === -1) return { found: false, debit: 0, credit: 0 };
        return { found: true, debit: Math.abs(drs[idx] || 0), credit: Math.abs(crs[idx] || 0) };
    }

    try {
        const snaps = [];
        for (const { mk, to: snapTo } of snapMonths) {
            const xml = await callTally(ccSumXML(fyFrom, snapTo), 30000);
            const { found, debit, credit } = parseCCSummary(xml, CC_NAME);
            snaps.push({ mk, debit, credit, found });
        }
        // Derive monthly: diff consecutive snapshots
        const monthly = [];
        for (let i = 0; i < snaps.length; i++) {
            const prev = i > 0 ? snaps[i - 1] : { debit: 0, credit: 0 };
            monthly.push({
                month: snaps[i].mk,
                cumulativeDebit: snaps[i].debit,
                cumulativeCredit: snaps[i].credit,
                monthlyDebit: snaps[i].debit - prev.debit,
                monthlyCredit: snaps[i].credit - prev.credit,
                found: snaps[i].found
            });
        }
        results.ccSumCumulative = { monthly };
    } catch (e) { results.ccSumCumulative = { error: e.message }; }

    // ── Test A: CC Breakup with category + centre ──────────────────────────────
    // Tally UI path: Gateway → Cost Centre Reports → Cost Centre Breakup
    // requires both a cost category AND a cost centre to be set in context.
    const ccBreakupXML = (cat, cc, from, to) =>
        `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Cost Centre Breakup</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCOSTCATEGORY>${cat}</SVCOSTCATEGORY><SVCOSTCENTRE>${cc}</SVCOSTCENTRE><SVFROMDATE>${from}</SVFROMDATE><SVTODATE>${to}</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

    try {
        const xml = await callTally(ccBreakupXML(CC_CAT, CC_NAME, FROM, TO), 60000);
        const firstDate = xml.match(/<DATE[^>]*>(\d{8})<\/DATE>/)?.[1] || 'none';
        const hasAmrit = xml.includes(CC_NAME);
        results.ccBreakupCatCentre = {
            len: xml.length,
            hasCC: hasAmrit,
            firstDate,
            snippet: xml.substring(0, 600)
        };
    } catch (e) { results.ccBreakupCatCentre = { error: e.message }; }

    // ── Test B: CC Breakup with SVCOSTCENTRENAME (alternate variable) ──────────
    const ccBreakupAltXML = (cc, from, to) =>
        `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Cost Centre Breakup</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCOSTCENTRENAME>${cc}</SVCOSTCENTRENAME><SVFROMDATE>${from}</SVFROMDATE><SVTODATE>${to}</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

    try {
        const xml = await callTally(ccBreakupAltXML(CC_NAME, FROM, TO), 60000);
        const firstDate = xml.match(/<DATE[^>]*>(\d{8})<\/DATE>/)?.[1] || 'none';
        results.ccBreakupCentreNameVar = {
            len: xml.length,
            hasCC: xml.includes(CC_NAME),
            firstDate,
            snippet: xml.substring(0, 600)
        };
    } catch (e) { results.ccBreakupCentreNameVar = { error: e.message }; }

    // ── Test C: CLOSINGBALANCE for ONE CC only — speed check ──────────────────
    // If this single-CC call completes in <15s, we can do 12 per expand.
    const singleCCBalXML = (cc, from, to) =>
        `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SingleCCBal</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>${from}</SVFROMDATE><SVTODATE>${to}</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="SingleCCBal"><TYPE>Cost Centre</TYPE><FETCH>NAME,CLOSINGBALANCE</FETCH><FILTER>IsCC</FILTER></COLLECTION><SYSTEM TYPE="Formulae"><PART NAME="IsCC">$Name = "${cc}"</PART></SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;

    const t0 = Date.now();
    try {
        const xml = await callTally(singleCCBalXML(CC_NAME, FROM, TO), 60000);
        const elapsed = Date.now() - t0;
        const cbM = xml.match(/<CLOSINGBALANCE[^>]*>([-\d.]+)/);
        results.singleCCClosingBalance = {
            elapsed_ms: elapsed,
            len: xml.length,
            closingBalance: cbM ? cbM[1] : 'not found',
            snippet: xml.substring(0, 400)
        };
    } catch (e) { results.singleCCClosingBalance = { error: e.message, elapsed_ms: Date.now() - t0 }; }

    res.json({ success: true, cc: CC_NAME, cat: CC_CAT, from: FROM, to: TO, results });
};

exports.getTallyStatus = async (req, res) => {
    try {
        await callTally(PING_XML);
        res.json({ success: true, data: { connected: true } });
    } catch {
        res.json({ success: true, data: { connected: false } });
    }
};
