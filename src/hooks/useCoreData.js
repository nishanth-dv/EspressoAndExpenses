import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useCoreDataQuery } from "../redux/api";
import { setCoreData } from "../redux/slices/transactionSlice";
import { dbEnabled, currentEmail } from "../utils/storage/allowlist";

// Bootstrap for the small/bounded data (settings/preferences + accounts, cards,
// subscriptions, commitments, lendings, goals, notes). For DB users it fetches
// the bundled `coreData` query once and SEEDS it into the blob (merged, so the
// lazily-loaded large collections aren't touched). Consumers keep their normal
// `useSelector` reads — this hook only triggers the seed, it returns nothing.
//
// `lastSeeded` is module-level so only one caller dispatches the seed per fetch.
let lastSeeded = null;

export function useCoreData() {
  const dispatch = useDispatch();
  const useDb = dbEnabled(currentEmail());
  const dbReady = useSelector((state) => state.transactions.status === "ready");
  const { data } = useCoreDataQuery(undefined, { skip: !useDb || !dbReady });

  useEffect(() => {
    if (!useDb || !data || lastSeeded === data) return;
    lastSeeded = data;
    dispatch(setCoreData(data));
  }, [useDb, data, dispatch]);
}
