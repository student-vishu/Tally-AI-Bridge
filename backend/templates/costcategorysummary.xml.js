// Date-filtered variant — used to get per-month cost-centre amounts (one call per month).
// SVFROMDATE / SVTODATE limit which transactions are included in the report.
exports.buildCostCategorySummaryMonthXML = (from, to, company) => `
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Cost Category Summary</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVFROMDATE>${from}</SVFROMDATE>
          <SVTODATE>${to}</SVTODATE>${company ? `\n          <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

exports.buildCostCategorySummaryXML = (from, to, company) => `
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Cost Category Summary</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${from ? `\n          <SVFROMDATE>${from}</SVFROMDATE>` : ''}${to ? `\n          <SVTODATE>${to}</SVTODATE>` : ''}${company ? `\n          <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

