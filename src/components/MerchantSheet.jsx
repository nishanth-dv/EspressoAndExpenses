import Modal from "../preStyledElements/modal/Modal";

const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function when(d) {
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function MerchantSheet({ open, onClose, stats, accent }) {
  const max = stats ? Math.max(1, ...stats.months.map((m) => m.total)) : 1;
  return (
    <Modal open={open} onClose={onClose} title={stats?.label ?? "Merchant"}>
      {stats && (
        <div className="merchant-sheet" style={{ "--ms-accent": accent }}>
          <div className="merchant-stat-row">
            <div className="merchant-stat">
              <span className="merchant-stat-label">All-time</span>
              <span className="merchant-stat-value">
                {inr0.format(stats.total)}
              </span>
            </div>
            <div className="merchant-stat">
              <span className="merchant-stat-label">
                {stats.type === "income" ? "Times" : "Visits"}
              </span>
              <span className="merchant-stat-value">{stats.count}</span>
            </div>
            <div className="merchant-stat">
              <span className="merchant-stat-label">Average</span>
              <span className="merchant-stat-value">
                {inr0.format(stats.avg)}
              </span>
            </div>
          </div>

          <div className="merchant-trend">
            <span className="merchant-trend-title">Last 6 months</span>
            <div className="merchant-bars">
              {stats.months.map((m) => (
                <div key={m.key} className="merchant-bar-col">
                  <div className="merchant-bar-track">
                    <div
                      className="merchant-bar-fill"
                      style={{
                        height: `${m.total > 0 ? Math.max(6, (m.total / max) * 100) : 0}%`,
                      }}
                      title={inr0.format(m.total)}
                    />
                  </div>
                  <span className="merchant-bar-label">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="merchant-meta">
            {stats.topCategory && (
              <span>
                <i className="fa-solid fa-tag" /> Mostly {stats.topCategory}
              </span>
            )}
            <span>
              <i className="fa-regular fa-clock" /> First {when(stats.first)}
            </span>
            {stats.count > 1 && (
              <span>
                <i className="fa-solid fa-clock-rotate-left" /> Latest{" "}
                {when(stats.last)}
              </span>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
