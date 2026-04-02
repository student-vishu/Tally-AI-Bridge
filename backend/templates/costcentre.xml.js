// Cumulative closing balance for a FILTERED list of cost centres.
// ccNames: array of CC name strings to include (keeps Tally from computing 100 CCs).
// Use SVFROMDATE = FY start (Apr 1) and SVTODATE = end of target month.
// Subtract consecutive snapshots to derive monthly activity.
// Cumulative closing balance for ALL cost centres.
// Client-side filtering keeps the TDL simple and avoids Tally hanging on filter evaluation.
// Use SVFROMDATE = FY start (Apr 1) and SVTODATE = end of target month.
exports.buildCCClosingBalanceXML = (fromDate, toDate) => `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CCClosingBal</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVFROMDATE>${fromDate}</SVFROMDATE>
        <SVTODATE>${toDate}</SVTODATE>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CCClosingBal">
            <TYPE>Cost Centre</TYPE>
            <FETCH>NAME, CLOSINGBALANCE</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

// Cost Centre Breakup EXPORTDATA — Tally Prime only.
// Called WITHOUT a CC filter first to discover the XML structure, then we'll add a filter.
exports.buildCCBreakupAllXML = (from, to) => `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Cost Centre Breakup</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVFROMDATE>${from}</SVFROMDATE>
          <SVTODATE>${to}</SVTODATE>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

// Fetch all cost centres with their PARENT field — used to build the parent-child hierarchy.
exports.buildCostCentreHierarchyXML = () => `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllCostCentresParent</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllCostCentresParent">
            <TYPE>Cost Centre</TYPE>
            <FETCH>NAME, PARENT</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
