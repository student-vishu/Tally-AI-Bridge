const { callTally, fetchCostCategories, decodeXml } = require('./tally.services');
const { buildCostCentreHierarchyXML } = require('../templates/costcentre.xml');
const { buildCostCategorySummaryXML } = require('../templates/costcategorysummary.xml');
const { buildFYVouchersXML } = require('../templates/bankcash.xml');
const { parseCostCategorySummaryXML } = require('./parser.services');

// ─── Cost-centre hierarchy cache ─────────────────────────────────────────────
const _hierCaches = new Map();
const HIER_TTL    = 5 * 60 * 1000;

async function fetchCostCentreHierarchy(tallyUrl, company = null) {
    const cacheKey = `${tallyUrl}::${company || ''}`;
    const cached = _hierCaches.get(cacheKey);
    if (cached && (Date.now() - cached.time) < HIER_TTL) return cached.data;

    const raw = await callTally(buildCostCentreHierarchyXML(company), 35000, tallyUrl);
    const childrenMap = {};
    const parentMap   = {};

    for (const m of raw.matchAll(/<COSTCENTRE NAME="([^"]+)"[^>]*>([\s\S]*?)<\/COSTCENTRE>/g)) {
        const name   = decodeXml(m[1]);
        const pm     = m[2].match(/<PARENT[^>]*>([^<]*)<\/PARENT>/);
        const parent = pm ? decodeXml(pm[1].trim()) : '';
        if (parent) {
            parentMap[name] = parent;
            if (!childrenMap[parent]) childrenMap[parent] = [];
            childrenMap[parent].push(name);
        }
    }

    _hierCaches.set(cacheKey, { data: { childrenMap, parentMap }, time: Date.now() });
    return { childrenMap, parentMap };
}

// ─── Root-level period summary (main table + fallback) ────────────────────────
function parseCCSummary(raw) {
    const parsed = parseCostCategorySummaryXML(raw);
    const names  = [].concat(parsed?.ENVELOPE?.DSPACCNAME || []);
    const infos  = [].concat(parsed?.ENVELOPE?.DSPACCINFO || []);
    const totals = new Map();
    for (let i = 0; i < names.length; i++) {
        const name = names[i]?.DSPDISPNAME;
        if (!name) continue;
        const drAmt = parseFloat(infos[i]?.DSPDRAMT?.DSPDRAMTA || 0);
        const crAmt = parseFloat(infos[i]?.DSPCRAMT?.DSPCRAMTA || 0);
        totals.set(name, {
            debit:  drAmt < 0 ? Math.abs(drAmt) : 0,
            credit: crAmt > 0 ? crAmt            : 0
        });
    }
    return totals;
}

const _sumCaches    = new Map();
const _sumInflights = new Map();
const SUM_TTL       = 5 * 60 * 1000;

async function fetchPeriodSummary(from, to, tallyUrl, company = null) {
    const cacheKey = `root::${tallyUrl}::${from}::${to}::${company || ''}`;
    const cached = _sumCaches.get(cacheKey);
    if (cached && (Date.now() - cached.time) < SUM_TTL) return cached.data;
    if (_sumInflights.has(cacheKey)) return _sumInflights.get(cacheKey);

    const inflight = (async () => {
        try {
            const raw  = await callTally(buildCostCategorySummaryXML(from, to, company), 35000, tallyUrl);
            const data = parseCCSummary(raw);
            _sumCaches.set(cacheKey, { data, time: Date.now() });
            return data;
        } finally {
            _sumInflights.delete(cacheKey);
        }
    })();
    _sumInflights.set(cacheKey, inflight);
    return inflight;
}

// ─── Month helpers ────────────────────────────────────────────────────────────
const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORTS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function generateMonthSlots(from, to) {
    // Returns [{key:'202504', label:'April 2025', short:'Apr'}, …]
    const slots = [];
    let y = parseInt(from.substring(0, 4));
    let m = parseInt(from.substring(4, 6));
    const ey = parseInt(to.substring(0, 4));
    const em = parseInt(to.substring(4, 6));
    while (y < ey || (y === ey && m <= em)) {
        slots.push({ key: `${y}${String(m).padStart(2, '0')}`, label: `${MONTH_NAMES[m-1]} ${y}`, short: MONTH_SHORTS[m-1] });
        if (++m > 12) { m = 1; y++; }
    }
    return slots;
}

