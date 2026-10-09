import { Link } from "react-router";
import type { DemoProfileId } from "../types";

export const profileLabels = {
  employee: "Empleado",
  manager: "Gerencia",
  "administration-staff": "Administración",
  "system-administrator": "Administrador del sistema",
};

export function ShowcaseHeader({
  profile,
  workspace = false,
}: {
  profile: DemoProfileId;
  workspace?: boolean;
}) {
  return (
    <header className="topbar showcase-topbar">
      <div className="brand-group">
        <Link className="brand" to="/file">
          webfiling<span className="brand-dot">·</span>
        </Link>
        <span className="badge-tag">ARCHIVO DOCUMENTAL</span>
      </div>
      <div className="topbar-actions">
        {workspace && (
          <Link className="back-link" to="/file">
            ← Volver a proyectos
          </Link>
        )}
        <form
          method="post"
          action="/api/demo-profile"
          className="showcase-profile"
        >
          <label>
            Perfil simulado
            <select
              name="profileId"
              aria-label="Perfil simulado"
              value={profile}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              {Object.entries(profileLabels).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <noscript>
            <button>Cambiar perfil</button>
          </noscript>
        </form>
      </div>
    </header>
  );
}
