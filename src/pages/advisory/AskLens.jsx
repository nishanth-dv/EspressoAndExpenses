import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSelector } from "react-redux";
import { fetchMarket } from "../../utils/advisory/market";
import { buildSnapshot, askAdvisor } from "../../utils/advisory/ask";

const EASE = [0.25, 0.46, 0.45, 0.94];

const STARTERS = [
  "How am I doing financially?",
  "Where is most of my money going?",
  "Am I saving enough to retire?",
  "What's the best money move I can make right now?",
];

let msgSeq = 0;
const nextId = () => `m${(msgSeq += 1)}`;

export default function AskLens() {
  const data = useSelector((s) => s.transactions.transactionData) ?? {};
  const [market, setMarket] = useState({});
  const [messages, setMessages] = useState([]); // { role, content }
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [disabled, setDisabled] = useState(null); // "not_configured" | null
  const scrollRef = useRef(null);

  useEffect(() => {
    let alive = true;
    fetchMarket()
      .then((m) => alive && setMarket(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text) => {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    setInput("");
    const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    const nextMsgs = [...messages, { id: nextId(), role: "user", content: question }];
    setMessages(nextMsgs);
    setBusy(true);
    try {
      const snapshot = buildSnapshot(data, market);
      const { answer } = await askAdvisor(question, snapshot, history);
      setMessages([...nextMsgs, { id: nextId(), role: "assistant", content: answer }]);
    } catch (err) {
      if (err.code === "not_configured") {
        setDisabled("not_configured");
        setMessages(messages); // roll back the unsent question
      } else {
        setMessages([
          ...nextMsgs,
          { id: nextId(), role: "assistant", content: `⚠️ ${err.message}`, error: true },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  if (disabled === "not_configured") {
    return (
      <div className="adv-ask-off">
        <i className="fa-solid fa-plug-circle-xmark adv-ask-off-icon" />
        <h3>Ask isn&apos;t switched on yet</h3>
        <p>
          The assistant answers questions about your money from a private summary
          of your own data. It goes live once an AI provider key is configured on
          the server (<code>LLM_API_KEY</code>). Everything else in Advisory works
          without it.
        </p>
      </div>
    );
  }

  return (
    <div className="adv-ask">
      <div className="adv-ask-intro">
        <i className="fa-solid fa-wand-magic-sparkles adv-ask-intro-ico" />
        <p>
          Ask about your money — answered from a <strong>private summary</strong>{" "}
          of your own numbers (net worth, cash flow, holdings, actions). Your raw
          transactions never leave your device.
        </p>
      </div>

      <div className="adv-ask-thread" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="adv-ask-starters">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                className="adv-ask-starter"
                onClick={() => send(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              className={`adv-ask-msg adv-ask-msg--${m.role}${m.error ? " adv-ask-msg--error" : ""}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              {m.content}
            </motion.div>
          ))}
        </AnimatePresence>
        {busy && (
          <div className="adv-ask-msg adv-ask-msg--assistant adv-ask-typing">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <form
        className="adv-ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="adv-ask-input"
          value={input}
          placeholder="Ask about your finances…"
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="adv-ask-send"
          disabled={busy || !input.trim()}
          aria-label="Send"
        >
          <i className="fa-solid fa-arrow-up" />
        </button>
      </form>
      <p className="adv-ask-disclaimer">
        Answers are AI-generated from your data and can be wrong — not financial
        advice.
      </p>
    </div>
  );
}
