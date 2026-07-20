import type { PropsWithChildren, ReactNode } from "react";

export function Field({
  label,
  description,
  children,
}: PropsWithChildren<{ label: string; description?: ReactNode }>) {
  return (
    <div className="field">
      <div>
        <label className="field-label">{label}</label>
        {description && <p className="field-description">{description}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}
