import PropTypes from "prop-types";
import { getBankBranding, bankLogoSlug } from "../utils/bankBranding";

const LOGO_FILES = import.meta.glob("../assets/banks/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

function logoUrl(bank) {
  const key = bankLogoSlug(bank);
  if (!key) return null;
  const match = Object.entries(LOGO_FILES).find(([path]) =>
    path.toLowerCase().endsWith(`/${key}.svg`),
  );
  return match ? match[1] : null;
}

const BankLogo = ({ bank, color, size = 22, className = "" }) => {
  const url = logoUrl(bank);
  const branding = getBankBranding(bank, color);

  // Cash isn't a bank with a logo — render a solid wallet glyph (no swatch),
  // matching the "Add Cash" chip, tinted with its brand colour.
  if ((bank || "").trim().toLowerCase() === "cash") {
    return (
      <span
        className={`bank-logo bank-logo--icon ${className}`}
        style={{
          width: size,
          height: size,
          color: branding.color,
          fontSize: Math.round(size * 0.72),
        }}
        title="Cash"
        aria-label="Cash"
      >
        <i className="fa-solid fa-wallet" />
      </span>
    );
  }

  if (url) {
    return (
      <span
        className={`bank-logo bank-logo--img ${className}`}
        style={{ width: size, height: size }}
        title={bank || "Bank"}
      >
        <img src={url} alt={bank || "Bank"} />
      </span>
    );
  }

  return (
    <span
      className={`bank-logo ${className}`}
      style={{
        width: size,
        height: size,
        background: branding.color,
        fontSize: Math.max(8, Math.round(size * 0.36)),
      }}
      title={bank || "Bank"}
      aria-label={bank || "Bank"}
    >
      {branding.short}
    </span>
  );
};

BankLogo.propTypes = {
  bank: PropTypes.string,
  color: PropTypes.string,
  size: PropTypes.number,
  className: PropTypes.string,
};

export default BankLogo;
