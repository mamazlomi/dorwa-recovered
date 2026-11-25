"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LOCALES, LOCALE_CODES, type Locale } from "@/i18n/config";

export function LanguageSwitcher({ current, label }: { current: Locale; label: string }) {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString();
  const rest = pathname.split("/").slice(2).join("/");
  return (
    <div className="flex items-center gap-1 text-xs" aria-label={label}>
      {LOCALE_CODES.map((code) => (
        <Link
          key={code}
          href={`/${code}${rest ? `/${rest}` : ""}${search ? `?${search}` : ""}`}
          hrefLang={code}
          lang={code}
          aria-current={code === current ? "true" : undefined}
          className={`rounded-md px-2 py-1 ${code === current ? "bg-brand-600 text-white" : "hover:bg-brand-50"}`}
        >
          {LOCALES[code].label}
        </Link>
      ))}
    </div>
  );
}
