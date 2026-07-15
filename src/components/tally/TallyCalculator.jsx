import { useState } from "react";
import PropTypes from "prop-types";

function trim(n) {
  if (!Number.isFinite(n)) return "Error";
  return String(Math.round((n + Number.EPSILON) * 1e6) / 1e6);
}

function group(s) {
  if (s === "Error") return s;
  const neg = s.startsWith("-");
  const raw = neg ? s.slice(1) : s;
  const [int, dec] = raw.split(".");
  const gi = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + gi + (dec != null ? `.${dec}` : "");
}

function opSym(op) {
  if (op === "/") return "÷";
  if (op === "*") return "×";
  if (op === "-") return "−";
  if (op === "+") return "+";
  return "";
}

function calc(a, b, op) {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  if (op === "/") return b === 0 ? NaN : a / b;
  return b;
}

export default function TallyCalculator({ seed, onBack }) {
  const [display, setDisplay] = useState(() => trim(Number(seed) || 0));
  const [acc, setAcc] = useState(null);
  const [pending, setPending] = useState(null);
  const [overwrite, setOverwrite] = useState(true);

  const digit = (d) => {
    if (display === "Error" || overwrite) {
      setDisplay(d);
      setOverwrite(false);
    } else {
      setDisplay(display === "0" ? d : display + d);
    }
  };
  const dot = () => {
    if (display === "Error" || overwrite) {
      setDisplay("0.");
      setOverwrite(false);
    } else if (!display.includes(".")) {
      setDisplay(`${display}.`);
    }
  };
  const clearAll = () => {
    setDisplay("0");
    setAcc(null);
    setPending(null);
    setOverwrite(true);
  };
  const back = () => {
    if (display === "Error" || overwrite) return;
    const next = display.length > 1 ? display.slice(0, -1) : "0";
    setDisplay(next);
    if (next === "0") setOverwrite(true);
  };
  const operator = (op) => {
    if (display === "Error") return;
    const cur = parseFloat(display);
    if (pending != null && !overwrite) {
      const res = calc(acc, cur, pending);
      setAcc(res);
      setDisplay(trim(res));
    } else {
      setAcc(cur);
    }
    setPending(op);
    setOverwrite(true);
  };
  const equals = () => {
    if (pending == null || display === "Error") return;
    const res = calc(acc, parseFloat(display), pending);
    setDisplay(trim(res));
    setAcc(null);
    setPending(null);
    setOverwrite(true);
  };
  const percent = () => {
    if (display === "Error") return;
    setDisplay(trim(parseFloat(display) / 100));
    setOverwrite(true);
  };
  const negate = () => {
    if (display === "Error") return;
    setDisplay(trim(parseFloat(display) * -1));
  };

  const keys = [
    { t: "C", fn: clearAll, cls: "fn" },
    { t: "±", fn: negate, cls: "fn" },
    { t: "%", fn: percent, cls: "fn" },
    { t: "÷", fn: () => operator("/"), cls: "op", op: "/" },
    { t: "7", fn: () => digit("7") },
    { t: "8", fn: () => digit("8") },
    { t: "9", fn: () => digit("9") },
    { t: "×", fn: () => operator("*"), cls: "op", op: "*" },
    { t: "4", fn: () => digit("4") },
    { t: "5", fn: () => digit("5") },
    { t: "6", fn: () => digit("6") },
    { t: "−", fn: () => operator("-"), cls: "op", op: "-" },
    { t: "1", fn: () => digit("1") },
    { t: "2", fn: () => digit("2") },
    { t: "3", fn: () => digit("3") },
    { t: "+", fn: () => operator("+"), cls: "op", op: "+" },
    { t: "0", fn: () => digit("0") },
    { t: ".", fn: dot },
    { t: "⌫", fn: back, cls: "fn" },
    { t: "=", fn: equals, cls: "eq" },
  ];

  return (
    <div className="tally-calc">
      <button type="button" className="tally-calc-back" onClick={onBack}>
        <i className="fa-solid fa-chevron-left" /> Back to tally
      </button>
      <div className="tally-calc-expr">
        {pending != null ? `${group(trim(acc))} ${opSym(pending)}` : " "}
      </div>
      <div className="tally-calc-display">{group(display)}</div>
      <div className="tally-calc-grid">
        {keys.map((k) => (
          <button
            key={k.t}
            type="button"
            className={`tally-calc-key${k.cls ? ` tally-calc-key--${k.cls}` : ""}${k.op && k.op === pending ? " tally-calc-key--active" : ""}`}
            onClick={k.fn}
          >
            {k.t}
          </button>
        ))}
      </div>
    </div>
  );
}

TallyCalculator.propTypes = {
  seed: PropTypes.number,
  onBack: PropTypes.func.isRequired,
};
