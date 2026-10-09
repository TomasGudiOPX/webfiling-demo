export { loader, action } from "../.server/library-route.server";
import { useLocation, useLoaderData } from "react-router";
import AgentSections from "../components/agent-sections";
import FileLibrary from "../components/file-library";
import type { browserModel } from "../.server/file-browser.server";

export default function ProjectFileEntry() {
  const model = useLoaderData<Awaited<ReturnType<typeof browserModel>>>();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const panel = params.get("panel");
  const section = panel === "agent" ? "agent" : null;
  const legacyRulesDenied = panel === "rules" && model.profile !== "system-administrator";
  const settingsDenied = params.has("settingsDenied");
  return <><FileLibrary />{/* Original live calendar: <CollectionCalendar collections={model.collections.filter((collection) => collection.projectId === model.project?.id)} /> */}{(legacyRulesDenied || settingsDenied) && <p className="agent-note" role="status">La configuración del calendario está disponible solo para Administrador del sistema.</p>}<AgentSections active={section} /></>;
}
