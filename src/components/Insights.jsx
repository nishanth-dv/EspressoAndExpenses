import { memo } from "react";
import BalanceCarousel from "./BalanceCarousel";

const Insights = () => {
  return (
    <div className="insights">
      <BalanceCarousel variant="compact" syncTransactionFilter />
    </div>
  );
};

export default memo(Insights);
