import "./Switch.css";

export function Switch({
  checked,
  onChange,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  "aria-label"?: string;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="slider round"></span>
    </label>
  );
}
