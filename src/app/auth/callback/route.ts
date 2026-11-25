import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/";
  // only allow same-site relative redirects
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=callback`);
  }
  // no code: an implicit-flow link (invitations) carries the session in the URL
  // fragment, which the browser keeps across this redirect; the page reads it
  const locale = /^\/(fa|en|ar)\//.exec(next)?.[1] ?? "fa";
  return NextResponse.redirect(`${origin}/${locale}/signin-link?next=${encodeURIComponent(next)}`);
}
