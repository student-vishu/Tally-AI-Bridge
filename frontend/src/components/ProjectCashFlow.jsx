import { useState } from 'react'

const fmt = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Math.abs(value))

const fmtAmt = (val) => (val > 0 ? fmt(val) : '—')

export default function ProjectCashFlow({ data, queryParams = '' }) {
  const [expandState, setExpandState] = useState({}) // name → 'loading'|'loaded'|'error'
  const [expandData, setExpandData]   = useState({}) // name → { items: [...] }
  const [exporting, setExporting]     = useState(false)

  // Pre-warm cache so export is instant when clicked
  useState(() => { fetch(`/api/dashboard/project-cashflow-warm-cache${queryParams}`).catch(() => {}) })

  async function exportProjectExcel() {
    setExporting(true)
    try {
      // Fetch fresh at export time — no cache — so company switch reflects immediately
      let companyName = '', fyLabel = ''
      try {
        const cfg = await fetch('/api/dashboard/current-company').then(r => r.json())
        if (cfg.success) { companyName = cfg.data.companyName || ''; fyLabel = cfg.data.fyLabel || '' }
      } catch { /* use empty strings */ }

      const res  = await fetch(`/api/dashboard/project-cashflow-all-expand${queryParams}`)
      const json = await res.json()
      if (!json.success) throw new Error('Failed')

      // Build allExpandData keyed by project name
      const allExpandData = {}
      for (const p of json.data.projects) allExpandData[p.project] = p
      const from = json.data.from

      const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
      const fyStart     = from ? parseInt(from.substring(0, 4), 10) : new Date().getFullYear()
      const months      = [
        ...[4,5,6,7,8,9,10,11,12].map(m => `${MONTH_NAMES[m-1]} ${fyStart}`),
        ...[1,2,3].map(m => `${MONTH_NAMES[m-1]} ${fyStart + 1}`)
      ]

      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Project Cash Flow')
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2' }]
      ws.getColumn(1).width = 28
      months.forEach((_, i) => { ws.getColumn(i + 2).width = 14 })
      ws.getColumn(months.length + 2).width = 14

      function applyStyle(cell, { bg, color, bold, border } = {}) {
        if (bg)    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } }
        cell.font = { name: 'Arial', bold: !!bold, ...(color ? { color: { argb: 'FF' + color } } : {}) }
        if (typeof cell.value === 'number') cell.numFmt = '#,##0.00'
        if (border) { const s = { style: 'thin' }; cell.border = { top:s, left:s, bottom:s, right:s } }
      }

      ws.addRow(['', ...months, 'Total'])
        .eachCell(c => applyStyle(c, { bg: 'BDD7EE', bold: true, border: true }))

      function getMonthVal(projectName, monthLabel, side) {
        const items = allExpandData[projectName]?.items || []
        let total = 0
        for (const item of items) {
          const m = item.months?.find(mo => mo.month === monthLabel)
          if (m) total += m[side] || 0
        }
        return total
      }

      for (const row of data) {
        // Project name row — dark blue, white bold
        ws.addRow([row.project])
          .eachCell(c => applyStyle(c, { bg: '4472C4', color: 'FFFFFF', bold: true, border: true }))

        // Fee Received row (credit)
        let feeTotal = 0
        const feeAmts = months.map(ml => {
          const v = getMonthVal(row.project, ml, 'credit')
          feeTotal += v
          return v || ''
        })
        ws.addRow(['  Fee Received', ...feeAmts, feeTotal || ''])
          .eachCell(c => applyStyle(c, { border: true }))

        // Expenses row (debit)
        let expTotal = 0
        const expAmts = months.map(ml => {
          const v = getMonthVal(row.project, ml, 'debit')
          expTotal += v
          return v || ''
        })
        ws.addRow(['  Expenses', ...expAmts, expTotal || ''])
          .eachCell(c => applyStyle(c, { border: true }))

        // Net row — green font if +ve, red if -ve
        const netTotal = feeTotal - expTotal
        const netAmts  = months.map(ml =>
          getMonthVal(row.project, ml, 'credit') - getMonthVal(row.project, ml, 'debit') || ''
        )
        const netColor = netTotal >= 0 ? '375623' : '9C0006'
        const netBg    = netTotal >= 0 ? 'C6EFCE' : 'FFC7CE'
        ws.addRow(['  Net', ...netAmts, netTotal || ''])
          .eachCell(c => applyStyle(c, { bg: netBg, color: netColor, border: true }))

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
    // collapse if already open
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
  if (!data || !data.items || data.items.length === 0) {
    return <div className="project-expand-empty">No data available for this period.</div>
  }
  return (
    <div className="project-expand-panel">
      {data.items.map((item, idx) => (
        <SubCategorySection key={idx} item={item} />
      ))}
    </div>
  )
}

function SubCategorySection({ item }) {
  return (
    <div className="project-subcategory">
      <div className="project-subcategory-header">{item.name}</div>
      <table className="project-monthly-table">
        <thead>
          <tr>
            <th>Month</th>
            <th className="pm-num">Debit</th>
            <th className="pm-num">Credit</th>
            <th className="pm-num">Closing Balance</th>
          </tr>
        </thead>
        <tbody>
          {item.months.map((m, i) => (
            <tr key={i}>
              <td>{m.monthShort}</td>
              <td className="pm-num">{fmtAmt(m.debit)}</td>
              <td className="pm-num">{fmtAmt(m.credit)}</td>
              <td className="pm-num pm-closing">
                {fmt(m.closingBalance)}&nbsp;<span className="pm-dr-cr">{m.closingDr ? 'Dr' : 'Cr'}</span>
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
              {fmt(item.closingBalance)}&nbsp;<span className="pm-dr-cr">{item.closingDr ? 'Dr' : 'Cr'}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
