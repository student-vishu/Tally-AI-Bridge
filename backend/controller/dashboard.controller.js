const { callTally, fetchCostCategories, fetchCurrentPeriod, fetchCompanyBooksFrom, decodeXml } = require('../services/tally.services');
const { fetchBankCashData } = require('../services/bankcash.services');
const { fetchProjectExpand, fetchAllProjectsExpand, warmFYCache } = require('../services/projectcashflow.services');
const SECTIONS_REGISTRY = require('../config/sections.registry');
const { buildCostCategorySummaryXML } = require('../templates/costcategorysummary.xml');
const { buildAllLedgersXML, buildFYVouchersXML } = require('../templates/bankcash.xml');
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

        const { items, expTypePairs } = await fetchProjectExpand(project, from, to, tallyUrl, company);
        res.json({ success: true, data: { project, from, to, items, expTypePairs } });
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

// Cache: key = "company|from|to" → { ledgerMap: Map<name,{dr,cr,drGroups,crGroups,months}>, parentMap }
// Voucher-based Dr/Cr per ledger — avoids CLOSINGBALANCE (unsupported in Tally Prime collections)
// and avoids TDL FUNCTION filters (also unsupported). Uses the same buildFYVouchersXML that
// bankcash.services.js already uses successfully.
const _voucherSummaryCache = new Map();
const VOUCHER_SUMMARY_TTL  = 5 * 60 * 1000; // 5 minutes

const _MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

function _monthKeys(from, to) {
    const keys = [];
    let y = parseInt(from.substring(0, 4)), m = parseInt(from.substring(4, 6));
    const ey = parseInt(to.substring(0, 4)), em = parseInt(to.substring(4, 6));
    while (y < ey || (y === ey && m <= em)) {
        keys.push(`${y}${String(m).padStart(2, '0')}`);
        m++; if (m > 12) { m = 1; y++; }
    }
    return keys;
}

async function _fetchVoucherSummary(from, to, company, tallyUrl) {
    const cacheKey = `${company || ''}|${from}|${to}`;
    const cached = _voucherSummaryCache.get(cacheKey);
    if (cached && (Date.now() - cached.time) < VOUCHER_SUMMARY_TTL) return cached.data;

    // Fetch vouchers and ledger parents in parallel.
    // buildAllLedgersXML has no date vars → fast master read.
    // buildFYVouchersXML is proven to work in Tally Prime.
    const [vouchersRaw, ledgersRaw] = await Promise.all([
        callTally(buildFYVouchersXML(from, to, company), 60000, tallyUrl),
        callTally(buildAllLedgersXML(company),           35000, tallyUrl),
    ]);

    // Build parent lookup
    const parentMap = new Map();
    for (const m of ledgersRaw.matchAll(/<LEDGER NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/g)) {
        const name        = decodeXml(m[1]);
        const parentMatch = m[2].match(/<PARENT[^>]*>([^<]*)<\/PARENT>/);
        parentMap.set(name, parentMatch ? decodeXml(parentMatch[1].trim()) : '');
    }

    // Aggregate Dr / Cr per ledger — overall totals + per-month breakdown.
    // Also track counterpart groups (proportionally):
    //   drGroups: { groupName: amount } — Cr-side groups that funded this ledger's Dr entries
    //   crGroups: { groupName: amount } — Dr-side groups that absorbed this ledger's Cr entries
    const ledgerMap = new Map();

    const ensure = (name) => {
        if (!ledgerMap.has(name)) ledgerMap.set(name, { dr: 0, cr: 0, drGroups: {}, crGroups: {}, months: new Map() });
        return ledgerMap.get(name);
    };
    const ensureMonth = (rec, mk) => {
        if (!rec.months.has(mk)) rec.months.set(mk, { dr: 0, cr: 0, drGroups: {}, crGroups: {} });
        return rec.months.get(mk);
    };

    const voucherRegex = /<VOUCHER [^>]*>([\s\S]*?)<\/VOUCHER>/g;
    let vMatch;
    while ((vMatch = voucherRegex.exec(vouchersRaw)) !== null) {
        const body      = vMatch[1];
        const dateM     = body.match(/<DATE[^>]*>(\d{8})<\/DATE>/);
        const monthKey  = dateM ? dateM[1].substring(0, 6) : null;

        const entries    = [];
        const entryRegex = /<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g;
        let eMatch;
        while ((eMatch = entryRegex.exec(body)) !== null) {
            const ebody  = eMatch[1];
            const nameM  = ebody.match(/<LEDGERNAME[^>]*>([^<]+)<\/LEDGERNAME>/);
            const amtM   = ebody.match(/<AMOUNT[^>]*>([^<]+)<\/AMOUNT>/);
            const isDrM  = ebody.match(/<ISDEEMEDPOSITIVE[^>]*>([^<]+)<\/ISDEEMEDPOSITIVE>/);
            if (!nameM || !amtM) continue;
            const ledger = decodeXml(nameM[1].trim());
            const amount = Math.abs(parseFloat(amtM[1]) || 0);
            if (amount === 0) continue;
            const isDr   = (isDrM?.[1]?.trim() || 'No').toLowerCase() === 'yes';
            entries.push({ ledger, amount, isDr });
        }

        const drEntries = entries.filter(e =>  e.isDr);
        const crEntries = entries.filter(e => !e.isDr);
        const totalDr   = drEntries.reduce((s, e) => s + e.amount, 0);
        const totalCr   = crEntries.reduce((s, e) => s + e.amount, 0);

        // For each Dr entry: credit-side counterparts funded it (proportionally)
        for (const e of drEntries) {
            const rec    = ensure(e.ledger);
            const mon    = monthKey ? ensureMonth(rec, monthKey) : null;
            rec.dr      += e.amount;
            if (mon) mon.dr += e.amount;
            const share  = totalDr > 0 ? e.amount / totalDr : 1;
            for (const cp of crEntries) {
                const grp = parentMap.get(cp.ledger) || cp.ledger;
                const amt = cp.amount * share;
                rec.drGroups[grp] = (rec.drGroups[grp] || 0) + amt;
                if (mon) mon.drGroups[grp] = (mon.drGroups[grp] || 0) + amt;
            }
        }

        // For each Cr entry: debit-side counterparts absorbed it (proportionally)
        for (const e of crEntries) {
            const rec    = ensure(e.ledger);
            const mon    = monthKey ? ensureMonth(rec, monthKey) : null;
            rec.cr      += e.amount;
            if (mon) mon.cr += e.amount;
            const share  = totalCr > 0 ? e.amount / totalCr : 1;
            for (const cp of drEntries) {
                const grp = parentMap.get(cp.ledger) || cp.ledger;
                const amt = cp.amount * share;
                rec.crGroups[grp] = (rec.crGroups[grp] || 0) + amt;
                if (mon) mon.crGroups[grp] = (mon.crGroups[grp] || 0) + amt;
            }
        }
    }

    const data = { ledgerMap, parentMap };
    _voucherSummaryCache.set(cacheKey, { data, time: Date.now() });
    return data;
}

