import { useEffect, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useLedger } from "../hooks/useLedger";
import { useInvestments, useInvestmentsLoading } from "../hooks/useInvestments";
import { useTransactionsQuery } from "../redux/api";
import { persistSubscriptionAutoPost } from "../redux/slices/solvencySlice";
import { persistBackfillLogModes } from "../redux/slices/transactionSlice";
import { dbEnabled, currentEmail } from "../utils/storage/allowlist";

function Seeder() {
  const dispatch = useDispatch();
  useLedger();
  // Seeds the investments blob too — the log-mode backfill below reads it,
  // and gating on `investments.length` alone would let an empty pre-fetch
  // blob burn the one-shot guard.
  const investments = useInvestments();
  const investmentsLoading = useInvestmentsLoading();

  const useDb = dbEnabled(currentEmail());
  const { isSuccess } = useTransactionsQuery(undefined, { skip: !useDb });
  const ledgerReady = useDb ? isSuccess : true;
  const swept = useRef(false);
  const backfilled = useRef(false);

  useEffect(() => {
    if (!ledgerReady || swept.current) return;
    swept.current = true;
    dispatch(persistSubscriptionAutoPost());
  }, [ledgerReady, dispatch]);

  useEffect(() => {
    if (investmentsLoading || !investments.length || backfilled.current) return;
    backfilled.current = true;
    dispatch(persistBackfillLogModes());
  }, [investments, investmentsLoading, dispatch]);

  return null;
}

export default function DbSeeder() {
  const ready = useSelector((s) => s.transactions.status === "ready");
  return ready ? <Seeder /> : null;
}
