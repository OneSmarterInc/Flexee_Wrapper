import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { handleLaunch, signDeepLinkState } from "@/lib/lti";
export async function POST(req: Request) {
  const form = await req.formData();
  const idToken = String(form.get("id_token") || "");
  const state = String(form.get("state") || "");
  const cookieState = (await cookies()).get("lti_state")?.value;
  let target: string;
  try {
    const r = await handleLaunch(idToken, state, cookieState);
    if (r.kind === "deeplink") {
      const dl = await signDeepLinkState({ returnUrl: r.returnUrl, data: r.data, iss: r.iss, clientId: r.clientId, deploymentId: r.deploymentId });
      (await cookies()).set("lti_dl", dl, { httpOnly: true, sameSite: "none", secure: true, path: "/", maxAge: 900 });
      target = "/lti/select";
    } else {
      target = r.redirect;
    }
  } catch (e: any) {
    return new Response(`LTI launch rejected: ${e.message}`, { status: 400, headers: { "content-type": "text/plain" } });
  }
  redirect(target);
}
