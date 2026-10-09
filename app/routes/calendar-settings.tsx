import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import AgentSections from "../components/agent-sections";
import { ShowcaseHeader } from "../components/showcase-header";
import { browserModel } from "../.server/file-browser.server";
import { privateHeaders } from "../.server/file-content.server";
import { resolveDemoProfile } from "../.server/profile-session.server";
import "../styles/showcase.css";

export async function loader({ request }: LoaderFunctionArgs) {
  const profile = resolveDemoProfile(request);
  if (profile !== "system-administrator") {
    throw redirect("/file?settingsDenied=1", { headers: privateHeaders });
  }
  return Response.json(await browserModel(profile, new URL("/file", request.url)), {
    headers: privateHeaders,
  });
}

export default function CalendarSettings() {
  const model = useLoaderData<Awaited<ReturnType<typeof browserModel>>>();
  return (
    <main className="shell calendar-settings-shell">
      <ShowcaseHeader profile={model.profile} settingsPage />
      <AgentSections active="settings" />
    </main>
  );
}