// ─── Parse CC allocations from FY Voucher Collection XML ─────────────────────
// Returns { monthlyMap, ledgerMap }
//   monthlyMap : Map<ccName, Map<YYYYMM, {debit, credit}>>
//   ledgerMap  : Map<ccName, Map<YYYYMM, Map<ledgerName, {debit, credit}>>>
// Sign convention (from transformer.services.js): +AMOUNT = Credit, -AMOUNT = Debit
function parseCCAllocationsFromVouchers(raw) {
    const monthlyMap   = new Map();
    const ledgerMap    = new Map();
    const voucherRegex = /<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g;
    let vMatch;

    while ((vMatch = voucherRegex.exec(raw)) !== null) {
        const vBody = vMatch[1];

        const dateM = vBody.match(/<DATE[^>]*>(\d{8})<\/DATE>/);
        if (!dateM) continue;
        const monthKey = dateM[1].substring(0, 6); // YYYYMM

        // Party/client name from the voucher-level field (reliable for Payment/Receipt)
        const partyM = vBody.match(/<PARTYLEDGERNAME[^>]*>([^<]+)<\/PARTYLEDGERNAME>/);
        const voucherParty = partyM ? decodeXml(partyM[1].trim()) : '';

        // Pre-scan all ledger entries for party fallback lookup
        const allVoucherEntries = [];
        const scanRegex = /<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g;
        let sMatch;
        while ((sMatch = scanRegex.exec(vBody)) !== null) {
            const lnM = sMatch[1].match(/<LEDGERNAME[^>]*>([^<]+)<\/LEDGERNAME>/);
            const amM = sMatch[1].match(/<AMOUNT[^>]*>([^<]+)<\/AMOUNT>/);
            if (lnM && amM) allVoucherEntries.push({
                ledger: decodeXml(lnM[1].trim()),
                amount: parseFloat(amM[1].trim()) || 0
            });
        }

        const entryRegex = /<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g;
        let eMatch;

        while ((eMatch = entryRegex.exec(vBody)) !== null) {
            const eBody    = eMatch[1];
            const ccBodies = [];

            // Extract ledger name for bifurcation
            const ledgerNameM = eBody.match(/<LEDGERNAME[^>]*>([^<]+)<\/LEDGERNAME>/);
            const ledger = ledgerNameM ? decodeXml(ledgerNameM[1].trim()) : 'Unknown';

            // Path 1: CATEGORYALLOCATIONS.LIST → COSTCENTREALLOCATIONS.LIST
            const catRegex = /<CATEGORYALLOCATIONS\.LIST>([\s\S]*?)<\/CATEGORYALLOCATIONS\.LIST>/g;
            let cMatch;
            while ((cMatch = catRegex.exec(eBody)) !== null) {
                const ccRegex = /<COSTCENTREALLOCATIONS\.LIST>([\s\S]*?)<\/COSTCENTREALLOCATIONS\.LIST>/g;
                let ccMatch;
                while ((ccMatch = ccRegex.exec(cMatch[1])) !== null) ccBodies.push(ccMatch[1]);
            }

            // Path 2: direct COSTCENTREALLOCATIONS.LIST (only if Path 1 found nothing)
            if (ccBodies.length === 0) {
                const ccRegex = /<COSTCENTREALLOCATIONS\.LIST>([\s\S]*?)<\/COSTCENTREALLOCATIONS\.LIST>/g;
                let ccMatch;
                while ((ccMatch = ccRegex.exec(eBody)) !== null) ccBodies.push(ccMatch[1]);
            }

            for (const ccBody of ccBodies) {
                const nameM = ccBody.match(/<NAME[^>]*>([^<]+)<\/NAME>/);
                const amtM  = ccBody.match(/<AMOUNT[^>]*>([^<]+)<\/AMOUNT>/);
                if (!nameM || !amtM) continue;
                const name   = decodeXml(nameM[1].trim());
                const amount = parseFloat(amtM[1].trim()) || 0;
                if (!name || amount === 0) continue;

                // Accumulate monthly totals
                if (!monthlyMap.has(name)) monthlyMap.set(name, new Map());
                const ccMonths = monthlyMap.get(name);
                const prev     = ccMonths.get(monthKey) || { debit: 0, credit: 0 };
                if (amount > 0) prev.credit += amount;
                else            prev.debit  += Math.abs(amount);
                ccMonths.set(monthKey, prev);

                // Determine effective party name:
                // - Use PARTYLEDGERNAME if present (reliable for Payment/Receipt)
                // - Otherwise fall back to the largest-amount opposite-side ledger entry
                //   (works for Journal, Payment without party, and custom voucher types)
                let party = voucherParty;
                if (!party) {
                    const isDebit = amount < 0; // CC entry is expense (Dr)
                    const opposite = allVoucherEntries.filter(e =>
                        isDebit ? e.amount > 0 : e.amount < 0
                    );
                    if (opposite.length > 0) {
                        party = opposite.reduce((a, b) =>
                            Math.abs(a.amount) > Math.abs(b.amount) ? a : b
                        ).ledger;
                    }
                }

                // Accumulate ledger-level bifurcation (keyed by ledger+party so same
                // ledger from two different parties stays as separate rows)
                if (!ledgerMap.has(name)) ledgerMap.set(name, new Map());
                const ccLedgerMonths = ledgerMap.get(name);
                if (!ccLedgerMonths.has(monthKey)) ccLedgerMonths.set(monthKey, new Map());
                const ledgerMonthMap = ccLedgerMonths.get(monthKey);
                const compositeKey   = `${ledger}||${party}`;
                const lprev = ledgerMonthMap.get(compositeKey) || { ledger, party, debit: 0, credit: 0 };
                if (amount > 0) lprev.credit += amount;
                else            lprev.debit  += Math.abs(amount);
                ledgerMonthMap.set(compositeKey, lprev);
            }
        }
    }

    return { monthlyMap, ledgerMap };
}

