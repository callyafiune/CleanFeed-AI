import { useEffect, useId, useRef, type ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** A fixed backdrop that covers the viewport so background content is not clickable. */
const OVERLAY_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0, 0, 0, 0.45)",
  zIndex: 2_147_483_000,
};

const PANEL_STYLE: React.CSSProperties = {
  background: "Canvas",
  color: "CanvasText",
  width: "min(92vw, 32rem)",
  padding: "1rem 1.25rem",
  borderRadius: "0.5rem",
  boxShadow: "0 8px 30px rgba(0, 0, 0, 0.3)",
};

/**
 * A modal confirmation used for every action that must not happen implicitly
 * (enabling full-text history, clearing history, applying an import). It is a
 * real `role="dialog"` with `aria-modal`: focus moves to the confirm control on
 * open, Escape cancels, Tab is trapped inside the dialog, and focus returns to
 * the element that opened it on close. A fixed backdrop covers the viewport so
 * background controls cannot be clicked while it is open (a backdrop click
 * cancels, matching Escape).
 */
export function ConfirmDialog({
  title,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const headingId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((element) => !element.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="cleanfeed-dialog-overlay"
      style={OVERLAY_STYLE}
      onClick={(event) => {
        // Only a click on the backdrop itself (not a bubbled click from a
        // control inside the dialog) cancels.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        aria-describedby={children === undefined ? undefined : descriptionId}
        aria-labelledby={headingId}
        aria-modal="true"
        className="cleanfeed-dialog"
        ref={dialogRef}
        role="dialog"
        style={PANEL_STYLE}
        onKeyDown={onKeyDown}
      >
        <h3 id={headingId}>{title}</h3>
        {children === undefined ? null : (
          <div id={descriptionId}>{children}</div>
        )}
        <button ref={confirmRef} type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
