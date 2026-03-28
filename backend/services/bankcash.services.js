const { callTally } = require('./tally.services');
const { buildBankCashLedgersXML, buildFYVouchersXML } = require('../templates/bankcash.xml');

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// In Tally master: negative OPENINGBALANCE = Dr (asset has value), positive = Cr (overdraft/liability).
// This is Tally's internal convention for asset-group ledgers (Bank Accounts, Cash-in-Hand).
function parseOpeningBalance(str) {
    if (!str || str === '0' || str === '0.00') return { amount: 0, isDr: true };
    const s = String(str).trim().replace(/,/g, '');
    const val = parseFloat(s);
    if (isNaN(val)) return { amount: 0, isDr: true };
    return { amount: Math.abs(val), isDr: val < 0 }; // negative = Dr for asset accounts
}

// Generate all 12 month keys for a FY (Apr YYYY → Mar YYYY+1)
function getFYMonthKeys(fromDate) {
    const fyStart = parseInt(fromDate.substring(0, 4), 10); // e.g. 2022
    const keys = [];
    for (let m = 4; m <= 12; m++) keys.push(`${fyStart}${String(m).padStart(2, '0')}`);
    for (let m = 1; m <= 3; m++)  keys.push(`${fyStart + 1}${String(m).padStart(2, '0')}`);
    return keys; // ["202204", "202205", ..., "202303"]
}

// Parse the full-year Voucher Collection response → monthly Dr/Cr per ledger
// Voucher XML: <VOUCHER ...><DATE>YYYYMMDD</DATE> ... <ALLLEDGERENTRIES.LIST>
//                <LEDGERNAME>X</LEDGERNAME><ISDEEMEDPOSITIVE>Yes|No</ISDEEMEDPOSITIVE>
//                <AMOUNT>-1234.56</AMOUNT></ALLLEDGERENTRIES.LIST>...
function parseVoucherCollection(raw, bankCashLedgers) {
    // monthData: { ledgerName: { YYYYMM: { debit, credit } } }
    const monthData = {};
    for (const name of bankCashLedgers) monthData[name] = {};

    const voucherRegex = /<VOUCHER [^>]*>([\s\S]*?)<\/VOUCHER>/g;
    let vMatch;
    let voucherCount = 0;

    while ((vMatch = voucherRegex.exec(raw)) !== null) {
        const body = vMatch[1];
        voucherCount++;

        const dateMatch = body.match(/<DATE[^>]*>(\d{8})<\/DATE>/);
        if (!dateMatch) continue;
        const monthKey = dateMatch[1].substring(0, 6); // YYYYMM

        const entryRegex = /<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g;
        let eMatch;
        while ((eMatch = entryRegex.exec(body)) !== null) {
            const ebody = eMatch[1];

            const nameMatch = ebody.match(/<LEDGERNAME[^>]*>([^<]+)<\/LEDGERNAME>/);
            if (!nameMatch) continue;
            const ledger = nameMatch[1].trim();
            if (!monthData[ledger]) continue; // not a bank/cash ledger we care about

            const amtMatch  = ebody.match(/<AMOUNT[^>]*>([^<]+)<\/AMOUNT>/);
            const isDrMatch = ebody.match(/<ISDEEMEDPOSITIVE[^>]*>([^<]+)<\/ISDEEMEDPOSITIVE>/);
            if (!amtMatch) continue;

            const amount = Math.abs(parseFloat(amtMatch[1]) || 0);
            if (amount === 0) continue;

            const isDr = (isDrMatch?.[1]?.trim() || 'No').toLowerCase() === 'yes';

            if (!monthData[ledger][monthKey]) monthData[ledger][monthKey] = { debit: 0, credit: 0 };
            if (isDr) monthData[ledger][monthKey].debit  += amount;
            else      monthData[ledger][monthKey].credit += amount;
        }
    }

    console.log(`[BankCash] Parsed ${voucherCount} vouchers`);
    return monthData;
}

exports.fetchBankCashData = async (fromDate, toDate) => {
    console.log('[BankCash] Fetching', fromDate, '->', toDate);

    // Step 1: Get all ledgers + master opening balances (single fast call, no date vars)
    const ledgersRaw = await callTally(buildBankCashLedgersXML());

    const BANK_CASH_GROUPS = new Set(['Bank Accounts', 'Cash-in-Hand']);
    const ledgerMatches = [...ledgersRaw.matchAll(/<LEDGER NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/g)];
    console.log('[BankCash] All ledgers:', ledgerMatches.length);

    const ledgerMap = {};
    for (const m of ledgerMatches) {
        const name = m[1];
        const body = m[2];
        const parentMatch = body.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/);
        const balMatch    = body.match(/<OPENINGBALANCE[^>]*>([^<]*)<\/OPENINGBALANCE>/);
        const parent = parentMatch ? parentMatch[1].trim() : '';
        if (!BANK_CASH_GROUPS.has(parent)) continue;

        const { amount: openAmt, isDr: openIsDr } = parseOpeningBalance(balMatch ? balMatch[1] : '0');
        ledgerMap[name] = { name, group: parent, openingBalance: openAmt, openingDr: openIsDr };
    }

    const bankCashNames = Object.keys(ledgerMap);
    console.log('[BankCash] Bank/Cash ledgers:', bankCashNames.join(', ') || 'none');

    if (!bankCashNames.length) return { ledgers: [] };

    // Step 2: Fetch ALL FY vouchers in one call — no 90-row limit, all months included
    const vouchersRaw = await callTally(buildFYVouchersXML(fromDate, toDate));
    const monthData = parseVoucherCollection(vouchersRaw, bankCashNames);

    // Step 3: Build output — include ALL 12 FY months (Apr → Mar), even zero-transaction ones
    const fyMonthKeys = getFYMonthKeys(fromDate);

    const ledgers = bankCashNames.map(name => {
        const l = ledgerMap[name];
        let runningBalance = l.openingDr ? l.openingBalance : -l.openingBalance;
        let grandDebit = 0, grandCredit = 0;

        const months = fyMonthKeys.map(mk => {
            const data = monthData[name]?.[mk] || { debit: 0, credit: 0 };
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
                closingDr: runningBalance >= 0
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

    // Sort: Bank Accounts first, then Cash-in-Hand; alphabetical within group
    ledgers.sort((a, b) => {
        if (a.group === b.group) return a.name.localeCompare(b.name);
        return a.group === 'Bank Accounts' ? -1 : 1;
    });

    return { ledgers };
};
