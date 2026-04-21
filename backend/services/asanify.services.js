const axios = require('axios');

const ASANIFY_API_URL  = 'https://api.asanify.com';
const COGNITO_REGION   = 'eu-west-1';
const COGNITO_CLIENT_ID = '1qgp4klq4otug2t5cjtduehv9s';

const EMPLOYEE_FIELDS = [
    'ASAN_EMPCODE', 'FIRST_NAME', 'MIDDLE_NAME', 'LAST_NAME',
    'EMPLOYEE_ID', 'DESIGNATION', 'DEPARTMENT', 'EMPLOYMENT_TYPE', 'IS_PORTAL_USER'
];

const EMPLOYEE_FILTERS = {
    type: 'BoolOp', op: 'AND',
    values: [
        { type: 'Compare', op: 'In', left: { type: 'Name', id: 'STATUS' }, right: [{ type: 'Str', s: 'ACTIVE' }, { type: 'Str', s: 'RESIGNED' }] },
        { type: 'Compare', op: 'In', left: { type: 'Name', id: 'EMPLOYMENT_TYPE' }, right: [{ type: 'Str', s: 'EMPLOYEE' }, { type: 'Str', s: 'CONTRACTOR' }] }
    ]
};

let cachedToken = null;

// ── Auth ─────────────────────────────────────────────────────────────────────

