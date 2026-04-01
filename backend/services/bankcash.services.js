const { callTally } = require('./tally.services');
const { buildBankCashLedgersXML, buildFYVouchersXML, buildGroupsXML } = require('../templates/bankcash.xml');

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------------------
// CLASSIFICATION — Tally Group Tree Traversal
// Walk up the group parent tree until a known primary group is found.
// Only "Duties & Taxes" needs a ledger-name check (GST Input vs GST Payable).
// Works for any company — no per-company keyword tuning needed.
// ---------------------------------------------------------------------------
const PRIMARY_GROUP_MAP = {
    'sales accounts':           'Income',
    'direct income':            'Income',
    'indirect income':          'Income',
    'purchase accounts':        'Expense',
    'direct expenses':          'Expense',
    'indirect expenses':        'Expense',
    'bank accounts':            'Transfer',
    'cash-in-hand':             'Transfer',
    'bank od a/c':              'Transfer',
    'branch / divisions':       'Transfer',
    'sundry debtors':           'Asset',
    'fixed assets':             'Asset',
    'investments':              'Asset',
    'loans & advances (asset)': 'Asset',
    'current assets':           'Asset',
    'stock-in-hand':            'Asset',
    'deposits (asset)':         'Asset',
    'misc. expenses (asset)':   'Asset',
    'capital account':          'Liability',
    'reserves & surplus':       'Liability',
    'loans (liability)':        'Liability',
    'secured loans':            'Liability',
    'unsecured loans':          'Liability',
    'current liabilities':      'Liability',
    'sundry creditors':         'Liability',
    'provisions':               'Liability',
    'duties & taxes':           'DUTIES_TAXES',  // resolved by ledger name below
};

function resolveCategory(ledgerName, ledgerGroup, groupParentMap) {
    const n = (ledgerName || '').toLowerCase().trim();
    let g = (ledgerGroup  || '').toLowerCase().trim();

    for (let i = 0; i < 10; i++) {
        const mapped = PRIMARY_GROUP_MAP[g];
        if (mapped === 'DUTIES_TAXES') {
            return (n.includes('input') || n.includes('receivable') || n.includes('itc'))
                ? 'Asset' : 'Liability';
        }
        if (mapped) return mapped;

        const parent = groupParentMap[g];
        if (!parent || parent === g || parent === 'primary' || parent === '') break;
        g = parent;
    }

    return 'Liability'; // last resort
}

// ---------------------------------------------------------------------------

function parseOpeningBalance(str) {
    if (!str || str === '0' || str === '0.00') return { amount: 0, isDr: true };
    const s = String(str).trim().replace(/,/g, '');
    const val = parseFloat(s);
    if (isNaN(val)) return { amount: 0, isDr: true };
    return { amount: Math.abs(val), isDr: val < 0 };
}

function getFYMonthKeys(fromDate) {
    const fyStart = parseInt(fromDate.substring(0, 4), 10);
    const keys = [];
    for (let m = 4; m <= 12; m++) keys.push(`${fyStart}${String(m).padStart(2, '0')}`);
    for (let m = 1; m <= 3; m++)  keys.push(`${fyStart + 1}${String(m).padStart(2, '0')}`);
    return keys;
}

function emptyEntries() {
    const blank = () => ({ Income: {}, Expense: {}, Asset: {}, Liability: {}, Transfer: {} });
    return { debit: blank(), credit: blank() };
}

