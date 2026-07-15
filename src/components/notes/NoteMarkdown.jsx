import PropTypes from "prop-types";

// Renders a note's light-markdown body:
//   **bold**            → <strong>
//   *italic*            → <em>
//   ~~strike~~          → <s>
//   - bullet            → bulleted line
//   - [ ] / - [x] task  → interactive checkbox (checked → struck through)
//   blank line          → spacer
// Deliberately tiny — no third-party markdown/rich-text dependency. Task
// checkboxes call onToggleTask(lineIndex); the owner rewrites that source line.

function renderInline(text, keyPrefix) {
  const out = [];
  // Order matters: match **bold** before *italic* so the double-asterisk form
  // wins. ~~strike~~ is independent.
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<strong key={`${keyPrefix}-b${i}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("~~")) {
      out.push(<s key={`${keyPrefix}-s${i}`}>{tok.slice(2, -2)}</s>);
    } else {
      out.push(<em key={`${keyPrefix}-i${i}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function NoteMarkdown({ body, onToggleTask }) {
  const lines = (body || "").split("\n");
  return (
    <div className="note-md">
      {lines.map((line, i) => {
        const task = /^\s*-\s+\[([ xX])\]\s?(.*)$/.exec(line);
        if (task) {
          const done = task[1].toLowerCase() === "x";
          return (
            <label
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              className={`note-md-task${done ? " note-md-task--done" : ""}`}
            >
              <input
                type="checkbox"
                checked={done}
                onChange={() => onToggleTask?.(i)}
              />
              <span>{renderInline(task[2], `l${i}`)}</span>
            </label>
          );
        }
        const bullet = /^\s*-\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            // eslint-disable-next-line react/no-array-index-key
            <div className="note-md-bullet" key={i}>
              <span className="note-md-dot">•</span>
              <span>{renderInline(bullet[1], `l${i}`)}</span>
            </div>
          );
        }
        if (line.trim() === "") {
          // eslint-disable-next-line react/no-array-index-key
          return <div className="note-md-blank" key={i} />;
        }
        return (
          // eslint-disable-next-line react/no-array-index-key
          <p className="note-md-line" key={i}>
            {renderInline(line, `l${i}`)}
          </p>
        );
      })}
    </div>
  );
}

NoteMarkdown.propTypes = {
  body: PropTypes.string,
  onToggleTask: PropTypes.func,
};
