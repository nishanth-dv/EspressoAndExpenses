import { memo } from "react";

const Insights = () => {
  const balance = 69696969;
  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });

  return (
    <div className="insights">
      <p className="balance">Your balance: {formatter.format(balance)}</p>
    </div>
  );
};

export default memo(Insights);
