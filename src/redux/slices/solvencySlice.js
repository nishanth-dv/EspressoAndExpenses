import { updateFile } from "../../utils/googleDrive";
import { showToast } from "./toastSlice";
import {
  addCard, updateCard, deleteCard,
  addCommitment, updateCommitment, deleteCommitment,
  addLending, updateLending, deleteLending,
  addTransaction,
} from "./transactionSlice";

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

async function persist(dispatch, getState) {
  const { fileID, transactionData } = getState().transactions;
  try {
    await updateFile(fileID, transactionData);
  } catch (e) {
    dispatch(showToast({ message: "Save failed — changes may not persist on reload.", type: "error" }));
    throw e;
  }
}

// ── Card thunks ────────────────────────────────────────

// Strip the local-only `creditGroupId` field cleanly so it is omitted, not set to undefined.
function stripGroupId(card) {
  const { creditGroupId: _ignored, ...rest } = card;
  return rest;
}

// Apply group-membership changes (combining or leaving) and dispatch the add/update.
// Wrapped in one thunk so siblings update together with a single Drive write.
function applyGroupAndSave(card, mode, combineBank) {
  return async (dispatch, getState) => {
    const state = getState().transactions.transactionData;
    const cards = state.cards ?? [];
    let cardToSave = card;
    let toastMessage;

    if (combineBank) {
      const siblings = cards.filter(
        (c) => c.bank === combineBank && c.id !== card.id,
      );
      let groupId = siblings.find((c) => c.creditGroupId)?.creditGroupId;
      if (!groupId) groupId = crypto.randomUUID();
      // Pull all same-bank siblings without this groupId into the pool.
      siblings.forEach((s) => {
        if (s.creditGroupId !== groupId) {
          dispatch(updateCard({ ...s, creditGroupId: groupId }));
        }
      });
      cardToSave = { ...card, creditGroupId: groupId };
      toastMessage = `${card.name} ${mode === "add" ? "added" : "updated"} · pooled with ${combineBank}`;
    } else {
      const oldGroupId =
        mode === "update"
          ? cards.find((c) => c.id === card.id)?.creditGroupId
          : null;
      cardToSave = stripGroupId(card);

      // If the card is leaving a group of two, the lone remaining card has no
      // partner — clear its groupId so it isn't an orphan in a singleton pool.
      if (oldGroupId) {
        const remaining = cards.filter(
          (c) => c.creditGroupId === oldGroupId && c.id !== card.id,
        );
        if (remaining.length === 1) {
          dispatch(updateCard(stripGroupId(remaining[0])));
        }
      }
      toastMessage = `${card.name} ${mode === "add" ? "added" : "updated"}`;
    }

    if (mode === "add") dispatch(addCard(cardToSave));
    else dispatch(updateCard(cardToSave));

    await persist(dispatch, getState);
    dispatch(showToast({ message: toastMessage }));
  };
}

export const persistAddCard = (card, opts = {}) =>
  applyGroupAndSave(card, "add", opts.combineBank ?? null);

export const persistUpdateCard = (card, opts = {}) =>
  applyGroupAndSave(card, "update", opts.combineBank ?? null);

export const persistDeleteCard = (id) => async (dispatch, getState) => {
  const state = getState().transactions.transactionData;
  const card = state.cards?.find((c) => c.id === id);
  const groupId = card?.creditGroupId;

  dispatch(deleteCard(id));

  if (groupId) {
    const remaining = (state.cards ?? []).filter(
      (c) => c.creditGroupId === groupId && c.id !== id,
    );
    if (remaining.length === 1) {
      dispatch(updateCard(stripGroupId(remaining[0])));
    }
  }

  await persist(dispatch, getState);
  dispatch(showToast({ message: "Card removed" }));
};

// ── Commitment thunks ─────────────────────────────────

export const persistAddCommitment = (c) => async (dispatch, getState) => {
  dispatch(addCommitment(c));
  await persist(dispatch, getState);
  dispatch(showToast({ message: `${c.name} added` }));
};

export const persistUpdateCommitment = (c) => async (dispatch, getState) => {
  dispatch(updateCommitment(c));
  await persist(dispatch, getState);
  dispatch(showToast({ message: "Commitment updated" }));
};

export const persistDeleteCommitment = (id) => async (dispatch, getState) => {
  dispatch(deleteCommitment(id));
  await persist(dispatch, getState);
  dispatch(showToast({ message: "Commitment removed" }));
};

