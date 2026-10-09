# Webfiling Demo

A Spanish-language file library for collecting, finding, organizing, and linking files. It is **not a business approval or task-management system**. Existing source-share files remain read-only; actual uploads are stored separately.

## Run locally

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Open <http://localhost:3000/file>. The application initializes/migrates SQLite and sample collections automatically. Keep this demo on a controlled network.

## File library

- **Lista**, **Cuadrícula**, and **Carpetas** share matching file IDs, filters, sorting, selection, and permitted actions. Grid uses format icons; generated PDF thumbnails are not included.
- Categories, discipline/location tags, collections, projects, and physical/logical folders are separate concepts.
- A file belongs to exactly one collection and can link to zero or more projects. Links reuse the same bytes and never grant access to the owning collection.
- Details contain protected previews/download, recorded versions, related files, and actual file activity. A unique endpoint of an explicit version chain can be the latest recorded version regardless of legacy approval state. Branching/cyclic/incomplete visible chains make no global-latest claim.
- Missing previews are format limitations, not approval states. Unavailable bytes are reported explicitly.
- Server locations come from paths relative to the configured source root. Managed folder placement changes metadata only; opaque objects stay in the private store. Fixtures are clearly labeled examples.
- Original filenames/document contents are preserved, including business words that occur in those originals.

### Demo profiles

The selector is **simulated identity, not production authentication**. A signed HttpOnly SameSite cookie establishes the profile; the server enforces its grants for queries, details, counts, relationships, preview/download, and mutations. Body/query actor fields cannot override identity. Native full-page profile switching clears loader/selection state; preview fetches abort or discard late responses. Protected responses use private, no-store caching.

| Profile | Shared resources | Costa Norte | Parque Industrial | Other projects | Administration |
| --- | --- | --- | --- | --- | --- |
| Employee | Read | Contribute | None | None | None |
| Manager | Read | Organize | Organize | Read | None |
| Administration staff | Contribute | None | None | None | Organize |
| System administrator | Organize | Organize | Organize | Organize | Organize |

Contribute includes upload and organizing/trashing/restoring one's own managed files while the grant remains active. Organize adds metadata actions on other visible files and folder creation. No profile can rename/move/delete source originals. Administration staff is not a system administrator. Only the system administrator can reset examples. Outside DEMO_MODE, these surfaces fail closed; a production authentication integration is not included.

### Walkthrough

1. As Employee, browse Costa Norte and shared resources; open Rev C and its explicit predecessor, Rev B. Switch views without losing selection.
2. Search by filename/content; narrow with category/tags/type/date and sort. Open folders to navigate the actual indexed or managed hierarchy.
3. Upload a Markdown or PDF into Costa Norte. Confirm the preview and download contain the submitted bytes.
4. Organize your own upload, optionally linking accessible projects. Rename or place it in an existing managed folder; inspect the corresponding file events.
5. Switch to Manager: the same Costa Norte files are visible, but other people's files can now be organized and folders created. Parque Industrial becomes accessible.
6. Switch to Administration: only shared resources and the administrative collection appear. Previously selected project content is cleared.
7. Trash a permitted managed upload, then restore it from Papelera. Content endpoints do not serve it while trashed.
8. As System administrator, reset examples. Actual uploaded content, metadata/events, and required collections/folders/project links remain intact.

### URLs and search

`/file` is the accessible library; `/file/:projectSlug` selects linked project files. Restorable parameters: `view=list|grid|folders`, `collection`, `folder`, `searchScope=folder|all`, `q`, `category`, `discipline`, `location`, `type`, `timeframe`, `sort`, and `selected`. The legacy `evidence` alias still selects the exact file. `trash=1` lists restorable managed uploads only.

Folder navigation with no search shows immediate files and navigable children. Query/metadata-filter search includes descendants. Ancestor folders support navigation and are not counted as matching files. Folder restrictions apply in every view. “Buscar en todos” explicitly clears project/collection/folder restrictions while retaining text/metadata filters. Empty states explain the active restrictions and offer recovery. Unknown or unauthorized folders/files return the same safe 404; invalid view names recover to list. Refresh/Back preserve context subject to current grants.

Legacy `status`/`at` browser URLs show a retirement notice, not a reinterpretation of approval as availability. Search API requests with those filters return 410.

## Storage, validation, and recovery

`SOURCE_ROOT` is read-only. `MANAGED_STORAGE_ROOT` defaults to `data/managed-files`; it must not overlap source, public, or packaged private-fixture roots. Real-path checks prevent source/managed symlink escapes. The indexer does not ingest managed storage.

Actual uploads accept one PDF, DOCX, MD, TXT, PNG, JPEG, or WebP per request: **20 MiB per file, 21 MiB total request**, enforced on streamed bytes before multipart decoding even when Content-Length is absent or false. Empty/unsafe names, unsupported signatures, malformed multipart, and malformed/overexpanded DOCX archives are rejected. Content type comes from validated format, not a browser MIME assertion. DOCX expansion is bounded and external XML entities/macros are rejected. This is validation, **not malware scanning**; full document editing, SVG/HTML upload rendering, and content-based deduplication are excluded.

