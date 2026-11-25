"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// "Deliver to: Home" in the header (like Snapp); opens the address page and
// comes back to the page the customer was on.
export function DeliverTo({ locale, label, title, guest = false }: { locale: string; label: string; title: string; guest?: boolean }) {
  const path = usePathname();
  const sp = useSearchParams();
  const here = `${path}${sp.size ? `?${sp.toString()}` : ""}`;
  const onAddressPage = path.startsWith(`/${locale}/account/address`);
  const addressPage = `/${locale}/account/address?back=${encodeURIComponent(here)}`;
  // guests choose an address only after signing in
  const href = onAddressPage ? path : guest ? `/${locale}/login?next=${encodeURIComponent(addressPage)}` : addressPage;
  return (
    <Link href={href} title={title}
      className="flex max-w-56 items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-sm hover:border-brand-500">
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-brand-700" fill="currentColor">
        <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
      </svg>
      <span className="truncate">
        <span className="text-xs text-muted">{title}: </span>
        <span className="font-semibold">{label}</span>
      </span>
    </Link>
  );
}
