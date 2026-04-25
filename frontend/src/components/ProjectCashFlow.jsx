import { useState, Fragment } from 'react'

const fmt = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Math.abs(value))

const fmtAmt    = (val) => (val > 0 ? fmt(val) : null)
const fmtOrDash = (val) => (val > 0 ? fmt(val) : '—')

export default function ProjectCashFlow({ data, queryParams = '' }) {
  const [expandState, setExpandState] = useState({})
  const [expandData, setExpandData]   = useState({})
  const [exporting, setExporting]     = useState(false)

  // Pre-warm cache so export is instant when clicked
  useState(() => { fetch(`/api/dashboard/project-cashflow-warm-cache${queryParams}`).catch(() => {}) })

  async function exportProjectExcel() {
    setExporting(true)
    try {
      let companyName = '', fyLabel = ''
      try {
        const cfg = await fetch('/api/dashboard/current-company').then(r => r.json())
        if (cfg.success) { companyName = cfg.data.companyName || ''; fyLabel = cfg.data.fyLabel || '' }
      } catch { /* use empty strings */ }

      // Fetch each project's expand data in parallel
      const expandResults = await Promise.all(
        data.map(async row => {
          try {
            const sep = queryParams ? '&' : '?'
            const res  = await fetch(`/api/dashboard/project-cashflow-expand${queryParams}${sep}project=${encodeURIComponent(row.project)}`)
            const json = await res.json()
            if (json.success && json.data) return json.data
          } catch { /* ignored */ }
          return { project: row.project, items: [], from: null, to: null }
        })
      )

      /* ── ASANIFY NAME-MATCHING LOGIC (commented out — will be replaced by Tally cost centre tags) ──
      const [expandResults, rawEmpJson] = await Promise.all([
        Promise.all(data.map(async row => { ... })),
        fetch('/api/asanify/employees').then(r => r.json()).catch(() => ({ success: false }))
      ])
      const siteTeamNames    = new Set()
      const centralTeamNames = new Set()
      if (rawEmpJson.success && Array.isArray(rawEmpJson.employees)) {
        for (const emp of rawEmpJson.employees) {
          const dept = (emp.DEPARTMENT_NAME || emp.DEPARTMENT || '').toLowerCase()
          const name = [emp.FIRST_NAME, emp.MIDDLE_NAME, emp.LAST_NAME]
            .filter(Boolean).join(' ').trim().toLowerCase()
          if (!name) continue
          if (dept.includes('site')) siteTeamNames.add(name)
          if (dept.includes('executive') || dept.includes('qa')) centralTeamNames.add(name)
        }
      }
      ── END ASANIFY LOGIC ── */
      const siteTeamNames    = new Set()
      const centralTeamNames = new Set()

      // 4 Tally expense type cost centre names (lowercase for case-insensitive matching)
      const EXPENSE_TYPE_NAMES = ['site salary direct', 'site overhead', 'central site variable', 'central common overhead']

      const allExpandData = {}
      let from = '', to = ''
      for (const r of expandResults) {
        allExpandData[r.project] = { items: r.items || [], expTypePairs: r.expTypePairs || {} }
        if (r.from && !from) from = r.from
        if (r.to   && !to)   to   = r.to
      }

      // Convert "April 2022" → "202204" for pairMap lookups (pairMap uses YYYYMM keys)
      function labelToYYYYMM(label) {
        const parts = label.split(' ')
        const mi = MN.indexOf(parts[0]) + 1
        return `${parts[1]}${String(mi).padStart(2, '0')}`
      }

      // Generate months from actual period (same logic as backend generateMonthSlots)
      const MN = ['January','February','March','April','May','June','July','August','September','October','November','December']
      function genMonthLabels(f, t) {
        if (!f || !t) {
          const fy = new Date().getFullYear()
          return [...[4,5,6,7,8,9,10,11,12].map(m => `${MN[m-1]} ${fy}`), ...[1,2,3].map(m => `${MN[m-1]} ${fy+1}`)]
        }
        const labels = []
        let y = parseInt(f.substring(0,4)), m = parseInt(f.substring(4,6))
        const ey = parseInt(t.substring(0,4)), em = parseInt(t.substring(4,6))
        while (y < ey || (y === ey && m <= em)) {
          labels.push(`${MN[m-1]} ${y}`)
          if (++m > 12) { m = 1; y++ }
        }
        return labels
      }
      const months = genMonthLabels(from, to)

      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()

      function applyStyle(cell, { bg, color, bold, border, indent } = {}) {
        if (bg)    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } }
        cell.font = { name: 'Calibri', size: 12, bold: !!bold, ...(color ? { color: { argb: 'FF' + color } } : {}) }
        if (typeof cell.value === 'number') cell.numFmt = '#,##0.00'
        if (border) { const s = { style: border === 'medium' ? 'medium' : 'thin' }; cell.border = { top:s, left:s, bottom:s, right:s } }
        if (indent && cell.col === 1) cell.alignment = { indent }
      }

      function getItemMonthVal(item, monthLabel, side) {
        const m = item.months?.find(mo => mo.month === monthLabel)
        return m ? (m[side] || 0) : 0
      }

      function getProjectMonthVal(projectName, monthLabel, side) {
        const items = allExpandData[projectName]?.items || []
        return items.reduce((sum, item) => sum + getItemMonthVal(item, monthLabel, side), 0)
      }

      function buildLedgerDetails(item, monthLabels, side, itemExpTypePairs = null) {
        const map = {}
        const rawLP = {}  // label → { ledger, party } for expense type classification
        for (const mo of item.months || []) {
          for (const e of mo.entries || []) {
            if (!(e[side] > 0)) continue
            const label = e.party ? `${e.ledger} ↳ ${e.party}` : e.ledger
            if (!map[label]) {
              map[label] = {}
              rawLP[label] = { ledger: e.ledger, party: e.party || '' }
              /* ── ASANIFY CLASSIFICATION (commented out — replaced by Tally expense type tags below) ──
              if (side === 'debit') {
                const ledger = (e.ledger || '').trim().toLowerCase()
                const party  = (e.party  || '').trim().toLowerCase()
                const isSalary     = ledger.includes('salary')
                const isSiteEmp    = [...siteTeamNames].some(n => party.includes(n))
                const isCentralEmp = [...centralTeamNames].some(n => party.includes(n))
                ...
              }
              ── END ASANIFY CLASSIFICATION ── */
            }
            map[label][mo.month] = (map[label][mo.month] || 0) + e[side]
          }
        }
        return Object.entries(map).map(([label, byMonth]) => {
          // For debit rows, compute per-month expense type tagging.
          // monthCats[etName] = Set of month labels where this row is tagged to that expense type.
          // A row may be tagged in April only — so only April's column gets the SUM formula reference.
          let monthCats = null
          if (side === 'debit' && itemExpTypePairs) {
            const { ledger, party } = rawLP[label]
            const compositeKey = `${ledger}||${party}`
            for (const etName of EXPENSE_TYPE_NAMES) {
              const etPairs = itemExpTypePairs[etName] || {}
              const tagged = new Set()
              for (const ml of monthLabels) {
                // Backend pairMap key: "YYYYMM::ledger||party" — directly records which
                // voucher lines were tagged to this expense type CC alongside this project CC.
                if (etPairs[`${labelToYYYYMM(ml)}::${compositeKey}`]) tagged.add(ml)
              }
              if (tagged.size > 0) {
                if (!monthCats) monthCats = {}
                monthCats[etName] = tagged
              }
            }
          }
          return {
            label,
            monthCats,
            amounts: monthLabels.map(ml => byMonth[ml] || ''),
            total: Object.values(byMonth).reduce((s, v) => s + v, 0),
          }
        })
      }

      const usedSheetNames = {}
      function makeSheetName(name) {
        let s = name.replace(/[\\\/\?\*\[\]:]/g, '').trim().substring(0, 31) || 'Sheet'
        if (usedSheetNames[s]) { const sfx = ` ${++usedSheetNames[s]}`; s = s.substring(0, 31 - sfx.length) + sfx }
        else usedSheetNames[s] = 1
        return s
      }

      function setupSheet(ws) {
        ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2' }]
        ws.getColumn(1).width = 36
        months.forEach((_, i) => { ws.getColumn(i + 2).width = 14 })
        ws.getColumn(months.length + 2).width = 14
        ws.addRow(['', ...months, 'Total'])
          .eachCell(c => applyStyle(c, { bold: true, border: 'medium' }))
      }

      function cletter(n) {
        let s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); } return s;
      }
      const FMT           = '#,##0.00'
      const totalCol      = months.length + 2
      const lastMonthCol  = months.length + 1
      const lastMonthLtr  = cletter(lastMonthCol)
      const totalColLtr   = cletter(totalCol)

      function writeLedgerRow(ws, label, amounts) {
        const r  = ws.addRow([`        ${label}`, ...amounts])
        const rn = r.number
        r.getCell(totalCol).value  = { formula: `SUM(B${rn}:${lastMonthLtr}${rn})` }
        for (let c = 1; c <= totalCol; c++) {
          const cell = r.getCell(c)
          if (c > 1) cell.numFmt = FMT
          applyStyle(cell, { border: true })
        }
        return rn
      }

      function writeTotalRow(ws, label, firstDataRow, lastDataRow, fallbackVals) {
        const row = ws.addRow([label])
        applyStyle(row.getCell(1), { bold: true, border: 'medium' })
        const rn = row.number
        for (let i = 0; i < months.length; i++) {
          const col  = i + 2
          const cell = row.getCell(col)
          cell.value = (firstDataRow !== null)
            ? { formula: `SUM(${cletter(col)}${firstDataRow}:${cletter(col)}${lastDataRow})` }
            : (fallbackVals[i] || 0)
          cell.numFmt = FMT
          applyStyle(cell, { bold: true, border: 'medium' })
        }
        const totCell   = row.getCell(totalCol)
        totCell.value   = { formula: `SUM(B${rn}:${lastMonthLtr}${rn})` }
        totCell.numFmt  = FMT
        applyStyle(totCell, { bold: true, border: 'medium' })
        return rn
      }

      function writeItemSection(ws, item, headerName, isProject = false, expTypeItems = {}, itemExpTypePairs = null) {
        ws.addRow([headerName]).eachCell(c => applyStyle(c, { bold: true, border: true }))

        let creditFirst = null, creditLast = null
        if (item.grandCredit > 0) {
          ws.addRow([`    ${item.name} — Fee Received`, ...months.map(() => ''), ''])
            .eachCell(c => applyStyle(c, { border: true }))
          for (const d of buildLedgerDetails(item, months, 'credit')) {
            const rn = writeLedgerRow(ws, d.label, d.amounts)
            if (creditFirst === null) creditFirst = rn
            creditLast = rn
          }
        }
        ws.addRow([])
        const feeRn = writeTotalRow(ws, '  Total Fee Received', creditFirst, creditLast,
          months.map(ml => getItemMonthVal(item, ml, 'credit')))
        ws.addRow([])

        let debitFirst = null, debitLast = null
        // Per-month row tracking: expTypeMonthRows[etName][monthIdx] = [row numbers]
        // Each month column independently references only rows tagged to that expense type in that month.
        const expTypeMonthRows = {}
        for (const etName of EXPENSE_TYPE_NAMES) expTypeMonthRows[etName] = {}
        if (item.grandDebit > 0) {
          ws.addRow([`    ${item.name} — Expenses`, ...months.map(() => ''), ''])
            .eachCell(c => applyStyle(c, { border: true }))
          const _allDebitDetails = buildLedgerDetails(item, months, 'debit', itemExpTypePairs)
          // Check only the ledger name (before ↳) — party names like "CHETAN SALARY A/C" must not match
          const _isSalaryRow = (d) => d.label.split(' ↳ ')[0].toLowerCase().includes('salary')
          const _salaryDetails = isProject ? _allDebitDetails.filter(_isSalaryRow) : []
          const _otherDetails  = isProject ? _allDebitDetails.filter(d => !_isSalaryRow(d)) : _allDebitDetails
          const _writeDebitRow = (d) => {
            const rn = writeLedgerRow(ws, d.label, d.amounts)
            if (debitFirst === null) debitFirst = rn
            debitLast = rn
            if (d.monthCats) {
              for (const [etName, taggedMonths] of Object.entries(d.monthCats)) {
                months.forEach((ml, idx) => {
                  if (taggedMonths.has(ml)) {
                    if (!expTypeMonthRows[etName][idx]) expTypeMonthRows[etName][idx] = []
                    expTypeMonthRows[etName][idx].push(rn)
                  }
                })
              }
            }
          }
          for (const d of _salaryDetails) _writeDebitRow(d)
          if (_salaryDetails.length > 0 && _otherDetails.length > 0) {
            ws.addRow([])
            ws.addRow([`    ${item.name} — Other Expenses`, ...months.map(() => ''), ''])
              .eachCell(c => applyStyle(c, { border: true }))
          }
          for (const d of _otherDetails) _writeDebitRow(d)
        }
        ws.addRow([])
        const expRn = writeTotalRow(ws, '  Total Expenses', debitFirst, debitLast,
          months.map(ml => getItemMonthVal(item, ml, 'debit')))
        ws.addRow([])

        // Net (Fee − Expenses) — formula referencing the two total rows
        const netRow = ws.addRow(['  Net (Fee − Expenses)'])
        applyStyle(netRow.getCell(1), { bold: true, border: 'medium' })
        for (let i = 0; i < months.length; i++) {
          const col  = i + 2
          const cell = netRow.getCell(col)
          cell.value  = { formula: `${cletter(col)}${feeRn}-${cletter(col)}${expRn}` }
          cell.numFmt = FMT
          applyStyle(cell, { bold: true, border: 'medium' })
        }
        const netTot   = netRow.getCell(totalCol)
        netTot.value   = { formula: `${totalColLtr}${feeRn}-${totalColLtr}${expRn}` }
        netTot.numFmt  = FMT
        applyStyle(netTot, { bold: true, border: 'medium' })

        // 4 expense type rows — only for project sheets, sourced from Tally expense type cost centres
        if (!isProject) { ws.addRow([]); return }
        ws.addRow([])
        ws.addRow([])

        /* ── OLD ASANIFY APPROACH (commented out — kept for reference) ──
        function makeRefFormula(col, rowNums) {
          if (rowNums.length === 0) return 0
          return { formula: `SUM(${rowNums.map(rn => `${cletter(col)}${rn}`).join(',')})` }
        }
        function writeCalcRow(ws, label, rowNums) { ... }
        writeCalcRow(ws, '  Site Salary Direct',   siteSalaryRows)
        writeCalcRow(ws, '  Site Overhead',         siteOverheadRows)
        writeCalcRow(ws, '  Central Site Variable', centralSalaryRows)
        ── END OLD APPROACH ── */

        function writeExpTypeRow(label, key) {
          const monthRowNums = expTypeMonthRows[key] || {}
          const eRow = ws.addRow([label, ...months.map(() => '')])
          applyStyle(eRow.getCell(1), { bold: true, border: 'medium' })
          const rn = eRow.number
          for (let i = 0; i < months.length; i++) {
            const col      = i + 2
            const cell     = eRow.getCell(col)
            const rowNums  = monthRowNums[i] || []
            // Per-month SUM: only references rows tagged to this expense type in this specific month
            cell.value  = rowNums.length > 0
              ? { formula: `SUM(${rowNums.map(r => `${cletter(col)}${r}`).join(',')})` }
              : 0
            cell.numFmt = FMT
            applyStyle(cell, { bold: true, border: 'medium' })
          }
          const totCell = eRow.getCell(totalCol)
          totCell.value  = { formula: `SUM(B${rn}:${lastMonthLtr}${rn})` }
          totCell.numFmt = FMT
          applyStyle(totCell, { bold: true, border: 'medium' })
        }

        writeExpTypeRow('  Site Salary Direct',    'site salary direct')
        writeExpTypeRow('  Site Overhead',          'site overhead')
        writeExpTypeRow('  Central Site Variable',  'central site variable')
        writeExpTypeRow('  Central Common Overhead','central common overhead')

        ws.addRow([])
      }

      // Reserve P&L Summary as tab #1, Overhead as tab #2 — both populated after project sheets
      const plWs  = wb.addWorksheet('P&L Summary')
      const ovhWs = wb.addWorksheet('Overhead')

      // Detect the Projects category name dynamically (whatever Tally calls it)
      const projectsCategoryName = data.find(r => {
        const cat = (r.category || '').toLowerCase()
        return cat.includes('project')
      })?.category || 'Projects'

      for (const row of data) {
        const allItems = (allExpandData[row.project]?.items || [])
          .filter(item => item.grandDebit > 0 || item.grandCredit > 0)

        const projectItems = allItems
        const expTypeItems = {}
        // expTypePairs keyed by CC name (item.name) — passed to writeItemSection for each item
        const projectExpTypePairs = allExpandData[row.project]?.expTypePairs || {}

        const isProjectsCategory = row.category === projectsCategoryName

        if (isProjectsCategory && projectItems.length > 1) {
          // Projects with multiple sub-CCs — one sheet per sub-CC
          for (const item of projectItems) {
            const ws = wb.addWorksheet(makeSheetName(item.name))
            setupSheet(ws)
            writeItemSection(ws, item, item.name, true, expTypeItems, projectExpTypePairs[item.name] || null)
          }
        } else {
          // Establishment items OR single-CC projects — one sheet per project
          const ws = wb.addWorksheet(makeSheetName(row.project))
          setupSheet(ws)
          if (projectItems.length === 1) writeItemSection(ws, projectItems[0], row.project, isProjectsCategory, expTypeItems, projectExpTypePairs[projectItems[0].name] || null)
          else if (projectItems.length > 1) {
            // Establishment: write all sub-CCs stacked on one sheet
            for (const item of projectItems) writeItemSection(ws, item, item.name, false, {}, null)
          }
        }
      }

      // ── P&L Summary Sheet ──────────────────────────────────────────────────────
      {
        const C = { sr:1, proj:2, totalIn:3, ssd:4, so:5, csv:6, cco:7, totalOut:8, pl:9, ratio:10 }
        plWs.getColumn(C.sr).width      = 6
        plWs.getColumn(C.proj).width    = 32
        ;[C.totalIn,C.ssd,C.so,C.csv,C.cco,C.totalOut,C.pl].forEach(c => { plWs.getColumn(c).width = 18 })
        plWs.getColumn(C.ratio).width   = 10
        plWs.views = [{ state: 'frozen', xSplit: 0, ySplit: 2 }]

        const fyTitle = (from && to)
          ? `${MN[parseInt(from.substring(4,6))-1]} ${from.substring(0,4)} – ${MN[parseInt(to.substring(4,6))-1]} ${to.substring(0,4)}`
          : ''

        // Title row
        const tRow = plWs.addRow([`Project P&L Summary  |  ${fyTitle}`, ...Array(9).fill('')])
        plWs.mergeCells('A1:J1')
        applyStyle(tRow.getCell(1), { bold: true, border: true })

        // Column header row
        const hRow = plWs.addRow(['Sr', 'Project', 'Total In', 'Site Salary Direct', 'Site Overhead', 'Central Site Variable', 'Central Common Overhead', 'Total Out', 'P & L', 'Ratio'])
        hRow.eachCell(c => applyStyle(c, { bold: true, border: true }))

        // Helper: sum expense type amounts from expTypePairs
        const getExpTotal = (expTypePairs, etKey) => {
          let t = 0
          for (const etMap of Object.values(expTypePairs || {})) {
            for (const amt of Object.values(etMap[etKey] || {})) t += amt
          }
          return t
        }

        const projRows = data.filter(r => r.category === projectsCategoryName)
        let sr = 1, dataFirst = null, dataLast = null

        // Write one flat P&L row; tracks dataFirst/dataLast for Sub Total range SUM
        const addPlRow = (label, totalIn, ssd, so, csv, cco) => {
          if (!totalIn && !ssd && !so && !csv && !cco) return  // skip all-zero rows
          const rn = plWs.rowCount + 1
          const pRow = plWs.addRow([
            sr++, label, totalIn, ssd, so, csv, cco,
            { formula: `SUM(D${rn}:G${rn})` },
            { formula: `C${rn}-H${rn}` },
            { formula: `IF(C${rn}>0,I${rn}/C${rn},0)` }
          ])
          pRow.eachCell(c => applyStyle(c, { border: true }))
          ;[C.totalIn,C.ssd,C.so,C.csv,C.cco,C.totalOut,C.pl].forEach(c => { pRow.getCell(c).numFmt = FMT })
          pRow.getCell(C.ratio).numFmt = '0.00%'
          if (dataFirst === null) dataFirst = rn
          dataLast = rn
        }

        for (const row of projRows) {
          const items   = allExpandData[row.project]?.items || []
          const etPairs = allExpandData[row.project]?.expTypePairs || {}
          // Parent CC: has items with names OTHER than itself (e.g. Pmc has items Pmc+CSI+HVT)
          const isParent = items.length > 0 && items.some(i => i.name !== row.project)

          if (isParent) {
            // One row per item — first the self-named item (parent's own direct data),
            // then each sub-CC item (CSI PROJECT, HVT PROJECT, HLE, …)
            // Sub Total sums ALL of these; total = same as the old single-row aggregate
            for (const item of items) {
              const sub = etPairs[item.name] ? { [item.name]: etPairs[item.name] } : {}
              addPlRow(item.name,
                item.grandCredit || 0,
                getExpTotal(sub, 'site salary direct'),
                getExpTotal(sub, 'site overhead'),
                getExpTotal(sub, 'central site variable'),
                getExpTotal(sub, 'central common overhead')
              )
            }
          } else {
            // Leaf row: single item, use row.project as label
            addPlRow(row.project,
              items.reduce((s, i) => s + (i.grandCredit || 0), 0),
              getExpTotal(etPairs, 'site salary direct'),
              getExpTotal(etPairs, 'site overhead'),
              getExpTotal(etPairs, 'central site variable'),
              getExpTotal(etPairs, 'central common overhead')
            )
          }
        }

        if (dataFirst !== null) {
          // Sub Total: simple range SUM over all data rows
          const stRn = plWs.rowCount + 1
          const stRow = plWs.addRow([
            '', 'Sub Total',
            { formula: `SUM(C${dataFirst}:C${dataLast})` },
            { formula: `SUM(D${dataFirst}:D${dataLast})` },
            { formula: `SUM(E${dataFirst}:E${dataLast})` },
            { formula: `SUM(F${dataFirst}:F${dataLast})` },
            { formula: `SUM(G${dataFirst}:G${dataLast})` },
            { formula: `SUM(H${dataFirst}:H${dataLast})` },
            { formula: `SUM(I${dataFirst}:I${dataLast})` },
            { formula: `IF(C${stRn}>0,I${stRn}/C${stRn},0)` }
          ])
          stRow.eachCell(c => applyStyle(c, { bold: true, border: 'medium' }))
          ;[C.totalIn,C.ssd,C.so,C.csv,C.cco,C.totalOut,C.pl].forEach(c => { stRow.getCell(c).numFmt = FMT })
          stRow.getCell(C.ratio).numFmt = '0.00%'

          plWs.addRow([])

          // Fixed & Variable Overhead rows (from Establishment category)
          const estCat2 = data.find(r => (r.category || '').toLowerCase().includes('establishment'))?.category
          const fixedTotal = estCat2
            ? data.filter(r => r.category === estCat2 && r.project.toLowerCase().includes('fixed'))
                .reduce((s, r) => s + (allExpandData[r.project]?.items || []).reduce((ss, i) => ss + (i.grandDebit || 0), 0), 0)
            : 0
          const varTotal = estCat2
            ? data.filter(r => r.category === estCat2 && r.project.toLowerCase().includes('variable'))
                .reduce((s, r) => s + (allExpandData[r.project]?.items || []).reduce((ss, i) => ss + (i.grandDebit || 0), 0), 0)
            : 0

          const fixRn = plWs.rowCount + 1
          const fixRow = plWs.addRow(['', 'Fixed Overhead', '', '', '', '', '', fixedTotal, '', ''])
          fixRow.eachCell(c => applyStyle(c, { border: true }))
          fixRow.getCell(C.totalOut).numFmt = FMT

          const varRn = plWs.rowCount + 1
          const varRow = plWs.addRow(['', 'Variable Overhead', '', '', '', '', '', varTotal, '', ''])
          varRow.eachCell(c => applyStyle(c, { border: true }))
          varRow.getCell(C.totalOut).numFmt = FMT

          // Grand Total
          const gtRn = plWs.rowCount + 1
          const gtRow = plWs.addRow([
            '', 'Grand Total',
            { formula: `C${stRn}` },
            { formula: `D${stRn}` },
            { formula: `E${stRn}` },
            { formula: `F${stRn}` },
            { formula: `G${stRn}` },
            { formula: `H${stRn}+H${fixRn}+H${varRn}` },
            { formula: `C${gtRn}-H${gtRn}` },
            { formula: `IF(C${gtRn}>0,I${gtRn}/C${gtRn},0)` }
          ])
          gtRow.eachCell(c => applyStyle(c, { bold: true, border: 'medium' }))
          ;[C.totalIn,C.ssd,C.so,C.csv,C.cco,C.totalOut,C.pl].forEach(c => { gtRow.getCell(c).numFmt = FMT })
          gtRow.getCell(C.ratio).numFmt = '0.00%'
        }
      }
      // ── End P&L Summary Sheet ─────────────────────────────────────────────────

      // ── Overhead Sheet (Establishment category, fully dynamic) ────────────────
      const estCatName = data.find(r => (r.category || '').toLowerCase().includes('establishment'))?.category
      if (!estCatName) {
        wb.removeWorksheet(ovhWs.id)
      } else {
        const estRows = data
          .filter(r => r.category === estCatName)
          .filter(r => (allExpandData[r.project]?.items || []).some(i => i.grandDebit > 0 || i.grandCredit > 0))

        if (estRows.length > 0) {
          const ws = ovhWs
          ws.getColumn(1).width = 36
          months.forEach((_, i) => { ws.getColumn(i + 2).width = 14 })
          ws.getColumn(months.length + 2).width = 14
          ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]

          const totalCol     = months.length + 2
          const lastMonthLtr = String.fromCharCode(65 + months.length)
          const col          = (i) => String.fromCharCode(66 + i)

          // Header row
          const hRow = ws.addRow(['', ...months.map(m => m.split(' ')[0]), 'Total'])
          hRow.eachCell(c => applyStyle(c, { bold: true, border: true }))

          // Split parent CCs into Fixed / Variable / Other by CC name
          const fixedRows    = estRows.filter(r => r.project.toLowerCase().includes('fixed'))
          const variableRows = estRows.filter(r => r.project.toLowerCase().includes('variable'))
          const otherRows    = estRows.filter(r =>
            !r.project.toLowerCase().includes('fixed') && !r.project.toLowerCase().includes('variable')
          )

          const sectionTotalRows = [] // row numbers of each section's total row (for Grand Total)

          const writeOvhSection = (sectionLabel, sectionEstRows) => {
            if (sectionEstRows.length === 0) return
            const allItems = []
            for (const estRow of sectionEstRows) {
              const items = (allExpandData[estRow.project]?.items || [])
                .filter(i => i.grandDebit > 0 || i.grandCredit > 0)
              allItems.push(...items)
            }
            if (allItems.length === 0) return

            // Section header
            ws.addRow([sectionLabel, ...months.map(() => ''), ''])
              .eachCell(c => applyStyle(c, { bold: true, border: true, bg: 'D9E1F2' }))

            const ccSubtotalRows = [] // subtotal row numbers for each child CC

            for (const item of allItems) {
              const details = buildLedgerDetails(item, months, 'debit')
              if (details.length === 0) continue

              let entryFirst = null
              let entryLast  = null

              // Individual ledger entry rows (indented under CC)
              for (const d of details) {
                const entryRn  = ws.rowCount + 1
                const entryRow = ws.addRow([`    ${d.label}`, ...d.amounts, 0])
                entryRow.eachCell(c => applyStyle(c, { border: true }))
                months.forEach((_, i) => { entryRow.getCell(i + 2).numFmt = FMT })
                const totCell  = entryRow.getCell(totalCol)
                totCell.value  = { formula: `SUM(B${entryRn}:${lastMonthLtr}${entryRn})` }
                totCell.numFmt = FMT
                applyStyle(totCell, { border: true })
                if (entryFirst === null) entryFirst = entryRn
                entryLast = entryRn
              }

              // Child CC subtotal row
              if (entryFirst !== null) {
                const ccRn  = ws.rowCount + 1
                const ccRow = ws.addRow([
                  `  ${item.name}`,
                  ...months.map((_, i) => ({ formula: `SUM(${col(i)}${entryFirst}:${col(i)}${entryLast})` })),
                  { formula: `SUM(B${ccRn}:${lastMonthLtr}${ccRn})` }
                ])
                ccRow.eachCell(c => applyStyle(c, { bold: true, border: true }))
                months.forEach((_, i) => { ccRow.getCell(i + 2).numFmt = FMT })
                ccRow.getCell(totalCol).numFmt = FMT
                ccSubtotalRows.push(ccRn)
              }
            }

            // Section total — sums child CC subtotal rows (no double-counting)
            if (ccSubtotalRows.length > 0) {
              const secRn  = ws.rowCount + 1
              const secRow = ws.addRow([
                `Total ${sectionLabel}`,
                ...months.map((_, i) => ({ formula: ccSubtotalRows.map(r => `${col(i)}${r}`).join('+') })),
                { formula: `SUM(B${secRn}:${lastMonthLtr}${secRn})` }
              ])
              secRow.eachCell(c => applyStyle(c, { bold: true, border: 'medium' }))
              months.forEach((_, i) => { secRow.getCell(i + 2).numFmt = FMT })
              secRow.getCell(totalCol).numFmt = FMT
              sectionTotalRows.push(secRn)
            }

            ws.addRow([])
          }

          writeOvhSection('Fixed Overhead', fixedRows)
          writeOvhSection('Variable Cost',  variableRows)
          if (otherRows.length > 0) writeOvhSection('Other', otherRows)

          // Grand Total — sum of all section total rows
          if (sectionTotalRows.length > 0) {
            const gtRn  = ws.rowCount + 1
            const gtRow = ws.addRow([
              'Grand Total',
              ...months.map((_, i) => ({ formula: sectionTotalRows.map(r => `${col(i)}${r}`).join('+') })),
              { formula: `SUM(B${gtRn}:${lastMonthLtr}${gtRn})` }
            ])
            gtRow.eachCell(c => applyStyle(c, { bold: true, border: 'medium' }))
            months.forEach((_, i) => { gtRow.getCell(i + 2).numFmt = FMT })
            gtRow.getCell(totalCol).numFmt = FMT
          }

        } else {
          wb.removeWorksheet(ovhWs.id)
        }
      }
      // ── End Overhead Sheet ────────────────────────────────────────────────────

      const buffer = await wb.xlsx.writeBuffer()
      const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url    = URL.createObjectURL(blob)
      const prefix = [companyName, fyLabel].filter(Boolean).join('_')
      const a      = document.createElement('a'); a.href = url; a.download = `${prefix}_Project_Cash_Flow.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  async function toggleExpand(projectName) {
    const state = expandState[projectName]
    if (state === 'loading') return
    if (state === 'loaded' || state === 'error') {
      setExpandState(prev => ({ ...prev, [projectName]: null }))
      return
    }
    setExpandState(prev => ({ ...prev, [projectName]: 'loading' }))
    try {
      const sep  = queryParams ? '&' : '?'
      const res  = await fetch(`/api/dashboard/project-cashflow-expand${queryParams}${sep}project=${encodeURIComponent(projectName)}`)
      const json = await res.json()
      if (!json.success) throw new Error('Server error')
      setExpandData(prev => ({ ...prev, [projectName]: json.data }))
      setExpandState(prev => ({ ...prev, [projectName]: 'loaded' }))
    } catch {
      setExpandState(prev => ({ ...prev, [projectName]: 'error' }))
    }
  }

  return (
    <div className="section-card">
      <div className="section-header-row">
        <h2 className="section-title">Project-wise Cash Flow</h2>
        <button className="export-excel-btn" onClick={exportProjectExcel} disabled={exporting}>
          {exporting ? '⏳ Fetching...' : '⬇ Export Excel'}
        </button>
      </div>
      <p className="section-subtitle">Click the arrow next to a project to view month-wise breakdown</p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Fee Received</th>
            <th>Expenses Done</th>
            <th>Net (Fee − Expenses)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const net      = row.feesReceived - row.expensesDone
            const netClass = net > 0 ? 'net-positive' : net < 0 ? 'net-negative' : 'net-zero'
            const state    = expandState[row.project]
            const isLoading  = state === 'loading'
            const isExpanded = state === 'loaded'
            const isError    = state === 'error'

            return [
              <tr key={`r-${i}`} className={isExpanded ? 'project-row-expanded' : ''}>
                <td>
                  <button
                    className={`project-expand-btn${isLoading ? ' proj-spinning' : ''}`}
                    onClick={() => toggleExpand(row.project)}
                    title={isExpanded ? 'Collapse' : 'Expand month-wise'}
                  >
                    {isLoading ? '●' : isExpanded ? '▼' : '▶'}
                  </button>
                  {row.project}
                </td>
                <td>{fmt(row.feesReceived)}</td>
                <td>{fmt(row.expensesDone)}</td>
                <td className={netClass}>
                  {net >= 0 ? '+' : ''}{fmt(net)}
                </td>
              </tr>,

              (isExpanded || isError) && (
                <tr key={`e-${i}`} className="project-expand-row">
                  <td colSpan={4}>
                    {isError
                      ? <div className="project-expand-empty">Failed to load data. Please try again.</div>
                      : <ExpandPanel data={expandData[row.project]} />
                    }
                  </td>
                </tr>
              )
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

function ExpandPanel({ data }) {
  const [openCC, setOpenCC] = useState({}) // ccName → true/false

  if (!data?.items?.length) {
    return <div className="project-expand-empty">No data available for this period.</div>
  }
  const withData = data.items.filter(item => item.grandDebit > 0 || item.grandCredit > 0)
  if (!withData.length) {
    return <div className="project-expand-empty">No transactions in this period.</div>
  }

  function toggleCC(name) {
    setOpenCC(prev => ({ ...prev, [name]: !prev[name] }))
  }

  return (
    <div className="proj-sub-panel">
      <table className="project-monthly-table">
        <thead>
          <tr>
            <th>Cost Centre</th>
            <th className="pm-num">Expenses (Dr)</th>
            <th className="pm-num">Fee Received (Cr)</th>
            <th className="pm-num">Net Balance</th>
          </tr>
        </thead>
        <tbody>
          {withData.map((item, idx) => {
            const isOpen = !!openCC[item.name]
            return [
              <tr
                key={`cc-${idx}`}
                className="proj-cc-summary-row"
                onClick={() => toggleCC(item.name)}
                style={{ cursor: 'pointer' }}
              >
                <td>
                  <span className="proj-cc-toggle">{isOpen ? '▼' : '▶'}</span>
                  {item.name}
                </td>
                <td className="pm-num">{fmtAmt(item.grandDebit)}</td>
                <td className="pm-num">{fmtAmt(item.grandCredit)}</td>
                <td className="pm-num pm-closing">
                  {item.closingBalance > 0
                    ? <>{fmt(item.closingBalance)}&nbsp;<span className="pm-dr-cr">{item.closingDr ? 'Dr' : 'Cr'}</span></>
                    : null}
                </td>
              </tr>,

              isOpen && (
                <tr key={`cm-${idx}`}>
                  <td colSpan={4} style={{ padding: 0 }}>
                    <MonthlyTable item={item} />
                  </td>
                </tr>
              )
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

function MonthlyTable({ item }) {
  const [expandedMonths, setExpandedMonths] = useState(new Set())

  if (!item.months?.length) {
    return <div className="project-expand-empty">No monthly breakdown available.</div>
  }

  function toggleMonth(monthKey) {
    setExpandedMonths(prev => {
      const next = new Set(prev)
      next.has(monthKey) ? next.delete(monthKey) : next.add(monthKey)
      return next
    })
  }

  const visibleMonths = item.months.filter(m => m.debit > 0 || m.credit > 0 || m.closingBalance > 0)

  return (
    <table className="project-monthly-table proj-monthly-nested">
      <thead>
        <tr>
          <th>Month</th>
          <th className="pm-num">Debit</th>
          <th className="pm-num">Credit</th>
          <th className="pm-num">Closing Balance</th>
        </tr>
      </thead>
      <tbody>
        {visibleMonths.map((m, i) => {
          const hasEntries = m.entries?.length > 0
          const isOpen = expandedMonths.has(m.month)
          return (
            <Fragment key={i}>
              <tr className={isOpen ? 'pm-month-row-open' : ''}>
                <td>
                  {hasEntries
                    ? <button className="pm-month-expand-btn" onClick={() => toggleMonth(m.month)}>
                        {isOpen ? '▾' : '▸'} {m.monthShort}
                      </button>
                    : m.monthShort}
                </td>
                <td className="pm-num">{fmtOrDash(m.debit)}</td>
                <td className="pm-num">{fmtOrDash(m.credit)}</td>
                <td className="pm-num pm-closing">
                  {m.closingBalance > 0
                    ? <>{fmt(m.closingBalance)}&nbsp;<span className="pm-dr-cr">{m.closingDr ? 'Dr' : 'Cr'}</span></>
                    : '—'}
                </td>
              </tr>
              {isOpen && (
                <tr className="pm-month-entries-row">
                  <td colSpan={4} className="pm-month-entries-cell">
                    <div className="pm-entries-groups">
                      {(() => {
                        const expenses = m.entries.filter(e => e.debit > 0)
                        const income   = m.entries.filter(e => e.credit > 0)
                        return (
                          <>
                            {expenses.length > 0 && (
                              <div className="pm-entries-group pm-entries-expense">
                                <div className="pm-entries-group-header">Expenses (Dr)</div>
                                <table className="pm-entries-table">
                                  <tbody>
                                    {expenses.map((e, j) => (
                                      <tr key={j}>
                                        <td>
                                          <span className="pm-entry-ledger">{e.ledger}</span>
                                          {e.party && <span className="pm-entry-party">↳ {e.party}</span>}
                                        </td>
                                        <td className="pm-num">{fmt(e.debit)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {income.length > 0 && (
                              <div className="pm-entries-group pm-entries-income">
                                <div className="pm-entries-group-header">Income / Fee Received (Cr)</div>
                                <table className="pm-entries-table">
                                  <tbody>
                                    {income.map((e, j) => (
                                      <tr key={j}>
                                        <td>
                                          <span className="pm-entry-ledger">{e.ledger}</span>
                                          {e.party && <span className="pm-entry-party">↳ {e.party}</span>}
                                        </td>
                                        <td className="pm-num">{fmt(e.credit)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
      <tfoot>
        <tr className="pm-grand-total">
          <td>Grand Total</td>
          <td className="pm-num">{fmtAmt(item.grandDebit)}</td>
          <td className="pm-num">{fmtAmt(item.grandCredit)}</td>
          <td className="pm-num pm-closing">
            {item.closingBalance > 0
              ? <>{fmt(item.closingBalance)}&nbsp;<span className="pm-dr-cr">{item.closingDr ? 'Dr' : 'Cr'}</span></>
              : null}
          </td>
        </tr>
      </tfoot>
    </table>
  )
}
