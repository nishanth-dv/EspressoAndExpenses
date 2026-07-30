export default function GrowSection({ icon, title, subtitle, aside, className = "", children }) {
  return (
    <section className={`grow-sec${className ? ` ${className}` : ""}`}>
      <header className="grow-sec-head">
        <span className="grow-sec-ico">
          <i className={`fa-solid ${icon}`} />
        </span>
        <div className="grow-sec-titles">
          <h3 className="grow-sec-title">{title}</h3>
          {subtitle && <p className="grow-sec-sub">{subtitle}</p>}
        </div>
        {aside && <div className="grow-sec-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}
