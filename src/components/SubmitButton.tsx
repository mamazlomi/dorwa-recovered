"use client";

import { useFormStatus } from "react-dom";

// A submit button that disables itself while its form is being processed,
// so an impatient double click cannot submit twice.
export function SubmitButton({ children, pendingLabel, className, ariaLabel, name, value }: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  ariaLabel?: string;
  /** sent with the form when this button submits it */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} className={className} disabled={pending} aria-label={ariaLabel} aria-busy={pending}
      style={pending ? { opacity: 0.6, cursor: "wait" } : undefined}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
