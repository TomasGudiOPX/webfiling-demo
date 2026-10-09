export { loader, action } from "../.server/library-route.server";
import { useLocation, useLoaderData } from "react-router";
import FileLibrary from "../components/file-library";
import ProjectShowcase from "../components/project-showcase";
import AgentSections from "../components/agent-sections";
import CollectionCalendar from "../components/collection-calendar";
import type { browserModel } from "../.server/file-browser.server";

export default function FileEntry() {
  const model = useLoaderData<Awaited<ReturnType<typeof browserModel>>>();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const browserKeys = ["browse", "view", "collection", "folder", "searchScope", "q", "category", "discipline", "location", "type", "timeframe", "sort", "selected", "trash", "project", "status", "at"];
  const browse = browserKeys.some((key) => params.has(key));
  const panel = params.get("panel");
  const section = panel === "agent" ? "agent" : panel === "rules" && model.profile === "system-administrator" ? "rules" : null;
  const legacyRulesDenied = panel === "rules" && model.profile !== "system-administrator";
  return (
    <>
      {browse ? <><FileLibrary /><CollectionCalendar collections={model.collections} /></> : <ProjectShowcase />}
      {legacyRulesDenied && <p className="agent-note" role="status">La configuración del calendario está disponible solo para Administrador del sistema, en Configuración → Calendario.</p>}
      <AgentSections active={section} />
    </>
  );
}
