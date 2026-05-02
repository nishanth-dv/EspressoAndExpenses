import { memo } from "react";
import { useSelector } from "react-redux";

const Insights = () => {
  const insights = useSelector((state) => state.transactions.transactionData?.insights);
  const balance = insights?.balance ?? 0;
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
