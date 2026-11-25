import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Opens a resume from the private bucket with a one-minute link. The storage
// policy decides: the pharmacy's profile editors and Dorva staff only.
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!/^[0-9a-f-]{36}\/resume-[a-z0-9]{8,40}\.(pdf|docx)$/.test(path)) {
    return new NextResponse("not found", { status: 404 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("officer-docs").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return new NextResponse("not allowed", { status: 403 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
