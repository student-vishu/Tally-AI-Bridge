// Fetch all ledgers with master OPENINGBALANCE.
// No SVFROMDATE/SVTODATE — date vars force Tally to recompute OPENINGBALANCE
// from full transaction history for all 750+ ledgers (timeout >30s).
// Without date vars, OPENINGBALANCE is read from the ledger master record (fast).
exports.buildBankCashLedgersXML = (company) => `
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
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${company ? `\n        <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
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

// Fetch all Tally groups with their parent — used to build the group tree for classification.
exports.buildGroupsXML = (company) => `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllGroups</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${company ? `\n        <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllGroups">
            <TYPE>Group</TYPE>
            <FETCH>NAME, PARENT</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

// Fetch OPENINGBALANCE for ALL ledgers WITH date vars.
// Tally Prime does not support TDL FUNCTION filters in XML export — so we fetch all and
// filter to bank/cash names in JavaScript after parsing.
// NOTE: With date vars Tally recomputes OPENINGBALANCE per ledger — may be slow for
// large companies (500+ ledgers). A try/catch in the caller falls back to master OB if
// it times out.
exports.buildBankCashOpeningXML = (fromDate, toDate, company) => `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>BankCashOpeningBalance</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVFROMDATE>${fromDate}</SVFROMDATE>
        <SVTODATE>${toDate}</SVTODATE>${company ? `\n        <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="BankCashOpeningBalance">
            <TYPE>Ledger</TYPE>
            <FETCH>NAME, OPENINGBALANCE</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

// Fetch OPENINGBALANCE + CLOSINGBALANCE for ALL ledgers WITH date vars.
// Tally Prime does not support TDL FUNCTION filters — we fetch all and filter by
// ledger name in JavaScript. The controller caches this result per company+period
// so multiple ledger-detail calls in one search only hit Tally once.
exports.buildLedgerDetailXML = (fromDate, toDate, company) => `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllLedgersDetail</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVFROMDATE>${fromDate}</SVFROMDATE>
        <SVTODATE>${toDate}</SVTODATE>${company ? `\n        <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllLedgersDetail">
            <TYPE>Ledger</TYPE>
            <FETCH>NAME, PARENT, OPENINGBALANCE, CLOSINGBALANCE</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

// Fetch opening balance for ONE specific ledger with date vars.
// Called once per bank/cash ledger (2–5 requests) instead of fetching all 500+ ledgers.
// Object-type export targets a single named ledger → Tally only computes OB for that one ledger → fast.
exports.buildSingleLedgerOpeningXML = (ledgerName, fromDate, toDate, company) => `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Object</TYPE>
    <SUBTYPE>Ledger</SUBTYPE>
    <ID>${ledgerName}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVFROMDATE>${fromDate}</SVFROMDATE>
        <SVTODATE>${toDate}</SVTODATE>${company ? `\n        <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;

// Fetch ALL ledger names and parent groups — used for the search/autocomplete endpoint.
// No date vars and no OPENINGBALANCE → reads from master record only (fast, same reason as above).
exports.buildAllLedgersXML = (company) => `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllLedgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${company ? `\n        <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllLedgers">
            <TYPE>Ledger</TYPE>
            <FETCH>NAME, PARENT</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

// Fetch ALL vouchers for the FY as a collection.
// Collections don't have the 90-row limit that report-based exports have,
// so this reliably returns every transaction across all 12 months.
exports.buildFYVouchersXML = (fromDate, toDate, company) => `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>FYVouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVFROMDATE>${fromDate}</SVFROMDATE>
        <SVTODATE>${toDate}</SVTODATE>${company ? `\n        <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="FYVouchers">
            <TYPE>Voucher</TYPE>
            <FETCH>DATE, ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.AMOUNT, ALLLEDGERENTRIES.ISDEEMEDPOSITIVE</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
