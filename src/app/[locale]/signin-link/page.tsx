"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Landing page for sign-in links sent by Dorva (staff invitations). Supabase
// puts the session in the URL fragment (implicit flow), which only the browser
// can read; any device works, unlike the PKCE code flow.
export default function SignInLinkPage() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const n = query.get("next") ?? "/";
    const next = n.startsWith("/") && !n.startsWith("//") ? n : "/";
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    if (!access_token || !refresh_token) {
      // a code (PKCE) or token_hash link: hand it to the server routes
      const code = query.get("code");
      const tokenHash = query.get("token_hash");
      if (code) window.location.replace(`/auth/callback?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`);
      else if (tokenHash) window.location.replace(`/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${query.get("type") ?? "email"}&next=${encodeURIComponent(next)}`);
      else setFailed(true);
      return;
    }
    createClient().auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) setFailed(true);
      else window.location.replace(next);
    });
  }, []);
  return (
    <div className="card mx-auto max-w-md text-center text-sm">
      {failed ? "لینک ورود نامعتبر یا منقضی است. از صفحه ورود دوباره تلاش کنید. / The sign-in link is invalid or expired." : "…"}
    </div>
  );
}
