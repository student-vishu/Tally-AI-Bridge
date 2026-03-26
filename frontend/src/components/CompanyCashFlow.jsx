const formatINR = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(value)

export default function CompanyCashFlow({ data }) {
  const { moneyIn, moneyOut } = data
  const net = moneyIn - moneyOut

  return (
    <div className="section-card">
      <h2 className="section-title">Company Cash Flow</h2>
      <p className="section-subtitle">Total Money In vs Money Out for the company</p>

      <div className="stat-cards">
        <div className="stat-card green">
          <span className="stat-label">Money In</span>
          <span className="stat-amount">{formatINR(moneyIn)}</span>
          <span className="stat-arrow">↑</span>
        </div>
        <div className="stat-card red">
          <span className="stat-label">Money Out</span>
          <span className="stat-amount">{formatINR(moneyOut)}</span>
          <span className="stat-arrow">↓</span>
        </div>
        <div className={`stat-card ${net >= 0 ? 'green' : 'red'}`}>
          <span className="stat-label">Net Flow</span>
          <span className="stat-amount">{net >= 0 ? '+' : ''}{formatINR(net)}</span>
          <span className="stat-arrow">{net >= 0 ? '↑' : '↓'}</span>
        </div>
      </div>
    </div>
  )
}
