const axios = require('axios');

// Tally ERP 9 handles only ONE HTTP request at a time.
// All calls are serialized through this queue to prevent simultaneous requests crashing Tally.
let _tallyBusy = false;
const _tallyQueue = [];

function _dequeue() {
  if (_tallyBusy || _tallyQueue.length === 0) return;
  _tallyBusy = true;
  const { xml, resolve, reject, timeout } = _tallyQueue.shift();
  _doCallTally(xml, timeout).then(resolve, reject).finally(() => {
    _tallyBusy = false;
    _dequeue();
  });
}

async function _doCallTally(xml, timeout = 35000) {
  let res;
  try {
    res = await axios.post(process.env.TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout
    });
  } catch (err) {
    throw new Error('Tally not reachable: ' + err.message);
  }

  if (res.data.includes('<LINEERROR>')) {
    const match = res.data.match(/<LINEERROR>(.*?)<\/LINEERROR>/);
    throw new Error('Tally error: ' + (match ? match[1] : 'Unknown'));
  }

  return res.data;
}

exports.callTally = (xml, timeout = 35000) => {
  return new Promise((resolve, reject) => {
    _tallyQueue.push({ xml, resolve, reject, timeout });
    _dequeue();
  });
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

// Collection + COMPUTE to expose ##SVFROMDATE / ##SVTODATE (Tally ERP 9 compatible).
// Also fetches STARTINGFROM and ENDINGAT as fallbacks.
const CURRENT_PERIOD_XML = `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CurrentPeriod</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CurrentPeriod">
            <TYPE>Company</TYPE>
            <FETCH>NAME, STARTINGFROM, ENDINGAT</FETCH>
            <COMPUTE>FROMDATE : $$String:##SVFROMDATE</COMPUTE>
            <COMPUTE>TODATE : $$String:##SVTODATE</COMPUTE>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

// Cache the period so multiple endpoints don't hit Tally on every page load
let _periodCache = null;
let _periodCacheTime = 0;
const PERIOD_CACHE_TTL = 30 * 1000; // 30 seconds — short enough that switching year in Tally reflects on next refresh
// In-flight promise lock — prevents multiple simultaneous Tally calls for the same period XML
let _periodInflight = null;

const MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };

function parseDateStr(s) {
  if (!s) return null;
  s = s.trim();
  // Format: YYYYMMDD
  const f1 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (f1) {
    const month = parseInt(f1[2], 10);
    const year  = parseInt(f1[1], 10);
    return month >= 4 ? year : year - 1;
  }
  // Format: D-Mon-YY or D-Mon-YYYY  e.g. "1-Apr-22" or "01-Apr-2022"
  const f2 = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (f2) {
    const month = MONTHS[f2[2]] || 0;
    let year = parseInt(f2[3], 10);
    if (year < 100) year += 2000; // "22" → 2022
    return month >= 4 ? year : year - 1;
  }
  return null;
}

exports.fetchCurrentPeriod = async () => {
  if (_periodCache && (Date.now() - _periodCacheTime) < PERIOD_CACHE_TTL) {
    return _periodCache;
  }

  // If another call is already in-flight, wait for it instead of making a duplicate Tally request
  if (_periodInflight) return _periodInflight;

  _periodInflight = (async () => {
    try {
      const raw = await exports.callTally(CURRENT_PERIOD_XML);
      console.log('[fetchCurrentPeriod] raw (first 300):', raw.substring(0, 300));

      // Try computed SVFROMDATE/SVTODATE first (reflects currently-selected year in Tally UI)
      const fromStr =
        raw.match(/<FROMDATE[^>]*>([^<]+)<\/FROMDATE>/)?.[1]?.trim() ||
        raw.match(/<SVFROMDATE[^>]*>([^<]+)<\/SVFROMDATE>/)?.[1]?.trim() ||
        raw.match(/<STARTINGFROM[^>]*>([^<]+)<\/STARTINGFROM>/)?.[1]?.trim() ||
        raw.match(/<BOOKSFROM[^>]*>([^<]+)<\/BOOKSFROM>/)?.[1]?.trim() || '';
      const toStr =
        raw.match(/<TODATE[^>]*>([^<]+)<\/TODATE>/)?.[1]?.trim() ||
        raw.match(/<SVTODATE[^>]*>([^<]+)<\/SVTODATE>/)?.[1]?.trim() ||
        raw.match(/<ENDINGAT[^>]*>([^<]+)<\/ENDINGAT>/)?.[1]?.trim() || '';
      console.log('[fetchCurrentPeriod] fromStr:', fromStr, '| toStr:', toStr);

      let result;
      const fyStart = parseDateStr(fromStr);
      if (fyStart) {
        result = { from: `${fyStart}0401`, to: `${fyStart + 1}0331`, booksFromYear: fyStart };
      } else if (process.env.FY_FROM_DATE && process.env.FY_TO_DATE) {
        const envYear = parseDateStr(process.env.FY_FROM_DATE);
        result = { from: process.env.FY_FROM_DATE, to: process.env.FY_TO_DATE, booksFromYear: envYear || null };
        console.log('[fetchCurrentPeriod] using env fallback:', result);
      } else {
        result = { from: '', to: '', booksFromYear: null };
      }

      // Only cache a valid (non-empty) result so a bad Tally response doesn't poison the cache
      if (result.from) {
        _periodCache = result;
        _periodCacheTime = Date.now();
      }
      return result;
    } finally {
      _periodInflight = null;
    }
  })();

  return _periodInflight;
};
