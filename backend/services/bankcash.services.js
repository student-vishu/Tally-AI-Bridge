const { callTally } = require('./tally.services');
const { buildBankCashLedgersXML, buildLedgerVouchersXML } = require('../templates/bankcash.xml');

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

const MONTHS_SHORT = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };

// Parse Tally balance string: plain number (negative = Cr in Tally master)
function parseOpeningBalance(str) {
    if (!str || str === '0' || str === '0.00') return { amount: 0, isDr: true };
    const s = String(str).trim().replace(/,/g, '');
    const val = parseFloat(s);
    if (isNaN(val)) return { amount: 0, isDr: true };
    // Tally stores opening balance as negative when it's a Credit balance
    return { amount: Math.abs(val), isDr: val >= 0 };
}

// Parse "D-Mon-YY" or "D-Mon-YYYY" date string → "YYYYMM" month key
function parseDspDate(dateStr) {
    if (!dateStr) return null;
    const m = dateStr.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (!m) return null;
    const monthNum = MONTHS_SHORT[m[2]];
    if (!monthNum) return null;
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    return { monthKey: `${year}${String(monthNum).padStart(2, '0')}`, monthNum, year };
}

// Parse "Ledger Vouchers" report response → { [YYYYMM]: { monthKey, monthLabel, debit, credit } }
// Response format: flat repeating <DSPVCHDATE>, <DSPVCHDRAMT>, <DSPVCHCRAMT> tags
function parseLedgerVouchers(raw, ledgerName) {
    const monthData = {};

    // Extract all DSPVCHDATE values and their positions
    const datePattern = /<DSPVCHDATE>([^<]*)<\/DSPVCHDATE>/g;
    const drPattern = /<DSPVCHDRAMT>([^<]*)<\/DSPVCHDRAMT>/g;
    const crPattern = /<DSPVCHCRAMT>([^<]*)<\/DSPVCHCRAMT>/g;

    // Collect all values in order
    const dates = [...raw.matchAll(datePattern)].map(m => m[1].trim());
    const drs   = [...raw.matchAll(drPattern)].map(m => m[1].trim());
    const crs   = [...raw.matchAll(crPattern)].map(m => m[1].trim());

    console.log(`[BankCash] "${ledgerName}" voucher rows:`, dates.length);

    for (let i = 0; i < dates.length; i++) {
        const parsed = parseDspDate(dates[i]);
        if (!parsed) continue;

        const { monthKey, monthNum, year } = parsed;
        const monthLabel = `${MONTH_NAMES[monthNum] || '?'} ${year}`;

        // DSPVCHDRAMT: non-empty → Cash/Bank was debited (receipt), abs() for amount
        const drRaw = drs[i] || '';
        const crRaw = crs[i] || '';

        const debit  = drRaw !== '' ? Math.abs(parseFloat(drRaw) || 0) : 0;
        const credit = crRaw !== '' ? Math.abs(parseFloat(crRaw) || 0) : 0;

        if (debit === 0 && credit === 0) continue;

        if (!monthData[monthKey]) {
            monthData[monthKey] = { monthKey, monthLabel, debit: 0, credit: 0 };
        }
        monthData[monthKey].debit  += debit;
        monthData[monthKey].credit += credit;
    }

    console.log(`[BankCash] "${ledgerName}" months:`, Object.keys(monthData).join(', ') || 'none');
    return monthData;
}

exports.fetchBankCashData = async (fromDate, toDate) => {
    console.log('[BankCash] Fetching', fromDate, '->', toDate);

    // Step 1: Get all ledgers with master opening balances (no date vars → fast read)
    const ledgersRaw = await callTally(buildBankCashLedgersXML());

    const BANK_CASH_GROUPS = new Set(['Bank Accounts', 'Cash-in-Hand']);
    // Allow extra attributes on LEDGER tag (e.g. RESERVEDNAME="") and child element TYPE attributes
    const ledgerMatches = [...ledgersRaw.matchAll(/<LEDGER NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/g)];
    console.log('[BankCash] All ledgers in response:', ledgerMatches.length);

    const ledgerMap = {};
    for (const m of ledgerMatches) {
        const name = m[1];
        const body = m[2];
        const parentMatch = body.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/);
        const balMatch    = body.match(/<OPENINGBALANCE[^>]*>([^<]*)<\/OPENINGBALANCE>/);
        const parent = parentMatch ? parentMatch[1].trim() : '';

        if (!BANK_CASH_GROUPS.has(parent)) continue;

        const { amount: openAmt, isDr: openIsDr } = parseOpeningBalance(balMatch ? balMatch[1] : '0');
        ledgerMap[name] = { name, group: parent, openingBalance: openAmt, openingDr: openIsDr, monthData: {} };
    }

    console.log('[BankCash] Bank/Cash ledgers:', Object.keys(ledgerMap).join(', ') || 'none');

    if (!Object.keys(ledgerMap).length) {
        return { ledgers: [] };
    }

    // Step 2: Fetch "Ledger Vouchers" report per ledger (serialized via Tally queue)
    const ledgerNames = Object.keys(ledgerMap);
    const reports = await Promise.all(
        ledgerNames.map(name =>
            callTally(buildLedgerVouchersXML(name, fromDate, toDate))
                .then(raw => ({ name, raw }))
                .catch(err => {
                    console.error(`[BankCash] Error fetching vouchers for "${name}":`, err.message);
                    return { name, raw: '' };
                })
        )
    );

    // Step 3: Parse each voucher report into monthly totals
    for (const { name, raw } of reports) {
        if (!raw) continue;
        ledgerMap[name].monthData = parseLedgerVouchers(raw, name);
    }

    // Step 4: Build output structure
    const ledgers = Object.values(ledgerMap).map(l => {
        const months = Object.values(l.monthData)
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

        // runningBalance: positive = Dr (asset), negative = Cr (liability/overdraft)
        let runningBalance = l.openingDr ? l.openingBalance : -l.openingBalance;
        let grandDebit = 0;
        let grandCredit = 0;

        const monthsOut = months.map(m => {
            runningBalance += m.debit - m.credit;
            grandDebit  += m.debit;
            grandCredit += m.credit;
            return {
                month: m.monthLabel,
                debit: m.debit,
                credit: m.credit,
                closingBalance: Math.abs(runningBalance),
                closingDr: runningBalance >= 0
            };
        });

        return {
            name: l.name,
            group: l.group,
            openingBalance: l.openingBalance,
            openingDr: l.openingDr,
            months: monthsOut,
            grandDebit,
            grandCredit,
            closingBalance: Math.abs(runningBalance),
            closingDr: runningBalance >= 0
        };
    });

    // Sort: Bank Accounts first, Cash-in-Hand after; alphabetical within group
    ledgers.sort((a, b) => {
        if (a.group === b.group) return a.name.localeCompare(b.name);
        return a.group === 'Bank Accounts' ? -1 : 1;
    });

    console.log('[BankCash] Result:', ledgers.map(l => `${l.name}(${l.months.length}mo)`).join(', '));
    return { ledgers };
};
