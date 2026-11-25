"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, isLocale } from "@/i18n";

export default function NotFound() {
  const params = useParams<{ locale?: string }>();
  const raw = params?.locale;
  const locale = isLocale(raw) ? raw : "fa";
  const t = getDictionary(locale);
  return (
    <div className="card mx-auto max-w-md space-y-3 text-center">
      <h1 className="text-xl font-bold">{t.notFound.title}</h1>
      <p className="text-sm text-muted">{t.notFound.body}</p>
      <Link href={`/${locale}`} className="btn">{t.notFound.back}</Link>
    </div>
  );
}
