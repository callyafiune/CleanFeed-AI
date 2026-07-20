import type { PropsWithChildren } from "react";

export function Fieldset({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  return (
    <fieldset className="fieldset">
      <legend className="fieldset-title">{title}</legend>
      {children}
    </fieldset>
  );
}
