const { callTally, fetchCostCategories, decodeXml } = require('./tally.services');
const { buildCostCentreHierarchyXML } = require('../templates/costcentre.xml');
const { buildCostCategorySummaryMonthXML } = require('../templates/costcategorysummary.xml');
const { parseCostCategorySummaryXML } = require('./parser.services');

// ─── Month helpers ────────────────────────────────────────────────────────────
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

function fyMonthKeys(fyStart) {
    const keys = [];
    for (let m = 4; m <= 12; m++) keys.push(`${fyStart}${String(m).padStart(2, '0')}`);
    for (let m = 1; m <= 3;  m++) keys.push(`${fyStart + 1}${String(m).padStart(2, '0')}`);
    return keys;
}

// Per-month date ranges for the FY.
//
// Tally's Cost Category Summary has a rendering bug for 30/28-day months
// (Apr, Jun, Sep, Nov, Feb): it ignores the date range and returns an inflated
// or full-year value. 31-day months (May, Jul, Aug, Oct, Dec, Jan, Mar) work correctly.
//
// Fix for 30/28-day months: extend the query TO the end of the following 31-day month,
// then subtract that next month's value to isolate the problematic month.
// Every 30/28-day FY month is immediately followed by a 31-day month, so this always works.
function fyMonthRanges(fyStart) {
    const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
    const nextMo = (y, m) => m === 12 ? [y + 1, 1] : [y, m + 1];

    const rawMonths = [
        [fyStart,   4], [fyStart,   5], [fyStart,   6],
        [fyStart,   7], [fyStart,   8], [fyStart,   9],
        [fyStart,  10], [fyStart,  11], [fyStart,  12],
        [fyStart+1, 1], [fyStart+1, 2], [fyStart+1, 3]
    ];

    return rawMonths.map(([y, m]) => {
        const days = daysInMonth(y, m);
        const mm   = String(m).padStart(2, '0');
        const mk   = `${y}${mm}`;
        const from = `${y}${mm}01`;

        if (days === 31) {
            // 31-day month: direct query works correctly
            return { mk, from, to: `${y}${mm}31`, subtractMK: null };
        }

        // 30/28-day month: extend to end of next 31-day month and flag for subtraction
        const [ny, nm] = nextMo(y, m);
        const nmm      = String(nm).padStart(2, '0');
        const subtractMK = `${ny}${nmm}`;
        return { mk, from, to: `${ny}${nmm}31`, subtractMK };
    });
}

// ─── Cost-centre hierarchy cache ─────────────────────────────────────────────
let _hierCache   = null;
let _hierCacheAt = 0;
const HIER_TTL   = 5 * 60 * 1000;

async function fetchCostCentreHierarchy() {
    if (_hierCache && (Date.now() - _hierCacheAt) < HIER_TTL) return _hierCache;

    const raw = await callTally(buildCostCentreHierarchyXML());
    const childrenMap = {};
    const parentMap   = {};

    for (const m of raw.matchAll(/<COSTCENTRE NAME="([^"]+)"[^>]*>([\s\S]*?)<\/COSTCENTRE>/g)) {
        const name = decodeXml(m[1]);
        const pm   = m[2].match(/<PARENT[^>]*>([^<]*)<\/PARENT>/);
        const parent = pm ? decodeXml(pm[1].trim()) : '';
        if (parent) {
            parentMap[name] = parent;
            if (!childrenMap[parent]) childrenMap[parent] = [];
            childrenMap[parent].push(name);
        }
    }

    _hierCache   = { childrenMap, parentMap };
    _hierCacheAt = Date.now();
    return _hierCache;
}

// ─── Parse Cost Category Summary XML → Map<ccName, {debit, credit}> ──────────
function parseCCSummaryToMap(xml) {
    const parsed = parseCostCategorySummaryXML(xml);
    const names  = [].concat(parsed?.ENVELOPE?.DSPACCNAME || []);
    const infos  = [].concat(parsed?.ENVELOPE?.DSPACCINFO || []);
    const map    = new Map();
    for (let i = 0; i < names.length; i++) {
        const name = names[i]?.DSPDISPNAME;
        if (!name) continue;
        const dr = Math.abs(parseFloat(infos[i]?.DSPDRAMT?.DSPDRAMTA || 0));
        const cr = Math.abs(parseFloat(infos[i]?.DSPCRAMT?.DSPCRAMTA || 0));
        if (dr > 0 || cr > 0) map.set(name, { debit: dr, credit: cr });
    }
    return map;
}

