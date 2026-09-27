import { cookies } from "next/headers";
import { verifyDeepLinkState, buildDeepLinkResponse } from "@/lib/lti";
import { getBook } from "@/lib/content";
export async function POST(req: Request) {
  const form = await req.formData();
  const bookId = String(form.get("book") || "");
  const dl = (await cookies()).get("lti_dl")?.value;
  if (!dl) return new Response("Missing deep-link context", { status: 400 });
  let ctx; try { ctx = await verifyDeepLinkState(dl); } catch { return new Response("Invalid deep-link context", { status: 400 }); }
  let title = bookId; try { title = (await getBook(bookId)).title; } catch {}
  const jwt = await buildDeepLinkResponse(ctx, bookId, title, new URL(req.url).origin);
  // auto-submit the signed response back to the LMS return URL
  const html = `<!doctype html><html><body onload="document.forms[0].submit()">
    <form action="${ctx.returnUrl}" method="post"><input type="hidden" name="JWT" value="${jwt}"/>
    <noscript><button type="submit">Return to your LMS</button></noscript></form></body></html>`;
  (await cookies()).delete("lti_dl");
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