async function refreshBearerToken() {
    const refreshToken = process.env.ASANIFY_REFRESH_TOKEN;
    if (!refreshToken) throw new Error('ASANIFY_REFRESH_TOKEN not set in .env');
    console.log('[Asanify] Refreshing Cognito token...');
    const res = await axios.post(
        `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`,
        { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: COGNITO_CLIENT_ID, AuthParameters: { REFRESH_TOKEN: refreshToken } },
        { headers: { 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth', 'Content-Type': 'application/x-amz-json-1.1' }, timeout: 10000 }
    );
    const newToken = res.data?.AuthenticationResult?.IdToken;
    if (!newToken) throw new Error('Cognito did not return a new token');
    cachedToken = newToken;
    console.log('[Asanify] Token refreshed successfully');
    return newToken;
}

async function getToken() {
    return cachedToken || process.env.ASANIFY_BEARER_TOKEN || null;
}

// ── Generic POST with auto-refresh + columnar-to-objects conversion ───────────

function columnarToObjects(raw) {
    if (Array.isArray(raw)) return raw;
    const { headers, data } = raw;
    if (!headers || !data) return raw;
    return data.map(row => {
        const obj = {};
        headers.forEach((key, i) => { obj[key] = row[i]; });
        return obj;
    });
}

async function asanifyPost(endpoint, body = {}) {
    let token = await getToken();
    if (!token) throw new Error('No Asanify token available');

    const doRequest = (t) => axios.post(
        `${ASANIFY_API_URL}${endpoint}`, body,
        { headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: 15000 }
    );

    try {
        const res = await doRequest(token);
        return columnarToObjects(res.data);
    } catch (err) {
        if (err.response?.status === 401) {
            console.log(`[Asanify] 401 on ${endpoint} — refreshing token...`);
            token = await refreshBearerToken();
            const res = await doRequest(token);
            return columnarToObjects(res.data);
        }
        throw new Error(`Asanify API error (${endpoint}): ${err.response?.data?.message || err.message}`);
    }
}

// ── Public exports ────────────────────────────────────────────────────────────

exports.getAllEmployees = async () => {
    const data = await asanifyPost('/api/employee/read/v3', { FIELDS: EMPLOYEE_FIELDS, FILTERS: EMPLOYEE_FILTERS });
    console.log(`[Asanify] Fetched ${data.length} employees`);
    return data;
};

exports.getEmployeesWithProjects = async () => {
    // 1. Fetch employees and all projects in parallel
    const [employees, projects] = await Promise.all([
        exports.getAllEmployees(),
        asanifyPost('/api/timesheet/project/read')
    ]);

    console.log(`[Asanify] ${projects.length} projects found`);

    // 2. For each project fetch its assigned employees in parallel
    const assignmentResults = await Promise.all(
        projects.map(async (proj) => {
            const projectId = proj.PROJECT_ID || proj.id || proj.ID;
            const projectName = proj.PROJECT_NAME || proj.NAME || proj.name || projectId;
            try {
                const assigned = await asanifyPost('/api/timesheet/project/assign/read', { PROJECT_ID: projectId });
                return { projectId, projectName, assigned };
            } catch {
                return { projectId, projectName, assigned: [] };
            }
        })
    );

    // 3. Build map: EMPLOYEE_ID → [project names]
    const empProjectMap = {};
    for (const { projectName, assigned } of assignmentResults) {
        for (const emp of assigned) {
            const empId = emp.EMPLOYEE_ID || emp.employee_id || emp.ASAN_EMPCODE;
            if (!empId) continue;
            if (!empProjectMap[empId]) empProjectMap[empId] = [];
            if (!empProjectMap[empId].includes(projectName)) empProjectMap[empId].push(projectName);
        }
    }

    // 4. Merge projects into each employee
    const result = employees.map(emp => {
        const empId = emp.EMPLOYEE_ID || emp.ASAN_EMPCODE;
        return { ...emp, projects: empProjectMap[empId] || [] };
    });
    const withProjects = result.filter(e => e.projects.length > 0).length;
    console.log(`[Asanify] ${withProjects}/${result.length} employees have project assignments`);
    const firstAssigned = assignmentResults.find(r => r.assigned.length > 0);
    if (firstAssigned) console.log('[Asanify] Sample assign row:', JSON.stringify(firstAssigned.assigned[0]));
    return result;
};

// Returns timesheet rows: [{ name, project, date (YYYY-MM-DD), hours }, ...]
exports.fetchTimesheet = async (fromDate, toDate) => {
    const raw = await asanifyPost('/api/timesheet/sheet/reportee/read', {
        FROM_DATE: fromDate,
        TO_DATE: toDate,
    });
    // raw is array of objects after columnarToObjects
    // Expected fields: EMPLOYEE_NAME, PROJECT_NAME, date columns like "2026-04-01", TOTAL
    if (!raw.length) return [];

    const allKeys = Object.keys(raw[0]);
    console.log('[Asanify] Timesheet ALL row keys:', JSON.stringify(allKeys));
    console.log('[Asanify] Timesheet sample row (first):', JSON.stringify(raw[0]));
    if (raw[1]) console.log('[Asanify] Timesheet sample row (second):', JSON.stringify(raw[1]));

    // Support both "YYYY-MM-DD" and "Wed, 01 Apr 2026" date column formats
    const isoPattern  = /^\d{4}-\d{2}-\d{2}$/;
    const longPattern = /^\w{3},\s+\d{1,2}\s+\w{3}\s+\d{4}$/; // "Wed, 01 Apr 2026"

    const dateKeys = allKeys.filter(k => isoPattern.test(k) || longPattern.test(k));

    // Normalise any date string to YYYY-MM-DD
    const toISO = (k) => {
        if (isoPattern.test(k)) return k;
        const d = new Date(k);
        if (isNaN(d)) return null;
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };

    const rows = [];
    for (const r of raw) {
        const empName  = r.FULL_NAME || r.EMPLOYEE_NAME || r.employee_name || r.NAME || r.name || '';
        const projName = r.PROJECT_NAME || r.project_name  || r.PROJECT || r.project || '';
        for (const dk of dateKeys) {
            const hours = parseFloat(r[dk]) || 0;
            if (hours <= 0) continue;
            const iso = toISO(dk);
            if (iso) rows.push({ name: empName, project: projName, date: iso, hours });
        }
    }
    console.log(`[Asanify] Timesheet: ${raw.length} rows → ${rows.length} day-entries`);
    return rows;
};

// Returns map: ASAN_EMPCODE → monthly salary (CTC/12), latest record per employee
exports.fetchSalaries = async (employees) => {
    const results = await Promise.all(
        employees.map(async (emp) => {
            const code = emp.ASAN_EMPCODE;
            if (!code) return null;
            try {
                const token = await getToken();
                const res = await axios.post(
                    `${ASANIFY_API_URL}/api/employee/read/salary`,
                    { ASAN_EMPCODE: code },
                    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 10000 }
                );
                const sal = res.data?.salaries;
                if (!sal?.headers || !sal?.data?.length) return null;
                const h = sal.headers;
                const ctcIdx = h.indexOf('CTC');
                const effIdx = h.indexOf('EFFECTIVE_FROM');
                // Pick the most recent record
                const sorted = [...sal.data].sort((a, b) =>
                    (b[effIdx] || '').localeCompare(a[effIdx] || '')
                );
                const ctc = sorted[0][ctcIdx];
                return { code, monthly: ctc > 0 ? ctc / 12 : 0 };
            } catch {
                return null;
            }
        })
    );
    const map = {};
    results.forEach(r => { if (r) map[r.code] = r.monthly; });
    console.log(`[Asanify] Salaries fetched for ${Object.keys(map).length}/${employees.length} employees`);
    return map;
};
