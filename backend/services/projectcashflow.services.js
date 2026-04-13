const { callTally, fetchCostCategories, decodeXml } = require('./tally.services');
const { buildCostCentreHierarchyXML, buildCostCentreVouchersXML } = require('../templates/costcentre.xml');
const { parseXML } = require('./parser.services');

// ─── Month helpers ────────────────────────────────────────────────────────────
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

function fyMonthKeys(fyStart) {
    const keys = [];
    for (let m = 4; m <= 12; m++) keys.push(`${fyStart}${String(m).padStart(2, '0')}`);
    for (let m = 1; m <= 3;  m++) keys.push(`${fyStart + 1}${String(m).padStart(2, '0')}`);
    return keys;
}

// ─── Cost-centre hierarchy cache (per Tally URL + company) ───────────────────
const _hierCaches = new Map(); // `${tallyUrl}::${company}` → { data, time }
const HIER_TTL    = 5 * 60 * 1000;

async function fetchCostCentreHierarchy(tallyUrl, company = null) {
    const cacheKey = `${tallyUrl}::${company || ''}`;
    const cached = _hierCaches.get(cacheKey);
    if (cached && (Date.now() - cached.time) < HIER_TTL) return cached.data;

    const raw = await callTally(buildCostCentreHierarchyXML(company), 35000, tallyUrl);
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

    _hierCaches.set(`${tallyUrl}::${company || ''}`, { data: { childrenMap, parentMap }, time: Date.now() });
    return { childrenMap, parentMap };
}

// ─── FY-level monthly CC data cache (per Tally URL + company) ────────────────
const _cbCaches    = new Map(); // `${tallyUrl}::${fyStart}::${company}` → { data, time }
const _cbInflights = new Map(); // same key → Promise
const CB_TTL       = 5 * 60 * 1000;

async function fetchFYMonthlyData(fyStart, tallyUrl, company = null) {
    const cacheKey = `${tallyUrl}::${fyStart}::${company || ''}`;
    const cached = _cbCaches.get(cacheKey);
    if (cached && (Date.now() - cached.time) < CB_TTL) {
        return cached.data;
    }
    if (_cbInflights.has(cacheKey)) return _cbInflights.get(cacheKey);

    const inflight = (async () => {
        try {
            return await _doFetchFYMonthlyData(fyStart, cacheKey, tallyUrl, company);
        } finally {
            _cbInflights.delete(cacheKey);
        }
    })();
    _cbInflights.set(cacheKey, inflight);
    return inflight;
}

async function _doFetchFYMonthlyData(fyStart, cacheKey, tallyUrl, company = null) {
    const fyFrom = `${fyStart}0401`;
    const fyTo   = `${fyStart + 1}0331`;

    console.log(`[CostCentre] Day Book export FY ${fyStart} (${fyFrom} → ${fyTo})`);
    const raw = await callTally(buildCostCentreVouchersXML(fyFrom, fyTo, company), 120000, tallyUrl);

    // Day Book returns TALLYMESSAGE format — same structure transformProjectCashFlow expects
    const parsed   = parseXML(raw);
    const messages = [].concat(parsed?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE || []);

    const ccMonthly = new Map();
    let voucherCount = 0;
    let ccEntryCount = 0;

    for (const msg of messages) {
        const voucher = msg.VOUCHER;
        if (!voucher) continue;
        voucherCount++;

        const dateStr = String(voucher.DATE || '');
        if (dateStr.length < 8) continue;
        const monthKey = dateStr.substring(0, 6);

        const entries = [].concat(voucher['ALLLEDGERENTRIES.LIST'] || []);

        for (const entry of entries) {
            // Collect cost centre allocations from BOTH paths:
            //   Path 1 — named categories: entry → CATEGORYALLOCATIONS.LIST → COSTCENTREALLOCATIONS.LIST
            //   Path 2 — primary category: entry → COSTCENTREALLOCATIONS.LIST (direct)
            const costCentres = [];
            const catAllocs = [].concat(entry['CATEGORYALLOCATIONS.LIST'] || []);
            for (const cat of catAllocs) {
                costCentres.push(...[].concat(cat['COSTCENTREALLOCATIONS.LIST'] || []));
            }
            if (costCentres.length === 0) {
                costCentres.push(...[].concat(entry['COSTCENTREALLOCATIONS.LIST'] || []));
            }

            for (const cc of costCentres) {
                const ccName = String(cc.NAME || '').trim();
                // In Tally TALLYMESSAGE: positive AMOUNT = credit, negative = debit
                const amount = parseFloat(cc.AMOUNT || 0);
                if (!ccName || amount === 0) continue;

                if (!ccMonthly.has(ccName)) ccMonthly.set(ccName, {});
                const monthlyMap = ccMonthly.get(ccName);
                if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { debit: 0, credit: 0 };

                if (amount < 0) monthlyMap[monthKey].debit  += Math.abs(amount);
                else            monthlyMap[monthKey].credit += amount;
                ccEntryCount++;
            }
        }
    }

    console.log(`[CostCentre] ${voucherCount} vouchers, ${ccEntryCount} CC allocations, ${ccMonthly.size} cost centres`);
    _cbCaches.set(cacheKey, { data: ccMonthly, time: Date.now() });
    return ccMonthly;
}

