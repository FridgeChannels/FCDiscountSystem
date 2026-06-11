export default function ModalShell({ open, title, onClose, children }) {
  if (!open) return null;

  return (
    <div className="modal-overlay open">
      <div className="modal-card platform-game-modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
