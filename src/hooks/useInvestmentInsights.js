import { useEffect, useState } from "react";
import { gql } from "../utils/graphql";

const QUERY = `query InvestmentInsights {
  concentration {
    totalValue
    topHolding { label type value pct }
    topType { label type value pct }
  }
  allocationByType { type invested currentValue }
}`;

export default function useInvestmentInsights(enabled) {
  const [state, setState] = useState({
    loading: !!enabled,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    gql(QUERY)
      .then((d) => {
        if (!cancelled) setState({ loading: false, data: d, error: null });
      })
      .catch((e) => {
        if (!cancelled) setState({ loading: false, data: null, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}
