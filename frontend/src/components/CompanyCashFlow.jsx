import { useState, Fragment } from 'react'

const formatINR = (value) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)

function balanceDisplay(amount, isDr) {
  return isDr ? formatINR(amount) : `${formatINR(amount)} Cr`
}

// Category definitions — same order as backend emptyEntries()
const CATEGORIES = [
  { key: 'Income',    label: 'Income',    totalLabel: 'Total Income',    color: '#1a7a4a', bg: '#f0faf4', border: '#a8d5b8' },
  { key: 'Expense',   label: 'Expense',   totalLabel: 'Total Expense',   color: '#b71c1c', bg: '#fff5f5', border: '#f5c6c6' },
  { key: 'Asset',     label: 'Asset',     totalLabel: 'Total Assets',    color: '#1565c0', bg: '#f0f5ff', border: '#b3c8f0' },
  { key: 'Liability', label: 'Liability', totalLabel: 'Total Liability', color: '#6a1b9a', bg: '#faf0ff', border: '#d4b3f0' },
  { key: 'Transfer',  label: 'Transfer',  totalLabel: 'Total Transfer',  color: '#e65100', bg: '#fff8f0', border: '#f5cca8' },
]

function CategoryCards({ sideEntries }) {
  const active = CATEGORIES.filter(
    c => sideEntries[c.key] && Object.keys(sideEntries[c.key]).length > 0
  )
  if (active.length === 0) return null
  return (
    <div className="mdc-side-cards">
      {active.map(cat => {
        const subGroups = Object.entries(sideEntries[cat.key])
        const total = subGroups.reduce((s, [, ledgers]) =>
          s + Object.values(ledgers).reduce((a, b) => a + b, 0), 0)
        return (
          <div
            key={cat.key}
            className="mdc-card"
            style={{ '--cat-color': cat.color, '--cat-bg': cat.bg, '--cat-border': cat.border }}
          >
            <div className="mdc-card-header">
              <span className="mdc-dot" />
              {cat.label}
            </div>
            <div className="mdc-rows">
              {subGroups.map(([subGrp, ledgers]) => {
                const subTotal = Object.values(ledgers).reduce((a, b) => a + b, 0)
                return (
                  <div key={subGrp} className="mdc-subgroup">
                    <div className="mdc-subgroup-header">
                      <span className="mdc-subgroup-name">{subGrp}</span>
                      <span className="mdc-subgroup-total">{formatINR(subTotal)}</span>
                    </div>
                    {Object.entries(ledgers).map(([ledger, amt]) => (
                      <div key={ledger} className="mdc-row">
                        <span className="mdc-name" title={ledger}>{ledger}</span>
                        <span className="mdc-amt">{formatINR(amt)}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
            <div className="mdc-total">
              <span>{cat.totalLabel}</span>
              <span>{formatINR(total)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MonthDetailPanel({ entries, debitTotal, creditTotal }) {
  const hasDebit  = entries?.debit  && CATEGORIES.some(c => Object.keys(entries.debit[c.key]  || {}).length > 0)
  const hasCredit = entries?.credit && CATEGORIES.some(c => Object.keys(entries.credit[c.key] || {}).length > 0)

  if (!hasDebit && !hasCredit) {
    return (
      <tr className="month-detail-row">
        <td colSpan={4} className="month-detail-empty">No entry details available for this month.</td>
      </tr>
    )
  }

  return (
    <tr className="month-detail-row">
      <td colSpan={4}>
        <div className="month-detail-panel">
          {hasDebit && (
            <div className="mdc-side">
              <div className="mdc-side-header mdc-side-header--debit">
                <span className="mdc-side-label">Debit Side</span>
                <span className="mdc-side-total">{formatINR(debitTotal)}</span>
              </div>
              <CategoryCards sideEntries={entries.debit} />
            </div>
          )}
          {hasCredit && (
            <div className="mdc-side">
              <div className="mdc-side-header mdc-side-header--credit">
                <span className="mdc-side-label">Credit Side</span>
                <span className="mdc-side-total">{formatINR(creditTotal)}</span>
              </div>
              <CategoryCards sideEntries={entries.credit} />
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

function LedgerTable({ ledger }) {
  const [expanded, setExpanded]           = useState(false)
  const [expandedMonths, setExpandedMonths] = useState(new Set())

  function toggleMonth(month) {
    setExpandedMonths(prev => {
      const next = new Set(prev)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  }

  return (
    <div className="section-card ledger-card">
      <div className="ledger-card-header">
        <h2 className="section-title">{ledger.name}</h2>
        <span className="ledger-group-badge">{ledger.group}</span>
      </div>

      <div className="ledger-table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>
                <span className="particulars-header">
                  Particulars
                  <button
                    className="expand-btn"
                    onClick={() => setExpanded(e => !e)}
                    title={expanded ? 'Collapse months' : 'Expand months'}
                  >
                    {expanded ? '▲' : '▼'}
                  </button>
                </span>
              </th>
              <th className="num-col">Debit</th>
              <th className="num-col">Credit</th>
              <th className="num-col">Closing Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="opening-row">
              <td>Opening Balance</td>
              <td></td>
              <td></td>
              <td className="num-col">{balanceDisplay(ledger.openingBalance, ledger.openingDr)}</td>
            </tr>

            {expanded && ledger.months.map((m) => {
              const hasData        = m.debit > 0 || m.credit > 0
              const isMonthExpanded = expandedMonths.has(m.month)
              return (
                <Fragment key={m.month}>
                  <tr className={[
                    !hasData          ? 'empty-month-row'  : '',
                    isMonthExpanded   ? 'month-row-active' : '',
                  ].filter(Boolean).join(' ')}>
                    <td>
                      <span className="month-particulars">
                        {hasData && (
                          <button
                            className="expand-btn month-expand-btn"
                            onClick={() => toggleMonth(m.month)}
                            title={isMonthExpanded ? 'Hide details' : 'Show details'}
                          >
                            {isMonthExpanded ? '▲' : '▼'}
                          </button>
                        )}
                        {m.month}
                      </span>
                    </td>
                    <td className="num-col">{m.debit  > 0 ? formatINR(m.debit)  : ''}</td>
                    <td className="num-col">{m.credit > 0 ? formatINR(m.credit) : ''}</td>
                    <td className="num-col">{balanceDisplay(m.closingBalance, m.closingDr)}</td>
                  </tr>

                  {isMonthExpanded && m.entries && (
                    <MonthDetailPanel entries={m.entries} debitTotal={m.debit} creditTotal={m.credit} />
                  )}
                </Fragment>
              )
            })}

            <tr className="grand-total-row">
              <td>Grand Total</td>
              <td className="num-col">{formatINR(ledger.grandDebit)}</td>
              <td className="num-col">{formatINR(ledger.grandCredit)}</td>
              <td className="num-col">{balanceDisplay(ledger.closingBalance, ledger.closingDr)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Merge entries objects from multiple months across all banks for one month label
function mergeEntries(banks, monthLabel) {
  const result = { debit: {}, credit: {} }
  for (const cat of CATEGORIES) {
    result.debit[cat.key]  = {}
    result.credit[cat.key] = {}
  }
  for (const bank of banks) {
    const m = bank.months.find(mo => mo.month === monthLabel)
    if (!m?.entries) continue
    for (const side of ['debit', 'credit']) {
      for (const cat of CATEGORIES) {
        const src = m.entries[side]?.[cat.key] || {}
        for (const [subGrp, ledgers] of Object.entries(src)) {
          if (!result[side][cat.key][subGrp]) result[side][cat.key][subGrp] = {}
          for (const [name, amt] of Object.entries(ledgers)) {
            result[side][cat.key][subGrp][name] = (result[side][cat.key][subGrp][name] || 0) + amt
          }
        }
      }
    }
  }
  return result
}

// ── Excel Export ─────────────────────────────────────────────────────────────
const CAT_LABELS = {
  Income: 'Income', Expense: 'Expense', Asset: 'Assets',
  Liability: 'Liabilities', Transfer: 'Transfers'
}
const CAT_KEYS = ['Income', 'Expense', 'Asset', 'Liability', 'Transfer']

// Category order per sheet
const IN_CAT_ORDER  = ['Asset', 'Liability', 'Transfer', 'Expense', 'Income']
const OUT_CAT_ORDER = ['Liability', 'Expense', 'Asset', 'Transfer', 'Income']

// Sub-group priority per sheet (case-insensitive substring match)
const IN_SUBGROUP_PRIORITY = {
  Asset:     ['sundry debtors'],
  Liability: ['sundry creditors', 'indirect income'],
}
const OUT_SUBGROUP_PRIORITY = {
  Liability: ['sundry creditors', 'provisions'],
  Expense:   ['salary', 'indirect expense', 'administrative', 'stationery'],
  Asset:     ['sundry debtors', 'silk'],
}

function sortedSubGroups(subGrpSet, catKey, side) {
  const map = side === 'debit' ? IN_SUBGROUP_PRIORITY : OUT_SUBGROUP_PRIORITY
  const priorities = map[catKey] || []
  return [...subGrpSet].sort((a, b) => {
    const al = a.toLowerCase()
    const bl = b.toLowerCase()
    const ai = priorities.findIndex(p => al.includes(p))
    const bi = priorities.findIndex(p => bl.includes(p))
    if (ai === -1 && bi === -1) return al.localeCompare(bl)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

function applyStyle(cell, { bg, color, bold, border } = {}) {
  if (bg)    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } }
  cell.font = { name: 'Calibri', size: 12, bold: !!bold, ...(color ? { color: { argb: 'FF' + color } } : {}) }
  if (typeof cell.value === 'number') cell.numFmt = '#,##0.00'
  if (border) {
    const s = { style: 'thin' }
    cell.border = { top: s, left: s, bottom: s, right: s }
  }
}

function buildInOutSheet(wb, banks, months, side, sheetName) {
  const ws = wb.addWorksheet(sheetName)
  // Summary rows (category totals) appear ABOVE their detail — collapse button on category header
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false }
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2' }]
  ws.getColumn(1).width = 35
  months.forEach((_, i) => { ws.getColumn(i + 2).width = 14 })
  ws.getColumn(months.length + 2).width = 14

  // Header row — light blue
  const hdr = ws.addRow(['', ...months, 'Total'])
  hdr.eachCell(c => applyStyle(c, { bg: 'BDD7EE', bold: true, border: true }))

  // Pre-compute merged entries per month (avoid recomputing in loops)
  const mergedPerMonth = months.map(ml => mergeEntries(banks, ml))

  const catOrder = side === 'debit' ? IN_CAT_ORDER : OUT_CAT_ORDER

  for (const catKey of catOrder) {
    // Collect all sub-groups across all months
    const subGrpSet = new Set()
    mergedPerMonth.forEach(m => Object.keys(m[side][catKey] || {}).forEach(sg => subGrpSet.add(sg)))
    if (subGrpSet.size === 0) continue

    // Category total row — yellow (placed FIRST so Excel collapse button sits here)
    let catTotal = 0
    const catTotals = mergedPerMonth.map(m => {
      const s = Object.values(m[side][catKey] || {}).reduce((a, subLedgers) =>
        a + Object.values(subLedgers).reduce((x, y) => x + y, 0), 0)
      catTotal += s; return s || ''
    })
    ws.addRow([CAT_LABELS[catKey], ...catTotals, catTotal || ''])
      .eachCell(c => applyStyle(c, { bg: '92D050', bold: true, border: true }))

    for (const subGrp of sortedSubGroups(subGrpSet, catKey, side)) {
      // Sub-group total row — light blue (placed FIRST so collapse button sits here)
      let sgTotal = 0
      const sgTotals = mergedPerMonth.map(m => {
        const s = Object.values(m[side][catKey]?.[subGrp] || {}).reduce((a, b) => a + b, 0)
        sgTotal += s; return s || ''
      })
      const sgTotalRow = ws.addRow([`  ${subGrp}`, ...sgTotals, sgTotal || ''])
      sgTotalRow.eachCell(c => applyStyle(c, { bg: 'D9D9D9', bold: true, border: true }))
      sgTotalRow.outlineLevel = 1

      // Collect all ledger names within this sub-group
      const ledgerSet = new Set()
      mergedPerMonth.forEach(m => Object.keys(m[side][catKey]?.[subGrp] || {}).forEach(l => ledgerSet.add(l)))

      // Ledger rows — deepest level, outline 2
      for (const ledger of ledgerSet) {
        let total = 0
        const amts = mergedPerMonth.map(m => {
          const v = m[side][catKey]?.[subGrp]?.[ledger] || 0; total += v; return v || ''
        })
        const ledgerRow = ws.addRow([`    ${ledger}`, ...amts, total || ''])
        ledgerRow.eachCell(c => applyStyle(c, { border: true }))
        ledgerRow.outlineLevel = 2
      }
    }

    ws.addRow([])
  }
}

function buildSummarySheet(wb, banks, months) {
  const ws = wb.addWorksheet('Actual Summary')
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2' }]
  ws.getColumn(1).width = 22
  months.forEach((_, i) => { ws.getColumn(i + 2).width = 14 })

  // Header row — light blue
  ws.addRow(['', ...months])
    .eachCell(c => applyStyle(c, { bg: 'BDD7EE', bold: true, border: true }))

  for (const bank of banks) {
    // Bank name — dark blue, white
    ws.addRow([bank.name])
      .eachCell(c => applyStyle(c, { bg: '4472C4', color: 'FFFFFF', bold: true, border: true }))

    // Opening Balance (each month = prev month closing)
    const openings = bank.months.map((m, i) => {
      if (i === 0) return (bank.openingDr ? 1 : -1) * bank.openingBalance
      const prev = bank.months[i - 1]
      return (prev.closingDr ? 1 : -1) * prev.closingBalance
    })
    ws.addRow(['Opening Balance', ...openings])
      .eachCell(c => applyStyle(c, { border: true }))

    ws.addRow(['In (Debit)',   ...bank.months.map(m => m.debit  || '')])
      .eachCell(c => applyStyle(c, { border: true }))
    ws.addRow(['Out (Credit)', ...bank.months.map(m => m.credit || '')])
      .eachCell(c => applyStyle(c, { border: true }))

    // Closing Balance — light green
    ws.addRow([`${bank.name} Balance`, ...bank.months.map(m => (m.closingDr ? 1 : -1) * m.closingBalance)])
      .eachCell(c => applyStyle(c, { bg: 'C6EFCE', color: '375623', bold: true, border: true }))

    ws.addRow([])
  }

  // Total Balance — light orange
  const totals = months.map((_, i) =>
    banks.reduce((s, b) => s + (b.months[i] ? (b.months[i].closingDr ? 1 : -1) * b.months[i].closingBalance : 0), 0)
  )
  ws.addRow(['Total Balance', ...totals])
    .eachCell(c => applyStyle(c, { bg: 'FCE4D6', color: '833C00', bold: true, border: true }))
}

async function exportToExcel(ledgers) {
  const ExcelJS = (await import('exceljs')).default
  // Fetch fresh at export time — no cache — so company switch reflects immediately
  let companyName = '', fyLabel = ''
  try {
    const cfg = await fetch('/api/dashboard/current-company').then(r => r.json())
    if (cfg.success) { companyName = cfg.data.companyName || ''; fyLabel = cfg.data.fyLabel || '' }
  } catch { /* use empty strings */ }
  const banks  = ledgers.filter(l => l.group === 'Bank Accounts' || l.group === 'Cash-in-Hand')
  const months = banks[0]?.months.map(m => m.month) || []
  const wb     = new ExcelJS.Workbook()

  buildInOutSheet(wb, banks, months, 'debit',  'Actual In')
  buildInOutSheet(wb, banks, months, 'credit', 'Actual Out')
  buildSummarySheet(wb, banks, months)

  const buffer = await wb.xlsx.writeBuffer()
  const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  const prefix = [companyName, fyLabel].filter(Boolean).join('_')
  a.href = url; a.download = `${prefix}_Money In_Out.xlsx`; a.click()
  URL.revokeObjectURL(url)
}

// ── All Banks merged summary card ────────────────────────────────────────────
function AllBanksSummary({ ledgers }) {
  const [expanded, setExpanded]           = useState(false)
  const [expandedMonths, setExpandedMonths] = useState(new Set())

  function toggleMonth(month) {
    setExpandedMonths(prev => {
      const next = new Set(prev)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  }

  const banks = ledgers.filter(l => l.group === 'Bank Accounts' || l.group === 'Cash-in-Hand')
  if (banks.length < 1) return null

  // Unique month labels in FY order
  const monthOrder = []
  const seen = new Set()
  for (const b of banks) {
    for (const m of b.months) {
      if (!seen.has(m.month)) { seen.add(m.month); monthOrder.push(m.month) }
    }
  }

  // Merged opening balance
  const mergedOpening = banks.reduce((s, b) => s + (b.openingDr ? b.openingBalance : -b.openingBalance), 0)

  // Merge month debit/credit totals
  const monthMap = {}
  for (const b of banks) {
    for (const m of b.months) {
      if (!monthMap[m.month]) monthMap[m.month] = { debit: 0, credit: 0 }
      monthMap[m.month].debit  += m.debit
      monthMap[m.month].credit += m.credit
    }
  }

  // Running closing balance
  let running = mergedOpening
  const months = monthOrder.map(label => {
    const { debit = 0, credit = 0 } = monthMap[label] || {}
    running += debit - credit
    return { month: label, debit, credit, closingBalance: Math.abs(running), closingDr: running >= 0 }
  })

  const grandDebit  = banks.reduce((s, b) => s + b.grandDebit,  0)
  const grandCredit = banks.reduce((s, b) => s + b.grandCredit, 0)
  const finalBal    = Math.abs(mergedOpening + grandDebit - grandCredit)
  const finalDr     = (mergedOpening + grandDebit - grandCredit) >= 0

  return (
    <div className="section-card ledger-card">
      <div className="ledger-card-header">
        <h2 className="section-title">Banks & Cash</h2>
        <button className="export-excel-btn" onClick={() => exportToExcel(ledgers)}>
          ⬇ Export Excel
        </button>
      </div>

      <div className="ledger-table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>
                <span className="particulars-header">
                  Particulars
                  <button
                    className="expand-btn"
                    onClick={() => setExpanded(e => !e)}
                    title={expanded ? 'Collapse months' : 'Expand months'}
                  >
                    {expanded ? '▲' : '▼'}
                  </button>
                </span>
              </th>
              <th className="num-col">Debit</th>
              <th className="num-col">Credit</th>
              <th className="num-col">Closing Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="opening-row">
              <td>Opening Balance</td>
              <td></td>
              <td></td>
              <td className="num-col">{balanceDisplay(Math.abs(mergedOpening), mergedOpening >= 0)}</td>
            </tr>

            {expanded && months.map(m => {
              const hasData        = m.debit > 0 || m.credit > 0
              const isMonthExpanded = expandedMonths.has(m.month)
              const merged         = isMonthExpanded ? mergeEntries(banks, m.month) : null
              return (
                <Fragment key={m.month}>
                  <tr className={[
                    !hasData        ? 'empty-month-row'  : '',
                    isMonthExpanded ? 'month-row-active' : '',
                  ].filter(Boolean).join(' ')}>
                    <td>
                      <span className="month-particulars">
                        {hasData && (
                          <button
                            className="expand-btn month-expand-btn"
                            onClick={() => toggleMonth(m.month)}
                            title={isMonthExpanded ? 'Hide details' : 'Show details'}
                          >
                            {isMonthExpanded ? '▲' : '▼'}
                          </button>
                        )}
                        {m.month}
                      </span>
                    </td>
                    <td className="num-col">{m.debit  > 0 ? formatINR(m.debit)  : ''}</td>
                    <td className="num-col">{m.credit > 0 ? formatINR(m.credit) : ''}</td>
                    <td className="num-col">{balanceDisplay(m.closingBalance, m.closingDr)}</td>
                  </tr>

                  {isMonthExpanded && (
                    <MonthDetailPanel entries={merged} debitTotal={m.debit} creditTotal={m.credit} />
                  )}
                </Fragment>
              )
            })}

            <tr className="grand-total-row">
              <td>Grand Total</td>
              <td className="num-col">{formatINR(grandDebit)}</td>
              <td className="num-col">{formatINR(grandCredit)}</td>
              <td className="num-col">{balanceDisplay(finalBal, finalDr)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LedgerGroupSeparator({ label }) {
  return (
    <div className="ledger-group-separator">
      <span className="lgs-line" />
      <span className="lgs-label">{label}</span>
      <span className="lgs-line" />
    </div>
  )
}

export default function CompanyCashFlow({ data }) {
  if (!data?.ledgers?.length) {
    return (
      <div className="section-card">
        <h2 className="section-title">Company Cash Flow</h2>
        <p className="section-subtitle">No bank or cash ledger data found for the selected period.</p>
      </div>
    )
  }

  const bankLedgers  = data.ledgers.filter(l => l.group === 'Bank Accounts')
  const cashLedgers  = data.ledgers.filter(l => l.group === 'Cash-in-Hand')
  const otherLedgers = data.ledgers.filter(l => l.group !== 'Bank Accounts' && l.group !== 'Cash-in-Hand')

  return (
    <div className="ledger-list">
      <LedgerGroupSeparator label="Merged Bank Accounts & Cash" />
      <AllBanksSummary ledgers={data.ledgers} />

      {bankLedgers.length > 0 && <LedgerGroupSeparator label="Individual Bank Accounts" />}
      {bankLedgers.map(ledger => <LedgerTable key={ledger.name} ledger={ledger} />)}

      {cashLedgers.length > 0 && <LedgerGroupSeparator label="Cash-in-Hand" />}
      {cashLedgers.map(ledger => <LedgerTable key={ledger.name} ledger={ledger} />)}

      {otherLedgers.length > 0 && <LedgerGroupSeparator label="Other" />}
      {otherLedgers.map(ledger => <LedgerTable key={ledger.name} ledger={ledger} />)}
    </div>
  )
}
