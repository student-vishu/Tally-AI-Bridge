const axios = require('axios');

const DEFAULT_URL = process.env.TALLY_URL || 'http://localhost:9000';

// Tally ERP 9 handles only ONE HTTP request at a time.
// Per-URL queues: each Tally instance gets its own serialized queue so two
// users on different Tally instances can run concurrently without blocking each other.
const _queues = new Map();

function _getQueue(url) {
  if (!_queues.has(url)) _queues.set(url, { busy: false, queue: [] });
  return _queues.get(url);
}

function _dequeue(tallyUrl) {
  const q = _getQueue(tallyUrl);
  if (q.busy || q.queue.length === 0) return;
  q.busy = true;
  const { xml, resolve, reject, timeout } = q.queue.shift();
  _doCallTally(xml, timeout, tallyUrl).then(resolve, reject).finally(() => {
    q.busy = false;
    _dequeue(tallyUrl);
  });
}

async function _doCallTally(xml, timeout = 35000, tallyUrl) {
  let res;
  try {
    res = await axios.post(tallyUrl, xml, {
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

exports.callTally = (xml, timeout = 35000, tallyUrl = DEFAULT_URL) => {
  return new Promise((resolve, reject) => {
    const q = _getQueue(tallyUrl);
    q.queue.push({ xml, resolve, reject, timeout });
    _dequeue(tallyUrl);
  });
};

const decodeXml = s => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
exports.decodeXml = decodeXml;

function buildCostCategoriesXML(company) {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllCostCategories</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${company ? `\n        <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
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
}

exports.fetchCostCategories = async (tallyUrl = DEFAULT_URL, company = null) => {
  const raw = await exports.callTally(buildCostCategoriesXML(company), 35000, tallyUrl);
  const matches = [...raw.matchAll(/COSTCATEGORY NAME="([^"]+)"/g)];
  return matches.map(m => decodeXml(m[1]));
};

// Fetch the company's fixed BOOKSFROM date (when books were started) — NOT the currently selected period.
// This is stored in the Company master and never changes with period selection.
function buildCompanyBooksFromXML(company) {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CompanyBooksFrom</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${company ? `\n        <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : ''}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CompanyBooksFrom">
            <TYPE>Company</TYPE>
            <FETCH>NAME, BOOKSFROM</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

exports.fetchCompanyBooksFrom = async (tallyUrl = DEFAULT_URL, company = null) => {
  const raw = await exports.callTally(buildCompanyBooksFromXML(company), 35000, tallyUrl);
  const booksFromStr = raw.match(/<BOOKSFROM[^>]*>([^<]+)<\/BOOKSFROM>/i)?.[1]?.trim() || '';
  return parseDateStr(booksFromStr); // returns FY start year (e.g. 2022) or null
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
            <TYPE>Group</TYPE>
            <COMPUTE>FROMDATE : $$String:##SVFROMDATE</COMPUTE>
            <COMPUTE>TODATE : $$String:##SVTODATE</COMPUTE>
            <COMPUTE>CONAME : $$String:##SVCURRENTCOMPANY</COMPUTE>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

// Per-URL period caches — each Tally instance has independent cache entries
const _periodCaches    = new Map(); // url → { result, time }
const _periodInflights = new Map(); // url → Promise
const PERIOD_CACHE_TTL = 30 * 1000; // 30 seconds — short enough that switching year in Tally reflects on next refresh

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

exports.clearPeriodCache = (tallyUrl) => {
    if (tallyUrl) {
        _periodCaches.delete(tallyUrl);
    } else {
        _periodCaches.clear();
    }
};

exports.fetchCurrentPeriod = async (tallyUrl = DEFAULT_URL) => {
  const cached = _periodCaches.get(tallyUrl);
  if (cached && (Date.now() - cached.time) < PERIOD_CACHE_TTL) {
    return cached.result;
  }

  // If another call is already in-flight for this URL, wait for it instead of making a duplicate Tally request
  if (_periodInflights.has(tallyUrl)) return _periodInflights.get(tallyUrl);

  const inflight = (async () => {
    try {
      const raw = await exports.callTally(CURRENT_PERIOD_XML, 35000, tallyUrl);
      console.log('[fetchCurrentPeriod] raw[0-600]:', raw.substring(0, 600));
      console.log('[fetchCurrentPeriod] raw[1000-2000]:', raw.substring(1000, 2000));

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

      // ##SVCOMPANY system variable (like ##SVFROMDATE) returns the active company name.
      // Fallback: <NAME> child element with the " - (from D-Mon-YY)" suffix stripped.
      const coname  = raw.match(/<CONAME[^>]*>([^<]+)<\/CONAME>/)?.[1]?.trim() || '';
      const rawName = coname ||
        raw.match(/<NAME[^>]*>([^<]+)<\/NAME>/)?.[1]?.trim() || '';
      const companyName = decodeXml(rawName.replace(/\s*-\s*\(from\s+[^)]+\)\s*$/, '').trim());
      console.log('[fetchCurrentPeriod] coname:', coname, '| companyName:', companyName);

      let result;
      const fyStart = parseDateStr(fromStr);
      if (fyStart) {
        result = { from: `${fyStart}0401`, to: `${fyStart + 1}0331`, booksFromYear: fyStart, companyName };
      } else if (process.env.FY_FROM_DATE && process.env.FY_TO_DATE) {
        const envYear = parseDateStr(process.env.FY_FROM_DATE);
        result = { from: process.env.FY_FROM_DATE, to: process.env.FY_TO_DATE, booksFromYear: envYear || null, companyName };
        console.log('[fetchCurrentPeriod] using env fallback:', result);
      } else {
        result = { from: '', to: '', booksFromYear: null, companyName };
      }

      // Only cache a valid (non-empty) result so a bad Tally response doesn't poison the cache
      if (result.from) {
        _periodCaches.set(tallyUrl, { result, time: Date.now() });
      }
      return result;
    } finally {
      _periodInflights.delete(tallyUrl);
    }
  })();

  _periodInflights.set(tallyUrl, inflight);
  return inflight;
};