// ─── Build monthly items for a list of CC names ───────────────────────────────
// monthlyMap: Map<ccName, Map<YYYYMM, {debit, credit}>>  (from parseCCAllocationsFromVouchers)
// ledgerMap:  Map<ccName, Map<YYYYMM, Map<ledgerName, {debit, credit}>>>  (optional)
// namesToShow: ordered list of CC names to include
// Returns [{name, months[], grandDebit, grandCredit, closingBalance, closingDr}]
function buildMonthlyItems(monthlyMap, namesToShow, from, to, ledgerMap = null) {
    const slots = generateMonthSlots(from, to);
    const items = [];

    for (const name of namesToShow) {
        const ccMonths     = monthlyMap.get(name) || new Map();
        const ccLedgers    = ledgerMap?.get(name) || new Map();
        let grandDebit     = 0;
        let grandCredit    = 0;
        let runningBalance = 0; // positive = Dr, negative = Cr
        const months       = [];

        for (const slot of slots) {
            const { debit = 0, credit = 0 } = ccMonths.get(slot.key) || {};
            grandDebit     += debit;
            grandCredit    += credit;
            runningBalance += debit - credit;

            // Build ledger bifurcation entries for this month
            const entries = [];
            const ledgerMonthMap = ccLedgers.get(slot.key);
            if (ledgerMonthMap) {
                for (const entry of ledgerMonthMap.values()) {
                    if (entry.debit > 0 || entry.credit > 0) entries.push({ ...entry });
                }
                // Sort: debits first (desc), then credits (desc)
                entries.sort((a, b) => {
                    if (a.debit > 0 && b.debit > 0) return b.debit - a.debit;
                    if (a.debit > 0) return -1;
                    if (b.debit > 0) return 1;
                    return b.credit - a.credit;
                });
            }

            months.push({
                month:          slot.label,
                monthShort:     slot.short,
                debit,
                credit,
                closingBalance: Math.abs(runningBalance),
                closingDr:      runningBalance >= 0,
                entries
            });
        }

        const net = grandDebit - grandCredit;
        items.push({
            name,
            months,
            grandDebit,
            grandCredit,
            closingBalance: Math.abs(net),
            closingDr:      net >= 0
        });
    }

    return items;
}

// ─── CC allocation cache (monthly, from FY Voucher Collection) ────────────────
const _ccAllocCaches    = new Map();
const _ccAllocInflights = new Map();

