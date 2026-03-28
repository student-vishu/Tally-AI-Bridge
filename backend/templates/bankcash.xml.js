// Fetch all ledgers (NAME + PARENT + master OPENINGBALANCE).
// IMPORTANT: Do NOT include SVFROMDATE/SVTODATE here — date vars cause Tally to
// recompute OPENINGBALANCE from full transaction history for ALL ledgers (~750+),
// which takes >30s and times out. Without date vars, OPENINGBALANCE is read from the
// ledger master record (the balance as-of books-beginning date), which is fast.
exports.buildBankCashLedgersXML = () => `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>BankCashLedgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="BankCashLedgers">
            <TYPE>Ledger</TYPE>
            <FETCH>NAME, PARENT, OPENINGBALANCE</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

// Fetch all vouchers that involve a specific ledger for the period.
// Returns flat DSPVCH* repeating tags with date, contra account, Dr/Cr amounts.
exports.buildLedgerVouchersXML = (ledgerName, fromDate, toDate) => `
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Ledger Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVFROMDATE>${fromDate}</SVFROMDATE>
          <SVTODATE>${toDate}</SVTODATE>
          <LEDGERNAME>${ledgerName}</LEDGERNAME>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