// ---------------------------------------------------------------------------
// Parse voucher XML → monthly totals + classified counterpart entries per ledger
// Entries are split into debit-side and credit-side with proportional amounts
// so that sum(debit category totals) = month debit, sum(credit category totals) = month credit
// ---------------------------------------------------------------------------
function parseVoucherCollection(raw, bankCashLedgers, ledgerGroupMap, groupParentMap) {
    const monthData   = {};
    const bankCashSet = new Set(bankCashLedgers);
    for (const name of bankCashLedgers) monthData[name] = {};

    const voucherRegex = /<VOUCHER [^>]*>([\s\S]*?)<\/VOUCHER>/g;
    let vMatch;
    let voucherCount = 0;

    while ((vMatch = voucherRegex.exec(raw)) !== null) {
        const body = vMatch[1];
        voucherCount++;

        const dateMatch = body.match(/<DATE[^>]*>(\d{8})<\/DATE>/);
        if (!dateMatch) continue;
        const monthKey = dateMatch[1].substring(0, 6);

        // Parse every ledger entry in this voucher
        const allEntries = [];
        const entryRegex = /<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g;
        let eMatch;
        while ((eMatch = entryRegex.exec(body)) !== null) {
            const ebody = eMatch[1];
            const nameMatch = ebody.match(/<LEDGERNAME[^>]*>([^<]+)<\/LEDGERNAME>/);
            const amtMatch  = ebody.match(/<AMOUNT[^>]*>([^<]+)<\/AMOUNT>/);
            const isDrMatch = ebody.match(/<ISDEEMEDPOSITIVE[^>]*>([^<]+)<\/ISDEEMEDPOSITIVE>/);
            if (!nameMatch || !amtMatch) continue;
            const ledger = nameMatch[1].trim();
            const amount = Math.abs(parseFloat(amtMatch[1]) || 0);
            if (amount === 0) continue;
            const isDr = (isDrMatch?.[1]?.trim() || 'No').toLowerCase() === 'yes';
            allEntries.push({ ledger, amount, isDr });
        }

        // Split entries: bank/cash vs non-bank, and by Dr/Cr side
        const bankDrEntries    = allEntries.filter(e => bankCashSet.has(e.ledger) &&  e.isDr);
        const bankCrEntries    = allEntries.filter(e => bankCashSet.has(e.ledger) && !e.isDr);
        const nonBankDrEntries = allEntries.filter(e => !bankCashSet.has(e.ledger) &&  e.isDr);
        const nonBankCrEntries = allEntries.filter(e => !bankCashSet.has(e.ledger) && !e.isDr);

        const totalBankDr = bankDrEntries.reduce((s, e) => s + e.amount, 0);
        const totalBankCr = bankCrEntries.reduce((s, e) => s + e.amount, 0);

        // ── Bank DEBIT entries (money IN) ──
        // Counterparts = non-bank Cr entries (source of money) + other bank Cr (Transfer)
        for (const entry of bankDrEntries) {
            if (!monthData[entry.ledger][monthKey])
                monthData[entry.ledger][monthKey] = { debit: 0, credit: 0, entries: emptyEntries() };

            monthData[entry.ledger][monthKey].debit += entry.amount;

            const share  = totalBankDr > 0 ? entry.amount / totalBankDr : 1;
            const catMap = monthData[entry.ledger][monthKey].entries.debit;

            for (const cp of nonBankCrEntries) {
                const cat = resolveCategory(cp.ledger, ledgerGroupMap[cp.ledger] || '', groupParentMap);
                catMap[cat][cp.ledger] = (catMap[cat][cp.ledger] || 0) + cp.amount * share;
            }
            for (const cp of bankCrEntries) {
                catMap['Transfer'][cp.ledger] = (catMap['Transfer'][cp.ledger] || 0) + cp.amount * share;
            }
        }

        // ── Bank CREDIT entries (money OUT) ──
        // Counterparts = non-bank Dr entries (destination of money) + other bank Dr (Transfer)
        for (const entry of bankCrEntries) {
            if (!monthData[entry.ledger][monthKey])
                monthData[entry.ledger][monthKey] = { debit: 0, credit: 0, entries: emptyEntries() };

            monthData[entry.ledger][monthKey].credit += entry.amount;

            const share  = totalBankCr > 0 ? entry.amount / totalBankCr : 1;
            const catMap = monthData[entry.ledger][monthKey].entries.credit;

            for (const cp of nonBankDrEntries) {
                const cat = resolveCategory(cp.ledger, ledgerGroupMap[cp.ledger] || '', groupParentMap);
                catMap[cat][cp.ledger] = (catMap[cat][cp.ledger] || 0) + cp.amount * share;
            }
            for (const cp of bankDrEntries) {
                catMap['Transfer'][cp.ledger] = (catMap['Transfer'][cp.ledger] || 0) + cp.amount * share;
            }
        }
    }

    console.log(`[BankCash] Parsed ${voucherCount} vouchers`);
    return monthData;
}