async function fetchCCAllocations(from, to, tallyUrl, company = null) {
    const cacheKey = `cc::${tallyUrl}::${from}::${to}::${company || ''}`;
    const cached = _ccAllocCaches.get(cacheKey);
    if (cached && (Date.now() - cached.time) < SUM_TTL) return cached.data;
    if (_ccAllocInflights.has(cacheKey)) return _ccAllocInflights.get(cacheKey);

    const inflight = (async () => {
        try {
            const raw  = await callTally(buildFYVouchersXML(from, to, company), 35000, tallyUrl);
            const { monthlyMap, ledgerMap } = parseCCAllocationsFromVouchers(raw);
            console.log(`[ccAlloc] Parsed ${monthlyMap.size} cost centres from FY vouchers`);
            if (monthlyMap.size > 0) {
                const data = { monthlyMap, ledgerMap };
                _ccAllocCaches.set(cacheKey, { data, time: Date.now() });
                return data;
            }
            // Fallback: convert root-level Cost Category Summary into a monthly map
            // (all totals placed in a synthetic key so buildMonthlyItems still works)
            console.warn('[ccAlloc] No CC data in vouchers — falling back to Cost Category Summary');
            const flat = await fetchPeriodSummary(from, to, tallyUrl, company);
            const synth = new Map();
            for (const [name, { debit, credit }] of flat) {
                // Put the total in the last month of the period so closing balance is correct
                const lastKey = to.substring(0, 6); // YYYYMM of period end
                synth.set(name, new Map([[lastKey, { debit, credit }]]));
            }
            const data = { monthlyMap: synth, ledgerMap: new Map() };
            _ccAllocCaches.set(cacheKey, { data, time: Date.now() });
            return data;
        } catch (err) {
            console.warn('[ccAlloc] Voucher CC fetch failed, falling back:', err.message);
            const flat = await fetchPeriodSummary(from, to, tallyUrl, company);
            const synth = new Map();
            const lastKey = to.substring(0, 6);
            for (const [name, { debit, credit }] of flat) synth.set(name, new Map([[lastKey, { debit, credit }]]));
            return { monthlyMap: synth, ledgerMap: new Map() };
        } finally {
            _ccAllocInflights.delete(cacheKey);
        }
    })();
    _ccAllocInflights.set(cacheKey, inflight);
    return inflight;
}

// ─── All projects expand ──────────────────────────────────────────────────────
exports.fetchAllProjectsExpand = async (from, to, tallyUrl, company = null) => {
    const [{ childrenMap, parentMap }, costCategories, { monthlyMap: ccMonthlyMap, ledgerMap }] = await Promise.all([
        fetchCostCentreHierarchy(tallyUrl, company),
        fetchCostCategories(tallyUrl, company),
        fetchCCAllocations(from, to, tallyUrl, company)
    ]);

    const catSet = new Set(costCategories.map(c => c.toLowerCase()));

    // Find root cost centres from the monthly map
    const rootSet = new Set();
    for (const name of ccMonthlyMap.keys()) {
        if (catSet.has(name.toLowerCase())) continue;
        let current = name;
        while (true) {
            const parent = parentMap[current];
            if (!parent || catSet.has(parent.toLowerCase())) break;
            current = parent;
        }
        if (!catSet.has(current.toLowerCase())) rootSet.add(current);
    }

    const result = [];
    for (const projectName of rootSet) {
        const children    = (childrenMap[projectName] || []).filter(c => !catSet.has(c.toLowerCase()));
        const namesToShow = [projectName, ...children];
        const items       = buildMonthlyItems(ccMonthlyMap, namesToShow, from, to, ledgerMap)
            .filter(item => item.grandDebit > 0 || item.grandCredit > 0);
        if (items.length > 0) result.push({ project: projectName, from, to, items });
    }
    return result;
};

// ─── Pre-warm cache ───────────────────────────────────────────────────────────
exports.warmFYCache = async (from, tallyUrl, company = null) => {
    const year    = parseInt(from.substring(0, 4), 10);
    const month   = parseInt(from.substring(4, 6), 10);
    const fyStart = month >= 4 ? year : year - 1;
    const fyTo    = `${fyStart + 1}0331`;
    await fetchPeriodSummary(`${fyStart}0401`, fyTo, tallyUrl, company);
};

// ─── Single project expand ────────────────────────────────────────────────────
exports.fetchProjectExpand = async (projectName, from, to, tallyUrl, company = null) => {
    const [{ childrenMap }, costCategories, { monthlyMap: ccMonthlyMap, ledgerMap }] = await Promise.all([
        fetchCostCentreHierarchy(tallyUrl, company),
        fetchCostCategories(tallyUrl, company),
        fetchCCAllocations(from, to, tallyUrl, company)
    ]);

    const catSet      = new Set(costCategories.map(c => c.toLowerCase()));
    const children    = (childrenMap[projectName] || []).filter(c => !catSet.has(c.toLowerCase()));
    const namesToShow = [projectName, ...children];

    return buildMonthlyItems(ccMonthlyMap, namesToShow, from, to, ledgerMap);
};
