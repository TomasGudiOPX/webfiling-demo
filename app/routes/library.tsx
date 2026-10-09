export { loader, action } from "../.server/library-route.server";
import { useLocation, useLoaderData } from "react-router";
import FileLibrary from "../components/file-library";
import ProjectShowcase from "../components/project-showcase";
import AgentSections from "../components/agent-sections";
import DummyCalendar from "../components/dummy-calendar";
import type { browserModel } from "../.server/file-browser.server";

export default function FileEntry() {
  const model = useLoaderData<Awaited<ReturnType<typeof browserModel>>>();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const browserKeys = ["browse", "view", "collection", "folder", "searchScope", "q", "category", "discipline", "location", "type", "timeframe", "sort", "selected", "trash", "project", "status", "at"];
  const browse = browserKeys.some((key) => params.has(key));
  const panel = params.get("panel");
  const section = panel === "agent" ? "agent" : null;
  const legacyRulesDenied = panel === "rules" && model.profile !== "system-administrator";
  const settingsDenied = params.has("settingsDenied");
  return (
    <>
      {browse ? <><FileLibrary />{/* Original live calendar: <CollectionCalendar collections={model.collections} /> */}<DummyCalendar /></> : <ProjectShowcase />}
      {legacyRulesDenied && <p className="agent-note" role="status">La configuración del calendario está disponible solo para Administrador del sistema, en Configuración → Calendario.</p>}
      {settingsDenied && <p className="agent-note" role="status">La configuración del calendario está disponible solo para Administrador del sistema.</p>}
      <AgentSections active={section} />
    </>
  );
}
