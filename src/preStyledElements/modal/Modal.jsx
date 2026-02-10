import { useEffect, useRef, memo } from "react";
import "./modal.css";

const Modal = ({ open, onClose, children, title }) => {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
        document.body.style.overflow = "hidden";
      }
    } else {
      if (dialog.open) {
        dialog.close();
        document.body.style.overflow = "";
      }
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="modal-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="modal">
        {title && <h2>{title}</h2>}
        <div className="modal-content">{children}</div>
      </div>
    </dialog>
  );
};

export default memo(Modal);
