import { memo, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { persistSetPreference } from "../redux/slices/transactionSlice";
import {
  SHORTCUT_LIMIT,
  describeShortcut,
  listShortcutTargets,
  shortcutKey,
} from "../utils/shortcuts";

const ShortcutsManager = () => {
  const dispatch = useDispatch();
  const preferences = useSelector(
    (state) => state.transactions.transactionData?.preferences,
  );
  const accessPages = useSelector((state) => state.access.pages);
  const [pickPage, setPickPage] = useState("");
  const [pickTab, setPickTab] = useState("");

  const stored = useMemo(
    () => (Array.isArray(preferences?.shortcuts) ? preferences.shortcuts : []),
    [preferences],
  );
  const targets = useMemo(
    () => listShortcutTargets({ preferences, accessPages }),
    [preferences, accessPages],
  );
  const rows = useMemo(
    () =>
      stored.map((entry) => ({
        entry,
        info: describeShortcut(entry, { preferences, accessPages }),
      })),
    [stored, preferences, accessPages],
  );

  const selected = targets.find((t) => t.key === pickPage) ?? null;
  const full = stored.length >= SHORTCUT_LIMIT;
  const taken = new Set(stored.map(shortcutKey));
  const pendingKey = pickPage
    ? shortcutKey({ page: pickPage, tab: pickTab })
    : "";
  const duplicate = Boolean(pendingKey) && taken.has(pendingKey);

  function save(next) {
    dispatch(persistSetPreference("shortcuts", next));
  }

  function move(from, to) {
    if (to < 0 || to >= stored.length) return;
    const next = [...stored];
    [next[from], next[to]] = [next[to], next[from]];
    save(next);
  }

  function remove(index) {
    save(stored.filter((_, i) => i !== index));
  }

  function add() {
    if (!pickPage || full || duplicate) return;
    save([...stored, pickTab ? { page: pickPage, tab: pickTab } : { page: pickPage }]);
    setPickPage("");
    setPickTab("");
  }

  return (
    <>
      <p className="pref-section-hint">
        Shortcuts appear in the Actions button, so a page — or a specific tab
        inside it — is one tap away. Only pages you can currently reach are
        offered; if a page is later turned off or access is revoked, its
        shortcut hides itself and comes back when the page does.
      </p>

      {rows.length > 0 && (
        <ul className="pref-pages-list sc-list">
          {rows.map(({ entry, info }, i) => (
            <li
              key={info ? `${info.key}-${i}` : `unknown-${i}`}
              className={`pref-page-row${info?.available ? "" : " sc-row--off"}`}
            >
              <span className="pref-page-icon">
                <i className={`fa-solid ${info?.icon ?? "fa-link-slash"}`} />
              </span>
              <div className="pref-page-meta">
                <span className="pref-page-name">
                  {info?.label ?? "Unavailable shortcut"}
                  {info && !info.available && (
                    <span className="sc-row-tag">{info.unavailableReason}</span>
                  )}
                </span>
                <span className="pref-page-blurb">
                  {info?.path ?? `${entry?.page ?? "?"} · ${entry?.tab ?? ""}`}
                </span>
              </div>
              <div className="sc-row-actions">
                <button
                  type="button"
                  className="sc-icon-btn"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label={`Move ${info?.label ?? "shortcut"} up`}
                >
                  <i className="fa-solid fa-chevron-up" />
                </button>
                <button
                  type="button"
                  className="sc-icon-btn"
                  onClick={() => move(i, i + 1)}
                  disabled={i === rows.length - 1}
                  aria-label={`Move ${info?.label ?? "shortcut"} down`}
                >
                  <i className="fa-solid fa-chevron-down" />
                </button>
                <button
                  type="button"
                  className="sc-icon-btn sc-icon-btn--del"
                  onClick={() => remove(i)}
                  aria-label={`Remove ${info?.label ?? "shortcut"}`}
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="sc-add">
        <div className="sc-add-head">
          <p className="pref-row-label">Add a shortcut</p>
          <span className="sc-count">
            {stored.length} / {SHORTCUT_LIMIT}
          </span>
        </div>

        {full ? (
          <p className="pref-row-hint">
            You&apos;ve reached the limit. Remove one to add another.
          </p>
        ) : (
          <>
            <div className="sc-chips">
              {targets.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`pref-zone-tab${pickPage === t.key ? " pref-zone-tab--active" : ""}`}
                  onClick={() => {
                    setPickPage(t.key);
                    setPickTab("");
                  }}
                  aria-pressed={pickPage === t.key}
                >
                  <i className={`fa-solid ${t.icon}`} />
                  {t.label}
                </button>
              ))}
            </div>

            {selected && selected.tabs.length > 0 && (
              <div className="sc-chips sc-chips--tabs">
                <button
                  type="button"
                  className={`pref-zone-tab${pickTab === "" ? " pref-zone-tab--active" : ""}`}
                  onClick={() => setPickTab("")}
                  aria-pressed={pickTab === ""}
                >
                  Whole page
                </button>
                {selected.tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`pref-zone-tab${pickTab === tab.key ? " pref-zone-tab--active" : ""}`}
                    onClick={() => setPickTab(tab.key)}
                    aria-pressed={pickTab === tab.key}
                  >
                    <i className={`fa-solid ${tab.icon}`} />
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            <div className="sc-add-foot">
              <button
                type="button"
                className="generic-button"
                onClick={add}
                disabled={!pickPage || duplicate}
              >
                <i className="fa-solid fa-plus" />
                Add shortcut
              </button>
              {duplicate && (
                <span className="sc-dupe">That shortcut already exists.</span>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default memo(ShortcutsManager);
