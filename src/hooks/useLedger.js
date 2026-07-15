import { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useTransactionsQuery } from "../redux/api";
import { setTransactions } from "../redux/slices/transactionSlice";
import { dbEnabled, currentEmail } from "../utils/storage/allowlist";

// Single source for the ledger. Reads the Redux blob (so optimistic writes and
// every other consumer stay in sync), and for DB users fetches the full list
// from the page-wise `transactions` API and SEEDS the blob. Same pattern as
// useInvestments — seeding rather than reading the API cache directly means
// writes reflect instantly (no refetch) and there's no invalidation to keep in
// step across the app's many transaction write paths.
//
// `lastSeeded` is module-level so only one caller dispatches the seed per fetch.
let lastSeeded = null;
const EMPTY = [];

export function useLedger() {
  const dispatch = useDispatch();
  const useDb = dbEnabled(currentEmail());
  const dbReady = useSelector((state) => state.transactions.status === "ready");
  const blobTransactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? EMPTY,
  );
  const { data } = useTransactionsQuery(undefined, { skip: !useDb || !dbReady });

  useEffect(() => {
    if (!useDb || !data || lastSeeded === data) return;
    lastSeeded = data;
    dispatch(setTransactions(data));
  }, [useDb, data, dispatch]);

  return blobTransactions;
}

export function useLedgerLoading() {
  const useDb = dbEnabled(currentEmail());
  const dbReady = useSelector((state) => state.transactions.status === "ready");
  const { isLoading } = useTransactionsQuery(undefined, {
    skip: !useDb || !dbReady,
  });
  return useDb && (isLoading || !dbReady);
}
