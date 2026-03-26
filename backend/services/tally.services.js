const axios = require('axios');

exports.callTally = async (xml) => {
    let res;
    try {
        res = await axios.post(process.env.TALLY_URL, xml, {
            headers: { 'Content-Type': 'text/xml' }
        });
    } catch (err) {
        throw new Error('Tally not reachable: ' + err.message);
    }

    if (res.data.includes('<LINEERROR>')) {
        const match = res.data.match(/<LINEERROR>(.*?)<\/LINEERROR>/);
        throw new Error('Tally error: ' + (match ? match[1] : 'Unknown'));
    }

    return res.data;
};

const COST_CATEGORIES_XML = `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllCostCategories</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllCostCategories">
            <TYPE>Cost Category</TYPE>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

exports.fetchCostCategories = async () => {
    const raw = await exports.callTally(COST_CATEGORIES_XML);
    const matches = [...raw.matchAll(/COSTCATEGORY NAME="([^"]+)"/g)];
    return matches.map(m => m[1]);
};

const COMPANY_PERIOD_XML = `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CompanyPeriod</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CompanyPeriod">
            <TYPE>Company</TYPE>
            <FETCH>NAME, STARTINGFROM, ENDINGAT</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

const DAY_BOOK_PEEK_XML = `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Day Book</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

exports.fetchCurrentPeriod = async () => {
    const raw = await exports.callTally(DAY_BOOK_PEEK_XML);
    const dateStr = raw.match(/<DATE>(\d{8})<\/DATE>/)?.[1] || '';
    if (dateStr) {
        const year  = parseInt(dateStr.substring(0, 4), 10);
        const month = parseInt(dateStr.substring(4, 6), 10);
        const fyStart = month >= 4 ? year : year - 1;
        return { from: `${fyStart}0401` };
    }
    return { from: '' }; // no vouchers in selected period
};
