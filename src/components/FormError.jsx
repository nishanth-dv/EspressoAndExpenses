import { memo } from "react";
import PropTypes from "prop-types";

// One consolidated validation message for a form: lists every missing
// required field in a single banner instead of the browser's one-at-a-time
// native bubbles. Renders nothing when there's nothing to flag.
const FormError = ({ fields }) => {
  if (!fields || fields.length === 0) return null;
  return (
    <div className="form-error" role="alert">
      <i className="fa-solid fa-circle-exclamation" />
      <span>
        Please fill in {fields.length === 1 ? "this field" : "these fields"}:{" "}
        {fields.join(", ")}.
      </span>
    </div>
  );
};

FormError.propTypes = {
  fields: PropTypes.arrayOf(PropTypes.string),
};

export default memo(FormError);
