const ExcelJS = require('exceljs');

const HEADER_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const HEADER_FONT  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
const WEEK_FILLS   = [
    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } },
    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDAE3F3' } },
    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } },
    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDAE3F3' } },
];
const EMP_FILL     = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
const PROJ_FILL    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
const BORDER_THIN  = { style: 'thin', color: { argb: 'FFB0B0B0' } };
const CELL_BORDER  = { top: BORDER_THIN, left: BORDER_THIN, bottom: BORDER_THIN, right: BORDER_THIN };
const CENTER       = { horizontal: 'center', vertical: 'middle', wrapText: true };
const LEFT         = { horizontal: 'left', vertical: 'middle', wrapText: true };

// Returns array of day numbers per week for a given month
function weeksForMonth(year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    // Split into weeks of 7 (last week may be shorter)
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    return weeks;
}

function dayName(year, month, day) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(year, month - 1, day).getDay()];
}

function colToLetter(n) {
    let s = '';
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
}

// timesheetRows: [{ name, project, date:'YYYY-MM-DD', hours }]  — may be empty/null
// salaryMap: { ASAN_EMPCODE → monthlySalary }
exports.buildTeamAllocationExcel = async (employees, year, month, timesheetRows = [], salaryMap = {}) => {
    // Build lookup: "normalized_name|normalized_project|YYYY-MM-DD" → hours
    const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const tsMap = {};
    for (const r of timesheetRows) {
        const key = `${norm(r.name)}|${norm(r.project)}|${r.date}`;
        tsMap[key] = (tsMap[key] || 0) + r.hours;
    }
    const tsHours = (empName, projName, year, month, day) => {
        const dd = String(day).padStart(2, '0');
        const mm = String(month).padStart(2, '0');
        return tsMap[`${norm(empName)}|${norm(projName)}|${year}-${mm}-${dd}`] || 0;
    };
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Essact Tally-AI-Bridge';

    const weeks = weeksForMonth(year, month);
    const monthName = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long' });

    // ── Sheet 1: Team Allocation (detail) ────────────────────────────────────
    const ws = wb.addWorksheet('Team Allocation');

    // Build column structure
    // Fixed: Sr No (A), Employee Name (B), Project (C)
    // Then for each week: one col per day + Weekly% col
    // Then: Total Hours, Total Days, Present Days, Week Off, Holiday, Leave, Monthly % Involvement
    const fixedCols = [
        { header: 'Sr No',         key: 'sr',     width: 6  },
        { header: 'Employee Name', key: 'name',   width: 22 },
        { header: 'Project',       key: 'project',width: 28 },
    ];

    const weekCols = [];
    weeks.forEach((week, wi) => {
        week.forEach(d => weekCols.push({ header: dayName(year, month, d) + '\n' + d, key: `w${wi}_d${d}`, width: 6, weekIdx: wi }));
        weekCols.push({ header: 'Weekly\n%', key: `w${wi}_pct`, width: 8, weekIdx: wi, isPct: true });
    });

    const summaryCols = [
        { header: 'Total\n(Hours)', key: 'totalHours',  width: 9  },
        { header: 'Total Days',     key: 'totalDays',   width: 9  },
        { header: 'Present days',   key: 'presentDays', width: 10 },
        { header: 'Week Off',       key: 'weekOff',     width: 9  },
        { header: 'Holiday',        key: 'holiday',     width: 9  },
        { header: 'Leave',          key: 'leave',       width: 9  },
        { header: 'Monthly %\nInvolvement', key: 'monthlyPct', width: 12 },
    ];

    ws.columns = [...fixedCols, ...weekCols, ...summaryCols];

    // Row 1: Title
    ws.mergeCells(1, 1, 1, ws.columns.length);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = `Team Allocation — ${monthName} ${year}`;
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = HEADER_FILL;
    titleCell.alignment = CENTER;
    ws.getRow(1).height = 28;

    // Row 2: Week group headers
    const weekRow = ws.getRow(2);
    weekRow.height = 18;
    let col = 4; // after Sr No, Name, Project
    weeks.forEach((week, wi) => {
        const span = week.length + 1; // days + Weekly%
        ws.mergeCells(2, col, 2, col + span - 1);
        const cell = ws.getCell(2, col);
        cell.value = `Week - ${wi + 1}`;
        cell.font = { bold: true, color: { argb: 'FF000000' }, size: 10 };
        cell.fill = WEEK_FILLS[wi];
        cell.alignment = CENTER;
        col += span;
    });
    // Summary header span
    ws.mergeCells(2, col, 2, col + summaryCols.length - 1);
    const sumCell = ws.getCell(2, col);
    sumCell.value = 'Summary';
    sumCell.font = HEADER_FONT;
    sumCell.fill = HEADER_FILL;
    sumCell.alignment = CENTER;

    // Row 3: Column headers
    const hdrRow = ws.getRow(3);
    hdrRow.height = 32;
    ws.columns.forEach((c, i) => {
        const cell = hdrRow.getCell(i + 1);
        cell.value = c.header;
        cell.font = HEADER_FONT;
        cell.fill = HEADER_FILL;
        cell.alignment = CENTER;
        cell.border = CELL_BORDER;
    });

    // Row 4: Date numbers under each day column
    const dateRow = ws.getRow(4);
    dateRow.height = 16;
    let dc = 4;
    weeks.forEach((week, wi) => {
        week.forEach(d => {
            const cell = dateRow.getCell(dc++);
            cell.value = d;
            cell.fill = WEEK_FILLS[wi];
            cell.alignment = CENTER;
            cell.font = { size: 9 };
            cell.border = CELL_BORDER;
        });
        dc++; // skip Weekly%
    });

    const DEPT_ORDER = ['Executive team', 'QA', 'Site team'];
    const DEPT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E4057' } };

    // Data rows
    // Pre-compute working days for monthly % (Mon-Sat, not Sun)
    const daysInMonth = new Date(year, month, 0).getDate();
    let workingDaysInMonth = 0;
    for (let d = 1; d <= daysInMonth; d++) {
        if (new Date(year, month - 1, d).getDay() !== 0) workingDaysInMonth++;
    }

    // Helper: working days in a week array
    const workingDaysInWeek = (week) => week.filter(d => new Date(year, month - 1, d).getDay() !== 0).length;

    let srNo = 1;
    let dataRow = 5;
    let currentDept = null;

    const HOURS_PER_DAY = 8;
    // Track row positions for Summary formula references
    // empRowMap[name] = { nameRow, projRows: { projName: rowNum } }
    const empRowMap = {};

    // Pre-compute day/weekly-pct column indices for Total Hours row SUM formulas
    const TOTAL_DEPTS     = ['executive team', 'qa'];
    const TOTAL_ROW_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    const dayColIndices   = [];
    const weekPctColIdxs  = [];
    let dayTrackCol = 4;
    weeks.forEach(week => {
        week.forEach(() => { dayColIndices.push(dayTrackCol++); });
        weekPctColIdxs.push(dayTrackCol++);
    });
    const totalHoursColIdx = dayTrackCol; // first summary col

    const writeDeptTotalRow = (startRow, endRow) => {
        const row = ws.getRow(dataRow);
        row.height = 18;
        ['', 'Total Hours', ''].forEach((v, i) => {
            const cell = row.getCell(i + 1);
            cell.value = v;
            cell.fill  = TOTAL_ROW_FILL;
            cell.font  = { bold: true, size: 10 };
            cell.alignment = i === 1 ? LEFT : CENTER;
            cell.border = CELL_BORDER;
        });
        dayColIndices.forEach(ci => {
            const letter = colToLetter(ci);
            const cell   = row.getCell(ci);
            cell.value   = { formula: `SUM(${letter}${startRow}:${letter}${endRow})` };
            cell.fill    = TOTAL_ROW_FILL;
            cell.font    = { bold: true, size: 10 };
            cell.alignment = CENTER;
            cell.border  = CELL_BORDER;
        });
        weekPctColIdxs.forEach(ci => {
            const letter = colToLetter(ci);
            const cell   = row.getCell(ci);
            cell.value   = { formula: `SUM(${letter}${startRow}:${letter}${endRow})` };
            cell.numFmt  = '0.00%';
            cell.fill    = TOTAL_ROW_FILL;
            cell.font    = { bold: true, size: 10 };
            cell.alignment = CENTER;
            cell.border  = CELL_BORDER;
        });
        const thLetter  = colToLetter(totalHoursColIdx);
        const thCell    = row.getCell(totalHoursColIdx);
        thCell.value    = { formula: `SUM(${thLetter}${startRow}:${thLetter}${endRow})` };
        thCell.fill     = TOTAL_ROW_FILL;
        thCell.font     = { bold: true, size: 10 };
        thCell.alignment = CENTER;
        thCell.border   = CELL_BORDER;
        const monthlyPctSummaryColIdx = totalHoursColIdx + 6; // last summary col
        for (let c = totalHoursColIdx + 1; c <= ws.columns.length; c++) {
            const cell  = row.getCell(c);
            cell.fill   = TOTAL_ROW_FILL;
            cell.border = CELL_BORDER;
            if (c === monthlyPctSummaryColIdx) {
                const letter   = colToLetter(c);
                cell.value     = { formula: `SUM(${letter}${startRow}:${letter}${endRow})` };
                cell.numFmt    = '0.00%';
                cell.font      = { bold: true, size: 10 };
                cell.alignment = CENTER;
            }
        }
        dataRow++;
    };

    // Helper to fill one project row (used for first row and sub-rows)
    const fillProjectRow = (row, fill, name, projName, isBold) => {
        // Calculate hours per day from timesheet
        let totalProjHours = 0;
        let colIdx = 4;
        weeks.forEach((week, wi) => {
            let weekHours = 0;
            week.forEach(d => {
                const h = tsHours(name, projName, year, month, d);
                const cell = row.getCell(colIdx++);
                cell.value = h || 0;
                cell.fill = fill;
                cell.font = { size: 10 };
                cell.alignment = CENTER;
                cell.border = CELL_BORDER;
                weekHours += h;
                totalProjHours += h;
            });
            // Weekly %
            const wDays = workingDaysInWeek(week);
            const wPct = wDays > 0 ? weekHours / (wDays * HOURS_PER_DAY) : 0;
            const wCell = row.getCell(colIdx++);
            wCell.value = parseFloat(wPct.toFixed(6));
            wCell.numFmt = '0.00%';
            wCell.fill = fill;
            wCell.font = { size: 10 };
            wCell.alignment = CENTER;
            wCell.border = CELL_BORDER;
        });

        // Summary columns: Total Hours, Total Days, Present Days, Week Off, Holiday, Leave, Monthly %
        const totalDays = daysInMonth;
        const presentDays = weeks.flat().filter(d => {
            const h = tsHours(name, projName, year, month, d);
            return h > 0;
        }).length;
        const weekOffDays = weeks.flat().filter(d => new Date(year, month - 1, d).getDay() === 0).length;
        const monthlyPctDecimal = workingDaysInMonth > 0
            ? totalProjHours / (workingDaysInMonth * HOURS_PER_DAY)
            : 0;

        const summaryVals = [
            { v: totalProjHours,                              fmt: null },
            { v: totalDays,                                   fmt: null },
            { v: presentDays,                                 fmt: null },
            { v: weekOffDays,                                 fmt: null },
            { v: 0,                                           fmt: null },
            { v: 0,                                           fmt: null },
            { v: parseFloat(monthlyPctDecimal.toFixed(6)),    fmt: '0.00%' },
        ];
        summaryVals.forEach(({ v, fmt }) => {
            const cell = row.getCell(colIdx++);
            cell.value = v;
            if (fmt) cell.numFmt = fmt;
            cell.fill = fill;
            cell.font = { size: 10 };
            cell.alignment = CENTER;
            cell.border = CELL_BORDER;
        });
    };

    for (const emp of employees) {
        const empDept = emp.DEPARTMENT_NAME || emp.DEPARTMENT || '';

        // Insert department section header when department changes
        if (empDept !== currentDept) {
            currentDept = empDept;
            const deptRow = ws.getRow(dataRow);
            deptRow.height = 20;
            ws.mergeCells(dataRow, 1, dataRow, ws.columns.length);
            const dc = deptRow.getCell(1);
            dc.value = empDept.toUpperCase();
            dc.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
            dc.fill = DEPT_FILL;
            dc.alignment = LEFT;
            dc.border = CELL_BORDER;
            dataRow++;
        }
        const name = [emp.FIRST_NAME, emp.MIDDLE_NAME, emp.LAST_NAME].filter(Boolean).join(' ') || emp.name || '—';
        const projects = emp.projects?.length ? emp.projects : ['(No project assigned)'];

        // Track for Summary formulas
        empRowMap[name] = { nameRow: dataRow, projRows: {} };

        // First project row — contains Sr No and Name
        const r = ws.getRow(dataRow);
        r.height = 18;
        r.getCell(1).value = srNo;
        r.getCell(2).value = name;
        r.getCell(3).value = projects[0];
        [1, 2, 3].forEach(c => {
            r.getCell(c).fill = EMP_FILL;
            r.getCell(c).font = { bold: c <= 2, size: 10 };
            r.getCell(c).alignment = c === 1 ? CENTER : LEFT;
            r.getCell(c).border = CELL_BORDER;
        });
        fillProjectRow(r, EMP_FILL, name, projects[0], true);
        empRowMap[name].projRows[projects[0]] = dataRow;
        dataRow++;

        // Additional project sub-rows
        for (let pi = 1; pi < projects.length; pi++) {
            const pr = ws.getRow(dataRow);
            pr.height = 16;
            pr.getCell(1).fill = PROJ_FILL; pr.getCell(1).border = CELL_BORDER;
            pr.getCell(2).fill = PROJ_FILL; pr.getCell(2).border = CELL_BORDER;
            pr.getCell(3).value = projects[pi];
            pr.getCell(3).fill = PROJ_FILL;
            pr.getCell(3).font = { size: 10 };
            pr.getCell(3).alignment = LEFT;
            pr.getCell(3).border = CELL_BORDER;
            fillProjectRow(pr, PROJ_FILL, name, projects[pi], false);
            empRowMap[name].projRows[projects[pi]] = dataRow;
            dataRow++;
        }

        // Write per-employee Total Hours row for Executive team and QA
        if (TOTAL_DEPTS.includes(empDept.toLowerCase())) {
            writeDeptTotalRow(empRowMap[name].nameRow, dataRow - 1);
        }

        srNo++;
    }

    // ── Sheet 2: Summary (Employee × Project monthly %) ──────────────────────
    const allProjects = [...new Set(
        employees.flatMap(e => e.projects?.length ? e.projects : [])
    )].sort();

    const ws2 = wb.addWorksheet('Summary');
    ws2.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];

    // Row 1: project index numbers
    const s2Row1 = ws2.getRow(1);
    allProjects.forEach((_, pi) => {
        const cell = s2Row1.getCell(4 + pi);
        cell.value = pi + 1;
        cell.font = { bold: true, size: 10 };
        cell.alignment = CENTER;
        cell.border = CELL_BORDER;
    });

    // Row 2: Sr No | Team Name | (blank) | project names...
    const s2ColHdr = ws2.getRow(2);
    s2ColHdr.height = 28;
    ['Sr No', 'Team Name', ''].forEach((h, i) => {
        const cell = s2ColHdr.getCell(i + 1);
        cell.value = h;
        cell.font = HEADER_FONT;
        cell.fill = HEADER_FILL;
        cell.alignment = i === 1 ? LEFT : CENTER;
        cell.border = CELL_BORDER;
    });
    allProjects.forEach((p, pi) => {
        const cell = s2ColHdr.getCell(4 + pi);
        cell.value = p;
        cell.font = HEADER_FONT;
        cell.fill = HEADER_FILL;
        cell.alignment = CENTER;
        cell.border = CELL_BORDER;
    });
    const total1Col   = 4 + allProjects.length;       // Sum of projects
    const nonUtilCol  = total1Col + 1;                 // 1 - Total1
    const totalCol    = nonUtilCol + 1;                // Total1 + Non Utilize

    const styleHdr = (cell, label, fill) => {
        cell.value = label;
        cell.font = HEADER_FONT;
        cell.fill = fill;
        cell.alignment = CENTER;
        cell.border = CELL_BORDER;
    };
    styleHdr(s2ColHdr.getCell(total1Col),  'Total',       HEADER_FILL);
    styleHdr(s2ColHdr.getCell(nonUtilCol), 'Non Utilize', HEADER_FILL);
    styleHdr(s2ColHdr.getCell(totalCol),   'Total',       HEADER_FILL);

    ws2.getColumn(1).width = 7;
    ws2.getColumn(2).width = 24;
    ws2.getColumn(3).width = 5;
    allProjects.forEach((_, pi) => { ws2.getColumn(4 + pi).width = 14; });
    ws2.getColumn(total1Col).width  = 10;
    ws2.getColumn(nonUtilCol).width = 12;
    ws2.getColumn(totalCol).width   = 10;

    // Column letter of Monthly % in Team Allocation sheet (last column)
    const monthlyPctCol      = colToLetter(ws.columns.length);
    const firstProjColLetter = colToLetter(4);
    const lastProjColLetter  = colToLetter(3 + allProjects.length);
    const total1ColLetter    = colToLetter(total1Col);
    const nonUtilColLetter   = colToLetter(nonUtilCol);
    const totalColLetter     = colToLetter(totalCol);

    // Data rows: one per employee, formulas referencing Team Allocation sheet
    employees.forEach((emp, idx) => {
        const name = [emp.FIRST_NAME, emp.MIDDLE_NAME, emp.LAST_NAME].filter(Boolean).join(' ') || emp.name || '—';
        const s2RowNum = 3 + idx;
        const row = ws2.getRow(s2RowNum);
        row.height = 18;

        const empInfo = empRowMap[name];
        const altFill = idx % 2 === 0
            ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }
            : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        // Sr No
        row.getCell(1).value = idx + 1;
        // Employee name — formula from Team Allocation col B
        row.getCell(2).value = empInfo
            ? { formula: `'Team Allocation'!B${empInfo.nameRow}` }
            : name;
        row.getCell(3).value = '';

        [1, 2, 3].forEach(c => {
            row.getCell(c).border = CELL_BORDER;
            row.getCell(c).font = { size: 10 };
            row.getCell(c).alignment = c === 2 ? LEFT : CENTER;
            row.getCell(c).fill = altFill;
        });

        // Monthly % per project — formula from Monthly % col of that project's row
        allProjects.forEach((proj, pi) => {
            const projRow = empInfo?.projRows?.[proj];
            const cell = row.getCell(4 + pi);
            cell.value = projRow
                ? { formula: `IFERROR('Team Allocation'!${monthlyPctCol}${projRow},0)` }
                : 0;
            cell.numFmt = '0.00%';
            cell.font = { size: 10 };
            cell.alignment = CENTER;
            cell.border = CELL_BORDER;
            cell.fill = altFill;
        });

        // Total1 = SUM of all project % columns
        const t1Cell = row.getCell(total1Col);
        t1Cell.value = { formula: `SUM(${firstProjColLetter}${s2RowNum}:${lastProjColLetter}${s2RowNum})` };
        t1Cell.numFmt = '0.00%';
        t1Cell.font = { bold: true, size: 10 };
        t1Cell.alignment = CENTER;
        t1Cell.border = CELL_BORDER;
        t1Cell.fill = altFill;

        // Non Utilize = MAX(0, 1 - Total1)
        const nuCell = row.getCell(nonUtilCol);
        nuCell.value = { formula: `MAX(0,1-${total1ColLetter}${s2RowNum})` };
        nuCell.numFmt = '0.00%';
        nuCell.font = { size: 10 };
        nuCell.alignment = CENTER;
        nuCell.border = CELL_BORDER;
        nuCell.fill = altFill;

        // Total (final) = Total1 + Non Utilize
        const tCell = row.getCell(totalCol);
        tCell.value = { formula: `${total1ColLetter}${s2RowNum}+${nonUtilColLetter}${s2RowNum}` };
        tCell.numFmt = '0.00%';
        tCell.font = { bold: true, size: 10 };
        tCell.alignment = CENTER;
        tCell.border = CELL_BORDER;
        tCell.fill = altFill;
    });


    // ── Sheet 3: Allocation (Employee × Project cost) ────────────────────────
    const ws3 = wb.addWorksheet('Allocation');
    ws3.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];

    const SALARY_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };

    // Column widths
    ws3.getColumn(1).width = 7;
    ws3.getColumn(2).width = 24;
    ws3.getColumn(3).width = 18;
    allProjects.forEach((_, pi) => { ws3.getColumn(4 + pi).width = 14; });
    const a3Total1Col  = 4 + allProjects.length;
    const a3NonUtilCol = a3Total1Col + 1;
    const a3TotalCol   = a3NonUtilCol + 1;
    ws3.getColumn(a3Total1Col).width  = 14;
    ws3.getColumn(a3NonUtilCol).width = 14;
    ws3.getColumn(a3TotalCol).width   = 14;

    // Row 1: header — blank | Team Name | Monthly Salary | project names from Summary
    const a1 = ws3.getRow(1);
    a1.height = 28;
    [
        { c: 1, val: '',               fill: HEADER_FILL },
        { c: 2, val: { formula: `Summary!B2` }, fill: HEADER_FILL },
        { c: 3, val: 'Monthly Salary', fill: HEADER_FILL },
    ].forEach(({ c, val, fill }) => {
        const cell = a1.getCell(c);
        cell.value = val;
        cell.font = HEADER_FONT;
        cell.fill = fill;
        cell.alignment = c === 2 ? LEFT : CENTER;
        cell.border = CELL_BORDER;
    });
    allProjects.forEach((_, pi) => {
        const cell = a1.getCell(4 + pi);
        cell.value = { formula: `Summary!${colToLetter(4 + pi)}2` };
        cell.font = HEADER_FONT;
        cell.fill = HEADER_FILL;
        cell.alignment = CENTER;
        cell.border = CELL_BORDER;
    });
    [
        { c: a3Total1Col,  v: 'Total'       },
        { c: a3NonUtilCol, v: 'Non Utilize' },
        { c: a3TotalCol,   v: 'Total'       },
    ].forEach(({ c, v }) => {
        const cell = a1.getCell(c);
        cell.value = v;
        cell.font = HEADER_FONT;
        cell.fill = HEADER_FILL;
        cell.alignment = CENTER;
        cell.border = CELL_BORDER;
    });

    // Data rows: one per employee
    employees.forEach((_, idx) => {
        const s2Row  = 3 + idx;   // corresponding row in Summary sheet
        const a3Row  = 2 + idx;   // row in this Allocation sheet
        const row = ws3.getRow(a3Row);
        row.height = 18;

        const altFill = idx % 2 === 0
            ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }
            : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        // Sr No
        const srCell = row.getCell(1);
        srCell.value = idx + 1;
        srCell.font = { size: 10 };
        srCell.alignment = CENTER;
        srCell.border = CELL_BORDER;
        srCell.fill = altFill;

        // Employee name — formula from Summary col B
        const nameCell = row.getCell(2);
        nameCell.value = { formula: `Summary!B${s2Row}` };
        nameCell.font = { size: 10 };
        nameCell.alignment = LEFT;
        nameCell.border = CELL_BORDER;
        nameCell.fill = altFill;

        // Monthly salary from API (CTC/12), yellow if missing so user can fill
        const empCode = employees[idx].ASAN_EMPCODE;
        const monthlySal = salaryMap[empCode] || 0;
        const salCell = row.getCell(3);
        salCell.value = monthlySal > 0 ? parseFloat(monthlySal.toFixed(2)) : '';
        salCell.numFmt = '#,##0.00';
        salCell.font = { size: 10 };
        salCell.alignment = CENTER;
        salCell.border = CELL_BORDER;
        salCell.fill = monthlySal > 0 ? altFill : SALARY_FILL;

        // Cost per project = $C$row × Summary!ProjectCol$s2Row
        allProjects.forEach((_, pi) => {
            const s2ProjCol = colToLetter(4 + pi);
            const cell = row.getCell(4 + pi);
            cell.value = { formula: `IFERROR($C$${a3Row}*Summary!${s2ProjCol}${s2Row},0)` };
            cell.numFmt = '#,##0.00';
            cell.font = { size: 10 };
            cell.alignment = CENTER;
            cell.border = CELL_BORDER;
            cell.fill = altFill;
        });

        const firstProjLetter = colToLetter(4);
        const lastProjLetter  = colToLetter(3 + allProjects.length);
        const a3T1Letter      = colToLetter(a3Total1Col);
        const a3NuLetter      = colToLetter(a3NonUtilCol);

        // Total = SUM of all project cost columns
        const t1 = row.getCell(a3Total1Col);
        t1.value = { formula: `SUM(${firstProjLetter}${a3Row}:${lastProjLetter}${a3Row})` };
        t1.numFmt = '#,##0.00'; t1.font = { bold: true, size: 10 };
        t1.alignment = CENTER; t1.border = CELL_BORDER; t1.fill = altFill;

        // Non Utilize = Monthly Salary - Total
        const nu = row.getCell(a3NonUtilCol);
        nu.value = { formula: `IFERROR($C$${a3Row}-${a3T1Letter}${a3Row},0)` };
        nu.numFmt = '#,##0.00'; nu.font = { size: 10 };
        nu.alignment = CENTER; nu.border = CELL_BORDER; nu.fill = altFill;

        // Total (final) = Total + Non Utilize = Monthly Salary
        const tf = row.getCell(a3TotalCol);
        tf.value = { formula: `${a3T1Letter}${a3Row}+${a3NuLetter}${a3Row}` };
        tf.numFmt = '#,##0.00'; tf.font = { bold: true, size: 10 };
        tf.alignment = CENTER; tf.border = CELL_BORDER; tf.fill = altFill;
    });

    return wb;
};
