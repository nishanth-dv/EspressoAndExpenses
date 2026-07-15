import { useEffect, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useLedger } from "../hooks/useLedger";
import { useTransactionsQuery } from "../redux/api";
import { persistSubscriptionAutoPost } from "../redux/slices/solvencySlice";
import { dbEnabled, currentEmail } from "../utils/storage/allowlist";

function Seeder() {
  const dispatch = useDispatch();
  useLedger();

  const useDb = dbEnabled(currentEmail());
  const { isSuccess } = useTransactionsQuery(undefined, { skip: !useDb });
  const ledgerReady = useDb ? isSuccess : true;
  const swept = useRef(false);

  useEffect(() => {
    if (!ledgerReady || swept.current) return;
    swept.current = true;
    dispatch(persistSubscriptionAutoPost());
  }, [ledgerReady, dispatch]);

  return null;
}

export default function DbSeeder() {
  const ready = useSelector((s) => s.transactions.status === "ready");
  return ready ? <Seeder /> : null;
}