// ─── Reliability filter ───────────────────────────────────────────────────────
// Tally's Cost Category Summary returns the full-year total for certain months
// (e.g. Jun, Sep — likely a Tally quarter-end rendering quirk).  When that
// happens the monthly debit equals the annual debit, inflating the sum.
// Fix: greedily remove the largest months until sum ≤ yearTotal × 1.05.
// For credit ties, prefer removing months already flagged bad on the debit side.
function applyReliabilityFilter(rawMonthly, yearDebit, yearCredit) {
    const months = Object.keys(rawMonthly);
    if (months.length === 0) return {};

    let badMonths = new Set();

    // ── Debit pass ────────────────────────────────────────────────────────────
    const sumD = months.reduce((s, mk) => s + (rawMonthly[mk].debit || 0), 0);
    if (yearDebit > 0 && sumD > yearDebit * 1.05) {
        const sorted = [...months].sort(
            (a, b) => (rawMonthly[b].debit || 0) - (rawMonthly[a].debit || 0)
        );
        let running = sumD;
        for (const mk of sorted) {
            if (running <= yearDebit * 1.05) break;
            running -= rawMonthly[mk].debit || 0;
            badMonths.add(mk);
        }
    }

    // ── Credit pass (prefer removing already-bad months first) ───────────────
    const sumC = months.reduce((s, mk) => s + (rawMonthly[mk].credit || 0), 0);
    if (yearCredit > 0 && sumC > yearCredit * 1.05) {
        const sorted = [...months].sort((a, b) => {
            const aB = badMonths.has(a) ? 1 : 0;
            const bB = badMonths.has(b) ? 1 : 0;
            if (aB !== bB) return bB - aB; // bad months first
            return (rawMonthly[b].credit || 0) - (rawMonthly[a].credit || 0);
        });
        let running = sumC;
        for (const mk of sorted) {
            if (running <= yearCredit * 1.05) break;
            running -= rawMonthly[mk].credit || 0;
            badMonths.add(mk);
        }
    }

    const result = {};
    for (const mk of months) {
        if (!badMonths.has(mk)) result[mk] = rawMonthly[mk];
    }
    return result;
}

// ─── FY-level monthly CC data cache ──────────────────────────────────────────
let _cbCache    = null;
let _cbCacheKey = null;
let _cbCacheAt  = 0;
const CB_TTL    = 5 * 60 * 1000;
let _cbInflight = null;

async function fetchFYMonthlyData(fyStart) {
    const cacheKey = String(fyStart);
    if (_cbCache && _cbCacheKey === cacheKey && (Date.now() - _cbCacheAt) < CB_TTL) {
        return _cbCache;
    }
    if (_cbInflight) return _cbInflight;

    _cbInflight = (async () => {
        try {
            return await _doFetchFYMonthlyData(fyStart, cacheKey);
        } finally {
            _cbInflight = null;
        }
    })();
    return _cbInflight;
}

async function _doFetchFYMonthlyData(fyStart, cacheKey) {
    const fyFrom = `${fyStart}0401`;
    const fyTo   = `${fyStart + 1}0331`;
    const ranges = fyMonthRanges(fyStart);

    console.log(`[CostCentre] Cost Category Summary FY ${fyStart} — 13 calls (1 annual + 12 monthly)`);

    // Full-year totals — used as reference for the reliability filter fallback
    const yearXml = await callTally(buildCostCategorySummaryMonthXML(fyFrom, fyTo), 30000);
    const yearMap = parseCCSummaryToMap(yearXml);
    console.log(`[CostCentre] annual snapshot: ${yearMap.size} cost centres`);

    // 12 monthly/combined snapshots (sequential — Tally is single-threaded)
    // snaps: Map<mk, Map<ccName, {debit, credit}>>
    const snaps = new Map();
    for (let i = 0; i < ranges.length; i++) {
        const { mk, from, to } = ranges[i];
        console.log(`[CCS] month ${i + 1}/12 ${mk} → ${from}–${to}`);
        const xml = await callTally(buildCostCategorySummaryMonthXML(from, to), 30000);
        snaps.set(mk, parseCCSummaryToMap(xml));
    }

    // Collect all CC names across all snapshots
    const allCC = new Set(yearMap.keys());
    for (const map of snaps.values()) map.forEach((_, k) => allCC.add(k));

    // Build per-CC monthly data
    const ccMonthly = new Map();

    for (const ccName of allCC) {
        const rawMonthly = {};

        for (const { mk, subtractMK } of ranges) {
            const snapMap = snaps.get(mk);
            const v = snapMap?.get(ccName);
            if (!v || (v.debit === 0 && v.credit === 0)) continue;

            if (!subtractMK) {
                // 31-day direct month — value is correct as-is
                rawMonthly[mk] = v;
            } else {
                // 30/28-day month: combined query ending on next 31-day month.
                // Subtract the next month's value to isolate this month.
                const nextMap = snaps.get(subtractMK);
                const nxt = nextMap?.get(ccName) || { debit: 0, credit: 0 };
                const debit  = v.debit  - nxt.debit;
                const credit = v.credit - nxt.credit;
                if (debit > 0 || credit > 0) {
                    rawMonthly[mk] = {
                        debit:  debit  > 0 ? debit  : 0,
                        credit: credit > 0 ? credit : 0
                    };
                }
            }
        }

        // Apply reliability filter as a safety net for any remaining inflated values
        const { debit: yD = 0, credit: yC = 0 } = yearMap.get(ccName) || {};
        const reliable = applyReliabilityFilter(rawMonthly, yD, yC);
        if (Object.keys(reliable).length > 0) ccMonthly.set(ccName, reliable);
    }

    console.log(`[CostCentre] monthly data ready for ${ccMonthly.size} cost centres`);

    _cbCache    = ccMonthly;
    _cbCacheKey = cacheKey;
    _cbCacheAt  = Date.now();
    return ccMonthly;
}

