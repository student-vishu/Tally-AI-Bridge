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

      // Fetch each project's expand data in parallel with employee data
      const [expandResults, rawEmpJson] = await Promise.all([
        Promise.all(
          data.map(async row => {
            try {
              const sep = queryParams ? '&' : '?'
              const res  = await fetch(`/api/dashboard/project-cashflow-expand${queryParams}${sep}project=${encodeURIComponent(row.project)}`)
              const json = await res.json()
              if (json.success && json.data) return json.data
            } catch { /* ignored */ }
            return { project: row.project, items: [], from: null, to: null }
          })
        ),
        fetch('/api/asanify/employees').then(r => r.json()).catch(() => ({ success: false }))
      ])

      const siteTeamNames = new Set()
      if (rawEmpJson.success && Array.isArray(rawEmpJson.employees)) {
        for (const emp of rawEmpJson.employees) {
          const dept = (emp.DEPARTMENT_NAME || emp.DEPARTMENT || '').toLowerCase()
          if (dept.includes('site')) {
            const name = [emp.FIRST_NAME, emp.MIDDLE_NAME, emp.LAST_NAME]
              .filter(Boolean).join(' ').trim().toLowerCase()
            if (name) siteTeamNames.add(name)
          }
        }
      }

      const allExpandData = {}
      let from = '', to = ''
      for (const r of expandResults) {
        allExpandData[r.project] = { items: r.items || [] }
        if (r.from && !from) from = r.from
        if (r.to   && !to)   to   = r.to
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

      function buildLedgerDetails(item, monthLabels, side) {
        const map = {}
        for (const mo of item.months || []) {
          for (const e of mo.entries || []) {
            if (!(e[side] > 0)) continue
            const label = e.party ? `${e.ledger} ↳ ${e.party}` : e.ledger
            if (!map[label]) map[label] = {}
            map[label][mo.month] = (map[label][mo.month] || 0) + e[side]
          }
        }
        return Object.entries(map).map(([label, byMonth]) => ({
          label,
          amounts: monthLabels.map(ml => byMonth[ml] || ''),
          total: Object.values(byMonth).reduce((s, v) => s + v, 0),
        }))
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

      function writeItemSection(ws, item, headerName, isProject = false) {
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
        if (item.grandDebit > 0) {
          ws.addRow([`    ${item.name} — Expenses`, ...months.map(() => ''), ''])
            .eachCell(c => applyStyle(c, { border: true }))
          for (const d of buildLedgerDetails(item, months, 'debit')) {
            const rn = writeLedgerRow(ws, d.label, d.amounts)
            if (debitFirst === null) debitFirst = rn
            debitLast = rn
          }
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

        // Site Salary Direct — only for project sheets, not establishment
        if (!isProject) { ws.addRow([]); return }
        ws.addRow([])
        ws.addRow([])
        const siteSalaryAmounts = months.map(ml => {
          const mo = item.months?.find(m => m.month === ml)
          if (!mo) return 0
          return (mo.entries || []).reduce((sum, e) => {
            if (!(e.debit > 0)) return sum
            const ledger = (e.ledger || '').trim().toLowerCase()
            const party  = (e.party  || '').trim().toLowerCase()
            const isSalaryLedger = ledger.includes('salary')
            const matched = isSalaryLedger && [...siteTeamNames].some(name => party.includes(name))
            return matched ? sum + e.debit : sum
          }, 0)
        })
        const ssRow = ws.addRow(['  Site Salary Direct', ...siteSalaryAmounts])
        applyStyle(ssRow.getCell(1), { bold: true, border: 'medium' })
        const ssRn = ssRow.number
        for (let i = 0; i < months.length; i++) {
          const cell = ssRow.getCell(i + 2)
          cell.numFmt = FMT
          applyStyle(cell, { bold: true, border: 'medium' })
        }
        const ssTotCell = ssRow.getCell(totalCol)
        ssTotCell.value  = { formula: `SUM(B${ssRn}:${lastMonthLtr}${ssRn})` }
        ssTotCell.numFmt = FMT
        applyStyle(ssTotCell, { bold: true, border: 'medium' })

        // Site Overhead — non-salary expenses where party is a site team employee
        const siteOverheadAmounts = months.map(ml => {
          const mo = item.months?.find(m => m.month === ml)
          if (!mo) return 0
          return (mo.entries || []).reduce((sum, e) => {
            if (!(e.debit > 0)) return sum
            const ledger = (e.ledger || '').trim().toLowerCase()
            const party  = (e.party  || '').trim().toLowerCase()
            const matched = !ledger.includes('salary') && [...siteTeamNames].some(name => party.includes(name))
            return matched ? sum + e.debit : sum
          }, 0)
        })
        const soRow = ws.addRow(['  Site Overhead', ...siteOverheadAmounts])
        applyStyle(soRow.getCell(1), { bold: true, border: 'medium' })
        const soRn = soRow.number
        for (let i = 0; i < months.length; i++) {
          const cell = soRow.getCell(i + 2)
          cell.numFmt = FMT
          applyStyle(cell, { bold: true, border: 'medium' })
        }
        const soTotCell = soRow.getCell(totalCol)
        soTotCell.value  = { formula: `SUM(B${soRn}:${lastMonthLtr}${soRn})` }
        soTotCell.numFmt = FMT
        applyStyle(soTotCell, { bold: true, border: 'medium' })

        ws.addRow([])
      }

      // Detect the Projects category name dynamically (whatever Tally calls it)
      const projectsCategoryName = data.find(r => {
        const cat = (r.category || '').toLowerCase()
        return cat.includes('project')
      })?.category || 'Projects'

      for (const row of data) {
        const projectItems = (allExpandData[row.project]?.items || [])
          .filter(item => item.grandDebit > 0 || item.grandCredit > 0)

        const isProjectsCategory = row.category === projectsCategoryName

        if (isProjectsCategory && projectItems.length > 1) {
          // Projects with multiple sub-CCs — one sheet per sub-CC
          for (const item of projectItems) {
            const ws = wb.addWorksheet(makeSheetName(item.name))
            setupSheet(ws)
            writeItemSection(ws, item, item.name, true)
          }
        } else {
          // Establishment items OR single-CC projects — one sheet per project (unchanged)
          const ws = wb.addWorksheet(makeSheetName(row.project))
          setupSheet(ws)
          if (projectItems.length === 1) writeItemSection(ws, projectItems[0], row.project, isProjectsCategory)
          else if (projectItems.length > 1) {
            // Establishment: write all sub-CCs stacked on one sheet
            for (const item of projectItems) writeItemSection(ws, item, item.name, false)
          }
        }
      }

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
