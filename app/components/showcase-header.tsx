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
  settingsPage = false,
}: {
  profile: DemoProfileId;
  workspace?: boolean;
  settingsPage?: boolean;
}) {
  return (
    <header className="topbar showcase-topbar">
      <div className="brand-group">
        <Link className="brand" to="/file">
          webfiling<span className="brand-dot">·</span>
        </Link>
        <span className="badge-tag">ARCHIVO DOCUMENTAL</span>
        <span className="demo-badge" title="Entorno de demostración, no producción">
          DEMO <span>· SOLO DEMOSTRACIÓN</span>
        </span>
      </div>
      <div className="topbar-actions">
        {workspace && <nav className="showcase-nav-actions" aria-label="Navegación principal"><Link className="back-link" to="/file">← Volver a proyectos</Link></nav>}
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
        {profile === "system-administrator" && !settingsPage && (
          <Link className="settings-nav-link" to="/settings/calendar" aria-label="Configuración del calendario" title="Configuración del calendario">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
            </svg>
          </Link>
        )}
      </div>
    </header>
  );
}
