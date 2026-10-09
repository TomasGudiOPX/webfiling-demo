import { redirect, type ActionFunctionArgs } from "react-router";
import {
  ProfileContextError,
  switchDemoProfile,
} from "../.server/profile-session.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { profileId, setCookie } = await switchDemoProfile(request);
    if (request.headers.get("Accept")?.includes("text/html"))
      return redirect("/file", {status:303, headers:{"Set-Cookie":setCookie,"Cache-Control":"private, no-store"}});
    return Response.json(
      { profileId },
      { headers: { "Set-Cookie": setCookie, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ProfileContextError)
      return Response.json(
        { error: { code: "invalid_profile_context", message: error.message } },
        { status: error.status },
      );
    throw error;
  }
}