exports.getLedgerDetail = async (req, res, next) => {
    try {
        const { tallyUrl } = req;
        const { from, to, company } = resolvePeriod(req);
        const ledgerName = req.query.ledger;
        if (!ledgerName) return res.status(400).json({ success: false, error: 'ledger param required' });
        if (!from) return res.json({ success: true, data: null });

        const { ledgerMap, parentMap } = await _fetchVoucherSummary(from, to, company, tallyUrl);
        const parent = parentMap.get(ledgerName) || '';
        const entry  = ledgerMap.get(ledgerName) || { dr: 0, cr: 0, drGroups: {}, crGroups: {}, months: new Map() };
        const net    = entry.dr - entry.cr;

        const sortGroups = (obj) =>
            Object.entries(obj)
                .map(([name, amount]) => ({ name, amount }))
                .sort((a, b) => b.amount - a.amount);

        // Build full month sequence for the period (including zero-activity months)
        const months = _monthKeys(from, to).map(mk => {
            const md = entry.months.get(mk) || { dr: 0, cr: 0, drGroups: {}, crGroups: {} };
            const yr = parseInt(mk.substring(0, 4));
            const mo = parseInt(mk.substring(4, 6));
            return {
                month:    `${_MONTH_NAMES[mo]} ${yr}`,
                dr:       md.dr,
                cr:       md.cr,
                drGroups: sortGroups(md.drGroups),
                crGroups: sortGroups(md.crGroups),
            };
        });

        res.json({
            success: true,
            data: {
                name:        ledgerName,
                parent,
                dr:          entry.dr,
                cr:          entry.cr,
                drGroups:    sortGroups(entry.drGroups),
                crGroups:    sortGroups(entry.crGroups),
                net:         Math.abs(net),
                netIsDr:     net >= 0,
                hasActivity: entry.dr > 0 || entry.cr > 0,
                months,
                period:      { from, to }
            }
        });
    } catch (err) {
        next(err);
    }
};

exports.getLedgers = async (req, res, next) => {
    try {
        const { tallyUrl } = req;
        const company = req.query.company || null;
        const raw = await callTally(buildAllLedgersXML(company), 35000, tallyUrl);
        const ledgers = [];
        for (const m of raw.matchAll(/<LEDGER NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/g)) {
            const name = decodeXml(m[1]);
            const parentMatch = m[2].match(/<PARENT[^>]*>([^<]*)<\/PARENT>/);
            const parent = parentMatch ? decodeXml(parentMatch[1].trim()) : '';
            ledgers.push({ name, parent });
        }
        res.json({ success: true, data: { ledgers } });
    } catch (err) {
        next(err);
    }
};
