import { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useInvestmentsQuery } from "../redux/api";
import { setInvestments } from "../redux/slices/transactionSlice";
import { dbEnabled, currentEmail } from "../utils/storage/allowlist";

// Single source for the holdings list. It reads from the Redux blob (so every
// consumer — and the page's optimistic writes / auto-persist effects — keeps
// working exactly as before), and for DB users it fetches the full list from
// the page-wise `investments` API and SEEDS that blob. Reading the blob rather
// than the API cache directly is deliberate: the Investment page has effects
// that write on every `investments` change, and reading a cache that refetches
// after each write would loop. Seeding is idempotent and one-shot per fetch.
//
// `lastSeeded` is module-level so that, although several components call this
// hook, only one actually dispatches the seed per distinct API response.
let lastSeeded = null;
const EMPTY = [];

export function useInvestments() {
  const dispatch = useDispatch();
  const useDb = dbEnabled(currentEmail());
  const dbReady = useSelector((state) => state.transactions.status === "ready");
  const blobInvestments = useSelector(
    (state) => state.transactions.transactionData?.investments ?? EMPTY,
  );
  const { data } = useInvestmentsQuery(undefined, { skip: !useDb || !dbReady });

  useEffect(() => {
    if (!useDb || !data || lastSeeded === data) return;
    lastSeeded = data;
    dispatch(setInvestments(data));
  }, [useDb, data, dispatch]);

  return blobInvestments;
}

// True while the first investments fetch is in flight (DB users only) — for
// showing a loading skeleton. Subscribes to the same cache entry as
// useInvestments (RTK dedupes), so no extra request is made.
export function useInvestmentsLoading() {
  const useDb = dbEnabled(currentEmail());
  const dbReady = useSelector((state) => state.transactions.status === "ready");
  const { isLoading } = useInvestmentsQuery(undefined, {
    skip: !useDb || !dbReady,
  });
  return useDb && (isLoading || !dbReady);
}
