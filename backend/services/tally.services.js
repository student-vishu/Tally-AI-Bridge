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