// ─── Build month rows for one cost centre ────────────────────────────────────
function buildMonthlyData(monthlyMap, fyStart, from, to) {
    const months = [];
    let running = 0, grandDebit = 0, grandCredit = 0;
    const fromKey = from ? from.substring(0, 6) : null;
    const toKey   = to   ? to.substring(0, 6)   : null;

    for (const mk of fyMonthKeys(fyStart)) {
        if (fromKey && mk < fromKey) continue;
        if (toKey   && mk > toKey)   continue;
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
exports.fetchAllProjectsExpand = async (from, to, tallyUrl, company = null) => {
    const year = parseInt(from.substring(0, 4), 10);
    const month = parseInt(from.substring(4, 6), 10);
    const fyStart = month >= 4 ? year : year - 1;

    const [{ childrenMap, parentMap }, costCategories, ccMonthly] = await Promise.all([
        fetchCostCentreHierarchy(tallyUrl, company),
        fetchCostCategories(tallyUrl, company),
        fetchFYMonthlyData(fyStart, tallyUrl, company)
    ]);

    const catSet = new Set(costCategories.map(c => c.toLowerCase()));

    // Walk each voucher-data cost centre up to its root, so parent cost centres (e.g. "Admin")
    // appear as projects even when all transactions are booked to their children (ADMIN EXP, EHQ…).
    const rootSet = new Set();
    for (const name of ccMonthly.keys()) {
        if (catSet.has(name.toLowerCase())) continue;
        let current = name;
        while (true) {
            const parent = parentMap[current];
            if (!parent || catSet.has(parent.toLowerCase())) break;
            current = parent;
        }
        if (!catSet.has(current.toLowerCase())) rootSet.add(current);
    }
    const allProjects = [...rootSet];

    const result = [];
    for (const projectName of allProjects) {
        const children    = (childrenMap[projectName] || []).filter(c => !catSet.has(c.toLowerCase()));
        const namesToShow = [projectName, ...children];
        const items       = [];
        for (const name of namesToShow) {
            const monthlyMap = ccMonthly.get(name) || {};
            const data = buildMonthlyData(monthlyMap, fyStart, from, to);
            if (data.grandDebit > 0 || data.grandCredit > 0) {
                items.push({ name, ...data });
            }
        }
        if (items.length > 0) result.push({ project: projectName, from, to, items });
    }
    return result;
};

// ─── Pre-warm cache only (no response data needed) ───────────────────────────
exports.warmFYCache = async (from, tallyUrl, company = null) => {
    const year = parseInt(from.substring(0, 4), 10);
    const month = parseInt(from.substring(4, 6), 10);
    const fyStart = month >= 4 ? year : year - 1;
    await fetchFYMonthlyData(fyStart, tallyUrl, company);
};

// ─── Main export ──────────────────────────────────────────────────────────────
exports.fetchProjectExpand = async (projectName, from, to, tallyUrl, company = null) => {
    const year = parseInt(from.substring(0, 4), 10);
    const month = parseInt(from.substring(4, 6), 10);
    const fyStart = month >= 4 ? year : year - 1;

    const [{ childrenMap }, costCategories, ccMonthly] = await Promise.all([
        fetchCostCentreHierarchy(tallyUrl, company),
        fetchCostCategories(tallyUrl, company),
        fetchFYMonthlyData(fyStart, tallyUrl, company)
    ]);

    const catSet      = new Set(costCategories.map(c => c.toLowerCase()));
    const children    = (childrenMap[projectName] || []).filter(c => !catSet.has(c.toLowerCase()));
    const namesToShow = [projectName, ...children];

    // Include all names from the hierarchy — even those with no data in this period.
    // Filtering by grandDebit/grandCredit caused children to disappear when they had
    // no transactions in the selected FY, leaving only the project itself visible.
    const items = namesToShow.map(name => {
        const monthlyMap = ccMonthly.get(name) || {};
        const data = buildMonthlyData(monthlyMap, fyStart, from, to);
        return { name, ...data };
    });

    return items;
};
