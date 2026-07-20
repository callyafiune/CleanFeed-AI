import "./Select.css";

import type { PropsWithChildren } from "react";

export function Select({
  value,
  onChange,
  "aria-label": ariaLabel,
  children,
}: PropsWithChildren<{
  value: string | number;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  "aria-label"?: string;
}>) {
  return (
    <div className="select-wrapper">
      <select
        className="select"
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
      >
        {children}
      </select>
    </div>
  );
}