// ─── Build month rows for one cost centre ────────────────────────────────────
function buildMonthlyData(monthlyMap, fyStart) {
    const months = [];
    let running = 0, grandDebit = 0, grandCredit = 0;

    for (const mk of fyMonthKeys(fyStart)) {
        const { debit = 0, credit = 0 } = monthlyMap[mk] || {};
        if (debit === 0 && credit === 0) continue;

        const yr  = parseInt(mk.substring(0, 4), 10);
        const mon = parseInt(mk.substring(4, 6), 10);
        running += debit - credit;
        grandDebit  += debit;
        grandCredit += credit;

        months.push({
            month:          `${MONTH_NAMES[mon]} ${yr}`,
            monthShort:     MONTH_NAMES[mon],
            debit,
            credit,
            closingBalance: Math.abs(running),
            closingDr:      running >= 0
        });
    }

    return { months, grandDebit, grandCredit, closingBalance: Math.abs(running), closingDr: running >= 0 };
}

// ─── All projects expand (single call, shared cache) ─────────────────────────
exports.fetchAllProjectsExpand = async (from, to) => {
    const fyStart = parseInt(from.substring(0, 4), 10);

    const [{ childrenMap }, costCategories, ccMonthly] = await Promise.all([
        fetchCostCentreHierarchy(),
        fetchCostCategories(),
        fetchFYMonthlyData(fyStart)
    ]);

    const catSet = new Set(costCategories.map(c => c.toLowerCase()));

    // Top-level cost centres = keys in childrenMap that are not cost categories
    const allProjects = [...ccMonthly.keys()].filter(name => !catSet.has(name.toLowerCase()));

    const result = [];
    for (const projectName of allProjects) {
        const children    = (childrenMap[projectName] || []).filter(c => !catSet.has(c.toLowerCase()));
        const namesToShow = [projectName, ...children];
        const items       = [];
        for (const name of namesToShow) {
            const monthlyMap = ccMonthly.get(name) || {};
            const data = buildMonthlyData(monthlyMap, fyStart);
            if (data.grandDebit > 0 || data.grandCredit > 0) {
                items.push({ name, ...data });
            }
        }
        if (items.length > 0) result.push({ project: projectName, from, to, items });
    }
    return result;
};

// ─── Pre-warm cache only (no response data needed) ───────────────────────────
exports.warmFYCache = async (from) => {
    const fyStart = parseInt(from.substring(0, 4), 10);
    await fetchFYMonthlyData(fyStart);
};

// ─── Main export ──────────────────────────────────────────────────────────────
exports.fetchProjectExpand = async (projectName, from, to) => {
    const fyStart = parseInt(from.substring(0, 4), 10);

    const [{ childrenMap }, costCategories, ccMonthly] = await Promise.all([
        fetchCostCentreHierarchy(),
        fetchCostCategories(),
        fetchFYMonthlyData(fyStart)
    ]);

    const catSet      = new Set(costCategories.map(c => c.toLowerCase()));
    const children    = (childrenMap[projectName] || []).filter(c => !catSet.has(c.toLowerCase()));
    const namesToShow = [projectName, ...children];

    const items = [];
    for (const name of namesToShow) {
        const monthlyMap = ccMonthly.get(name) || {};
        const data = buildMonthlyData(monthlyMap, fyStart);
        if (data.grandDebit > 0 || data.grandCredit > 0) {
            items.push({ name, ...data });
        }
    }

    return items;
};