Uploads use private staging, exclusive opaque UUID object keys, and one metadata/project-link/activity transaction after byte finalization. Failed writes/transactions remove their own staged/new object. Duplicate names create separate identities and a duplicate-name notice; they never overwrite or infer versions. Renames/folder moves keep identity and bytes. Cross-collection moves, folder deletion, bulk actions, and permanent-delete UI are excluded.

Trash is recoverable metadata: normal browsing/content excludes it; authorized restoration preserves identity/bytes and returns to collection root if the original folder no longer exists. Sample ownership is separate from demo ownership: resets target samples, not actual uploads or non-demo indexed content.

`npm run storage:cleanup` is an explicit maintenance command. It examines at most 500 entries per run, does not recurse, accepts only opaque object/staging names, and removes unreferenced files older than 24 hours. All database references—including trash—are retained. Run again for larger stores. Stop writers before backup/restore; do not run cleanup against an unrelated database/store pairing.

Fixture PDFs/images live in `private-fixtures/`, not public assets. Markdown/DOCX examples are served from the registered private fixture definitions through authorized endpoints. The old public fixture URLs no longer expose documents. Vite development raw-file access to source/private/storage/database paths is also denied.

## Model and migration

Origins: `source` (indexed original), `fixture` (private example), `managed_upload` (persisted upload), `legacy_simulated` (older metadata-only intake, unavailable bytes).

The library schema adds collections, fixed profile grants, file-project links, managed folders, library metadata and file events. Legacy `files.project_id` is nullable and retained as an optional primary link; `file_projects` is authoritative. Migration preserves file IDs, source paths, category/tags, explicit relations, legacy records, indexes, and foreign-key integrity. Initialization/backfill is idempotent. Legacy approvals remain internal and are never converted into file events.

Before upgrading:

1. Stop web/indexer writers.
2. Back up SQLite and the complete managed-object directory **together**. When copying SQLite files, include any WAL state or use a proper SQLite backup/checkpoint; do not copy a live main file alone.
3. Start the new app or run `npm run seed`; verify `PRAGMA foreign_key_check` and test visible files, uploads and denied URLs on a restored copy.
4. Keep the paired backup until acceptance. Reverting to the old mandatory-project schema requires that compatible DB and object snapshot; preserve/export post-migration uploads rather than deleting them to force compatibility.

## API and retired contracts

Current endpoints: `/api/health`, `/api/projects`, `/api/projects/:projectId/files`, `/api/search`, `/api/files/:fileId`, `/preview`, `/download`, `/activity`, `POST /api/files/upload`, and demo-only `POST /api/demo-profile`. Browser forms perform authorized organization/folder/trash/restore actions. Public DTOs omit approval fields and private object keys. Restricted and unknown targets both produce 404; readable targets with disallowed actions produce 403.

`/file/review` recovers to the library. Former review APIs, file-review mutations and project as-of reconstruction return structured **410 feature_retired**, without executing legacy business workflows. Older workspace POST intents likewise cannot invoke approval functions.

This change supersedes the business-process portions of unarchived `document-file-workspace`, demo scenario/navigation, `governed-document-review`, `document-decision-audit`, `document-as-of-reconstruction`, and `demo-discovery-layout` contracts. Categories/tags, explicit versions, previews, provenance, and source-read-only behavior remain. Earlier OpenSpec artifacts are not edited or archived by this implementation; later reconciliation must retain the corrected file-only scope.

## Docker

```powershell
docker compose up --build
```

SQLite persists in `webfiling-data`; uploads persist in the separate `webfiling-managed-files` volume. Back up/restore both. The source mount stays read-only. Set `SOURCE_ROOT_HOST` only after confirming Docker Desktop can read the Windows/SMB mapping. Browser input never selects a physical source path.

Use a controlled office-network host with read-only source credentials. There is no production SSO, permission editor, Windows ACL sync, OCR, offline synchronization, malware scanning, or public-sharing feature. Already downloaded bytes cannot be revoked.

## Verification

```powershell
npm run typecheck
npm run lint
npm run test:indexer
npx playwright install chromium
npm run test:e2e
npm run build
docker compose config
```

E2E starts an isolated server on port 3107 with metadata/content under ignored `.test-data/`; it does not reuse the user's running demo or database. Browser assertions cover all four profiles in all three views at 1440×900 and 390px, real uploads and management, protected previews, profile cache clearing, URL restoration and keyboard navigation. Screenshots/traces are written under `test-results/`. A missing browser is an outstanding failure, never a passed acceptance check.

If Chromium cannot be downloaded but Chrome is installed, use its isolated Playwright channel (no personal browser profile is used):

```powershell
$env:PLAYWRIGHT_CHANNEL = "chrome"
npm run test:e2e
```
