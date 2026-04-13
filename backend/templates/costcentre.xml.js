// Export all vouchers via the Day Book report (Export Data format).
// This is the ONLY Tally request that returns full voucher XML including
// ALLLEDGERENTRIES.LIST → CATEGORYALLOCATIONS.LIST → COSTCENTREALLOCATIONS.LIST.
// Collection-based export cannot return nested sub-collections regardless of FETCH syntax.
// SVEXPORTCOUNT=99999 overrides Tally's default 90-row report limit.
exports.buildCostCentreVouchersXML = (from, to, company) => `
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Day Book</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVFROMDATE>${from}</SVFROMDATE>
          <SVTODATE>${to}</SVTODATE>
          <SVEXPORTCOUNT>-1</SVEXPORTCOUNT>${company ? `\n          <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

// Fetch all cost centres with their PARENT field — used to build the parent-child hierarchy.
exports.buildCostCentreHierarchyXML = (company) => `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllCostCentresParent</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${company ? `\n        <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
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
