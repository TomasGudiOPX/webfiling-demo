# Webfiling Demo

Independent React Router Framework Mode application for a read-only construction-document pilot. User-facing copy is Spanish; API paths, fields, statuses, and code names are English.

## Fixture mode

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Open <http://localhost:3000/file>. The catalog contains three deterministic stories:

- `costa-norte`: search `plano vigente` to compare the approved Rev C plan with its superseded predecessor.
- `parque-industrial`: inspect missing metadata, the possible duplicate, and the relation awaiting confirmation.
- `torre-del-parque`: inspect PDF/Markdown/DOCX preview states, then create a simulated intake and confirm it into `Pending review`.

Use the selector inside any workspace to switch projects, or choose `Todos los escenarios` in search to show cross-project results. The `Resetear datos de demo` action restores all demo-owned records, findings, reviews, and simulated uploads without restarting the server or touching source fixture files. The API exposes `/api/health`, `/api/projects`, `/api/projects/:projectId/files`, `/api/files/:fileId`, `/api/search`, and `POST /api/files/:fileId/review`.

## Governed review demo

Open `/file/review` to work through the cross-project review inbox. The selector identifies a **simulated** document controller, technical lead, site manager, or project manager; it is not authentication or production authorization. A reviewer can assign an item, adjust urgency, inspect source and relation evidence, and record an approval, return, finding resolution, dismissal, or escalation. These actions write Webfiling metadata and append-only decision events only—never the original source-share file.

The `Mi cola`, `Sin asignar`, `Vencidos`, and `Completados` views demonstrate ownership and due-state handling. Resetting demo data restores the deterministic inbox and its fixture history.

## Docker

```powershell
docker compose up --build
```

SQLite metadata and audit events persist in the named `webfiling-data` volume. `web` and `indexer` use the same image; the source mount is read-only. Set `SOURCE_ROOT_HOST` to a host directory only after confirming Docker Desktop can read the Windows/SMB mapping. UNC/SMB paths may need to be mapped on the Windows host first; the browser can never choose a source path.

## Pilot handoff

- Deployment: a controlled Docker host on the office network; keep web and indexer private behind the chosen gateway.
- Backup: stop writes or copy the `webfiling-data` volume/database on a schedule and test restore before the pilot.
- Service account: grant the host/indexer read-only access to the source share; never grant the container write access.
- Configuration: set `SOURCE_ROOT_HOST`, a persistent `DATABASE_PATH` volume, `SESSION_SECRET`, and the desired port.
- Limitations: metadata-only indexing, simulated fixture identities, one SQLite writer, and no production authentication/OCR/content extraction. Decision events are an application audit trail, not an access-control system. PDF/Markdown/DOCX previews are descriptors or fixture representations; DOCX is not converted. Upload is simulated metadata-only intake and never writes to the mounted source.
- Rollback: stop/remove the Compose services while preserving `webfiling-data`; the original source share is never changed.

## Checks

```powershell
npm run typecheck
npm run test:indexer
npm run test:e2e
npm run build
docker compose config
```