// ---------------------------------------------------------------------------

exports.fetchBankCashData = async (fromDate, toDate) => {
    console.log('[BankCash] Fetching', fromDate, '->', toDate);

    const ledgersRaw = await callTally(buildBankCashLedgersXML());

    const BANK_CASH_GROUPS = new Set(['Bank Accounts', 'Cash-in-Hand']);
    const ledgerMatches = [...ledgersRaw.matchAll(/<LEDGER NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/g)];
    console.log('[BankCash] All ledgers:', ledgerMatches.length);

    const ledgerMap        = {};
    const allLedgerGroupMap = {};   // every ledger → its Tally parent group

    for (const m of ledgerMatches) {
        const name = m[1];
        const body = m[2];
        const parentMatch = body.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/);
        const balMatch    = body.match(/<OPENINGBALANCE[^>]*>([^<]*)<\/OPENINGBALANCE>/);
        const parent = parentMatch ? parentMatch[1].trim() : '';

        allLedgerGroupMap[name] = parent;

        if (!BANK_CASH_GROUPS.has(parent)) continue;

        const { amount: openAmt, isDr: openIsDr } = parseOpeningBalance(balMatch ? balMatch[1] : '0');
        ledgerMap[name] = { name, group: parent, openingBalance: openAmt, openingDr: openIsDr };
    }

    const bankCashNames = Object.keys(ledgerMap);
    console.log('[BankCash] Bank/Cash ledgers:', bankCashNames.join(', ') || 'none');
    if (!bankCashNames.length) return { ledgers: [] };

    // Fetch group parent tree — enables resolving custom groups to primary groups
    const groupsRaw = await callTally(buildGroupsXML());
    const groupParentMap = {};
    for (const m of groupsRaw.matchAll(/<GROUP NAME="([^"]+)"[^>]*>([\s\S]*?)<\/GROUP>/g)) {
        const parentMatch = m[2].match(/<PARENT[^>]*>([^<]*)<\/PARENT>/);
        if (parentMatch) groupParentMap[m[1].toLowerCase().trim()] = parentMatch[1].toLowerCase().trim();
    }
    console.log('[BankCash] Groups fetched:', Object.keys(groupParentMap).length);

    const vouchersRaw = await callTally(buildFYVouchersXML(fromDate, toDate));
    const monthData   = parseVoucherCollection(vouchersRaw, bankCashNames, allLedgerGroupMap, groupParentMap);

    const fyMonthKeys = getFYMonthKeys(fromDate);

    const ledgers = bankCashNames.map(name => {
        const l = ledgerMap[name];
        let runningBalance = l.openingDr ? l.openingBalance : -l.openingBalance;
        let grandDebit = 0, grandCredit = 0;

        const months = fyMonthKeys.map(mk => {
            const data = monthData[name]?.[mk] || { debit: 0, credit: 0, entries: emptyEntries() };
            runningBalance += data.debit - data.credit;
            grandDebit  += data.debit;
            grandCredit += data.credit;

            const yr  = parseInt(mk.substring(0, 4), 10);
            const mon = parseInt(mk.substring(4, 6), 10);
            return {
                month: `${MONTH_NAMES[mon]} ${yr}`,
                debit: data.debit,
                credit: data.credit,
                closingBalance: Math.abs(runningBalance),
                closingDr: runningBalance >= 0,
                entries: data.entries
            };
        });

        console.log(`[BankCash] ${name}: months with data = ${fyMonthKeys.filter(mk => monthData[name]?.[mk]).length}/12`);

        return {
            name: l.name,
            group: l.group,
            openingBalance: l.openingBalance,
            openingDr: l.openingDr,
            months,
            grandDebit,
            grandCredit,
            closingBalance: Math.abs(runningBalance),
            closingDr: runningBalance >= 0
        };
    });

    ledgers.sort((a, b) => {
        if (a.group === b.group) return a.name.localeCompare(b.name);
        return a.group === 'Bank Accounts' ? -1 : 1;
    });

    return { ledgers };
};
