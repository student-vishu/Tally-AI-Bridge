import { useState } from 'react'

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

      // Fetch each project's expand data in parallel using the same API the UI expand uses.
      // This guarantees the project name key matches row.project exactly.
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
      const ws = wb.addWorksheet('Project Cash Flow')
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2' }]
      ws.getColumn(1).width = 32
      months.forEach((_, i) => { ws.getColumn(i + 2).width = 14 })
      ws.getColumn(months.length + 2).width = 14

      function applyStyle(cell, { bg, color, bold, border, indent } = {}) {
        if (bg)    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } }
        cell.font = { name: 'Arial', bold: !!bold, ...(color ? { color: { argb: 'FF' + color } } : {}) }
        if (typeof cell.value === 'number') cell.numFmt = '#,##0.00'
        if (border) { const s = { style: 'thin' }; cell.border = { top:s, left:s, bottom:s, right:s } }
        if (indent && cell.col === 1) cell.alignment = { indent }
      }

      ws.addRow(['', ...months, 'Total'])
        .eachCell(c => applyStyle(c, { bg: 'BDD7EE', bold: true, border: true }))

      function getItemMonthVal(item, monthLabel, side) {
        const m = item.months?.find(mo => mo.month === monthLabel)
        return m ? (m[side] || 0) : 0
      }

      function getProjectMonthVal(projectName, monthLabel, side) {
        const items = allExpandData[projectName]?.items || []
        return items.reduce((sum, item) => sum + getItemMonthVal(item, monthLabel, side), 0)
      }

      for (const row of data) {
        // Project header row
        ws.addRow([row.project])
          .eachCell(c => applyStyle(c, { bg: '4472C4', color: 'FFFFFF', bold: true, border: true }))

        const projectItems = (allExpandData[row.project]?.items || [])
          .filter(item => item.grandDebit > 0 || item.grandCredit > 0)

        // Sub-CC breakdown rows
        for (const item of projectItems) {
          if (item.grandCredit > 0) {
            const crAmts = months.map(ml => getItemMonthVal(item, ml, 'credit') || '')
            ws.addRow([`    ${item.name} — Fee Received`, ...crAmts, item.grandCredit || ''])
              .eachCell(c => applyStyle(c, { bg: 'EBF3FB', border: true }))
          }
          if (item.grandDebit > 0) {
            const drAmts = months.map(ml => getItemMonthVal(item, ml, 'debit') || '')
            ws.addRow([`    ${item.name} — Expenses`, ...drAmts, item.grandDebit || ''])
              .eachCell(c => applyStyle(c, { bg: 'FFF2CC', border: true }))
          }
        }

        // Summary: Fee Received — use voucher monthly sums, total from Cost Category Summary
        const feeAmts = months.map(ml => getProjectMonthVal(row.project, ml, 'credit') || '')
        ws.addRow(['  Fee Received', ...feeAmts, row.feesReceived || ''])
          .eachCell(c => applyStyle(c, { bold: true, border: true }))

        // Summary: Expenses
        const expAmts = months.map(ml => getProjectMonthVal(row.project, ml, 'debit') || '')
        ws.addRow(['  Expenses', ...expAmts, row.expensesDone || ''])
          .eachCell(c => applyStyle(c, { bold: true, border: true }))

        // Net row
        const netTotal = row.feesReceived - row.expensesDone
        const netAmts  = months.map(ml =>
          getProjectMonthVal(row.project, ml, 'credit') - getProjectMonthVal(row.project, ml, 'debit') || ''
        )
        const netColor = netTotal >= 0 ? '375623' : '9C0006'
        const netBg    = netTotal >= 0 ? 'C6EFCE' : 'FFC7CE'
        ws.addRow(['  Net (Fee − Expenses)', ...netAmts, netTotal || ''])
          .eachCell(c => applyStyle(c, { bg: netBg, color: netColor, bold: true, border: true }))

        ws.addRow([])
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
  if (!item.months?.length) {
    return <div className="project-expand-empty">No monthly breakdown available.</div>
  }
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
        {item.months
          .filter(m => m.debit > 0 || m.credit > 0 || m.closingBalance > 0)
          .map((m, i) => (
            <tr key={i}>
              <td>{m.monthShort}</td>
              <td className="pm-num">{fmtOrDash(m.debit)}</td>
              <td className="pm-num">{fmtOrDash(m.credit)}</td>
              <td className="pm-num pm-closing">
                {m.closingBalance > 0
                  ? <>{fmt(m.closingBalance)}&nbsp;<span className="pm-dr-cr">{m.closingDr ? 'Dr' : 'Cr'}</span></>
                  : '—'}
              </td>
            </tr>
          ))}
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
