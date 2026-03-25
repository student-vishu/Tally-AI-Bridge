const formatINR = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(value)

export default function ProjectCashFlow({ data }) {
  return (
    <div className="section-card">
      <h2 className="section-title">Project-wise Cash Flow</h2>
      <p className="section-subtitle">Fee Received vs Expenses Done per project</p>

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
            const net = row.feesReceived - row.expensesDone
            const netClass = net > 0 ? 'net-positive' : net < 0 ? 'net-negative' : 'net-zero'
            return (
              <tr key={i}>
                <td>{row.project}</td>
                <td>{formatINR(row.feesReceived)}</td>
                <td>{formatINR(row.expensesDone)}</td>
                <td className={netClass}>
                  {net >= 0 ? '+' : ''}{formatINR(net)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