// Preclose / foreclose an EMI commitment. Snapshots its outstanding to
// zero (which makes commitmentIsActive return false going forward), and
// optionally logs the settlement amount as an expense in the ledger.
//
// Why an outstanding snapshot rather than just a flag: the existing
// active/inactive logic already gates on `currentOutstanding === 0`, so
// preclosing through the same field keeps all downstream math —
// obligations totals, upcoming dues, loan progress — consistent without
// any extra branches. The dedicated `preclosedAt` + `preclosedAmount`
// fields preserve audit trail for the history view.
export const persistPrecloseCommitment =
  ({ commitment, amount, occurredAt, postLedger }) =>
  async (dispatch, getState) => {
    if (!commitment?.id) return;
    const now = new Date().toISOString();
    const settled = parseFloat(amount) || 0;
    dispatch(
      updateCommitment({
        ...commitment,
        currentOutstanding: 0,
        currentOutstandingDate: occurredAt || now,
        preclosedAt: now,
        preclosedAmount: settled,
      }),
    );
    if (postLedger && settled > 0) {
      dispatch(
        addTransaction({
          id: crypto.randomUUID(),
          createdAt: now,
          occurredAt: occurredAt || now,
          transactionType: "expense",
          name: `Preclose: ${commitment.name}`,
          amount: String(settled),
          category: "Repayment",
          paymentMode: "Other",
          // Tag against the commitment id so it shows up under the
          // commitment in any history view; the EMI itself is closed
          // so this is a one-off settlement, not a recurring payment.
          repaymentFor: commitment.id,
        }),
      );
    }
    await persist(dispatch, getState);
    dispatch(
      showToast({
        message: `${commitment.name} ${settled > 0 ? `preclosed for ${INR.format(settled)}` : "preclosed"}`,
      }),
    );
  };

// ── Pay EMI thunk ─────────────────────────────────────

export const persistPayCommitmentEMI = (commitment) => async (dispatch, getState) => {
  const emiAmount = parseFloat(commitment.emiAmount) || 0;
  if (emiAmount <= 0) return;

  // Reduce commitment outstanding (for loan types)
  if (commitment.type === "emi" && (parseFloat(commitment.outstanding) || 0) > 0) {
    const newOutstanding = Math.max(0, (parseFloat(commitment.outstanding) || 0) - emiAmount);
    dispatch(updateCommitment({ ...commitment, outstanding: newOutstanding }));
  }

  // If paid via credit card, increase card outstanding
  if (commitment.paymentMedium === "credit_card" && commitment.cardId) {
    const cards = getState().transactions.transactionData?.cards ?? [];
    const card = cards.find((c) => c.id === commitment.cardId);
    if (card) {
      const newCardOutstanding = (parseFloat(card.outstanding) || 0) + emiAmount;
      dispatch(updateCard({ ...card, outstanding: newCardOutstanding }));
    }
  }

  await persist(dispatch, getState);
  dispatch(showToast({ message: `Payment of ${INR.format(emiAmount)} recorded` }));
};

// ── Lending thunks ────────────────────────────────────

export const persistAddLending = (l) => async (dispatch, getState) => {
  dispatch(addLending(l));
  await persist(dispatch, getState);
  dispatch(showToast({ message: `${l.name} added` }));
};

export const persistUpdateLending = (l) => async (dispatch, getState) => {
  dispatch(updateLending(l));
  await persist(dispatch, getState);
  dispatch(showToast({ message: "Entry updated" }));
};

export const persistDeleteLending = (id) => async (dispatch, getState) => {
  dispatch(deleteLending(id));
  await persist(dispatch, getState);
  dispatch(showToast({ message: "Entry removed" }));
};

// Records a partial or full repayment on a lending. Optionally logs an
// income / expense transaction so the user's balance reflects the movement.
export const persistRepayLending =
  ({ lending, amount, occurredAt, affectBalance }) =>
  async (dispatch, getState) => {
    const isLent = lending.direction === "lent";
    const remaining = Math.max(
      0,
      (parseFloat(lending.outstanding) || 0) - amount,
    );
    dispatch(updateLending({ ...lending, outstanding: remaining }));

    if (affectBalance) {
      dispatch(
        addTransaction({
          id: crypto.randomUUID(),
          transactionType: isLent ? "income" : "expense",
          name: isLent ? `Received from ${lending.name}` : lending.name,
          amount: String(amount),
          category: isLent ? "Other" : "Repayment",
          occurredAt,
          createdAt: new Date().toISOString(),
          lendingId: lending.id,
        }),
      );
    }

    await persist(dispatch, getState);
    dispatch(
      showToast({
        message: `${INR.format(amount)} ${isLent ? "received from" : "repaid to"} ${lending.name}`,
      }),
    );
  };
