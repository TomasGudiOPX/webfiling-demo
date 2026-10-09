# Webfiling Demo

A Spanish-language file library for collecting, finding, organizing, and linking files. It is **not a business approval or task-management system**. Existing source-share files remain read-only; actual uploads are stored separately.

## Run locally

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Open <http://localhost:3000/file> for the project showcase. Project cards open the document workspace; **Todos los archivos** opens the cross-project browser. The application initializes/migrates SQLite and sample collections automatically. Keep this demo on a controlled network.

Use either the development server or Docker on port 3000. If both are running, localhost/IPv6 and 127.0.0.1 may reach different instances. After source edits, Docker requires `docker compose up -d --build web`; do not delete its data volumes. `node scripts/verify-showcase.mjs` checks both local addresses using isolated Chrome and saves screenshots under `.test-data/`.

## File library

- **Lista**, **Cuadrícula**, and **Carpetas** share matching file IDs, filters, sorting, selection, and permitted actions. Grid uses format icons; generated PDF thumbnails are not included.
- Categories, discipline/location tags, collections, projects, and physical/logical folders are separate concepts.
- A file belongs to exactly one collection and can link to zero or more projects. Links reuse the same bytes and never grant access to the owning collection.
- Details contain protected previews/download, recorded versions, related files, and actual file activity. A unique endpoint of an explicit version chain can be the latest recorded version regardless of legacy approval state. Branching/cyclic/incomplete visible chains make no global-latest claim.
- Missing previews are format limitations, not approval states. Unavailable bytes are reported explicitly.
- Server locations come from paths relative to the configured source root. Managed folder placement changes metadata only; opaque objects stay in the private store. Fixtures are clearly labeled examples.
- Original filenames/document contents are preserved, including business words that occur in those originals.
- The relationship map adapts the two-hemisphere brain geometry from `openix-landing`. Orange hubs open authorized files; highlighted connections represent recorded relationships. The faint background mesh is explicitly illustrative, never inferred file links. Animation can be paused and respects reduced-motion preferences; the file links also work by keyboard.

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

`/file` is the permission-filtered project showcase; `/file?browse=1` opens all accessible files, and `/file/:projectSlug` opens the original-style project workspace. Existing query/selection links still open the file browser directly. Restorable parameters: `view=list|grid|folders`, `collection`, `folder`, `searchScope=folder|all`, `q`, `category`, `discipline`, `location`, `type`, `timeframe`, `sort`, and `selected`. The legacy `evidence` alias still selects the exact file. `trash=1` lists restorable managed uploads only. The relationship map uses the same authorized result set; selecting a node preserves the current search and presentation.

Folder navigation with no search shows immediate files and navigable children. Query/metadata-filter search includes descendants. Ancestor folders support navigation and are not counted as matching files. Folder restrictions apply in every view. “Buscar en todos” explicitly clears project/collection/folder restrictions while retaining text/metadata filters. Empty states explain the active restrictions and offer recovery. Unknown or unauthorized folders/files return the same safe 404; invalid view names recover to list. Refresh/Back preserve context subject to current grants.

Legacy `status`/`at` browser URLs show a retirement notice, not a reinterpretation of approval as availability. Search API requests with those filters return 410.

## Storage, validation, and recovery

Advanced recurring schedules use pinned `cron-parser` 5.10.1 behind the application adapter. Accepted syntax is five numeric fields (`minute hour day-of-month month day-of-week`), with either day-of-month or day-of-week set to `*`; lists, ranges, and steps are supported. Names, macros, seconds, environment assignments, commands, and expressions more frequent than every 15 minutes are rejected. Schedules require an IANA timezone; the default is `America/Argentina/Buenos_Aires`. This installs application jobs only and never writes host crontab entries.

`SOURCE_ROOT` is read-only. `MANAGED_STORAGE_ROOT` defaults to `data/managed-files`; it must not overlap source, public, or packaged private-fixture roots. Real-path checks prevent source/managed symlink escapes. The indexer does not ingest managed storage.

Actual uploads accept one PDF, DOCX, MD, TXT, PNG, JPEG, or WebP per request: **20 MiB per file, 21 MiB total request**, enforced on streamed bytes before multipart decoding even when Content-Length is absent or false. Empty/unsafe names, unsupported signatures, malformed multipart, and malformed/overexpanded DOCX archives are rejected. Content type comes from validated format, not a browser MIME assertion. DOCX expansion is bounded and external XML entities/macros are rejected. This is validation, **not malware scanning**; full document editing, SVG/HTML upload rendering, and content-based deduplication are excluded.

Uploads use private staging, exclusive opaque UUID object keys, and one metadata/project-link/activity transaction after byte finalization. Failed writes/transactions remove their own staged/new object. Duplicate names create separate identities and a duplicate-name notice; they never overwrite or infer versions. Renames/folder moves keep identity and bytes. Cross-collection moves, folder deletion, bulk actions, and permanent-delete UI are excluded.

Trash is recoverable metadata: normal browsing/content excludes it; authorized restoration preserves identity/bytes and returns to collection root if the original folder no longer exists. Sample ownership is separate from demo ownership: resets target samples, not actual uploads or non-demo indexed content.

`npm run storage:cleanup` is an explicit maintenance command. It examines at most 500 entries per run, does not recurse, accepts only opaque object/staging names, and removes unreferenced files older than 24 hours. All database references—including trash—are retained. Run again for larger stores. Stop writers before backup/restore; do not run cleanup against an unrelated database/store pairing.

Fixture PDFs/images live in `private-fixtures/`, not public assets. Markdown/DOCX examples are served from the registered private fixture definitions through authorized endpoints. The old public fixture URLs no longer expose documents. Vite development raw-file access to source/private/storage/database paths is also denied.

## Model and migration

Origins: `source` (indexed original), `fixture` (private example), `managed_upload` (persisted upload), `legacy_simulated` (older metadata-only intake, unavailable bytes).

The library schema adds collections, fixed profile grants, file-project links, managed folders, library metadata and file events. Legacy `files.project_id` is nullable and retained as an optional primary link; `file_projects` is authoritative. Migration preserves file IDs, source paths, category/tags, explicit relations, legacy records, indexes, and foreign-key integrity. Initialization/backfill is idempotent. Legacy approvals remain internal and are never converted into file events.

The demo-agent schema is additive: `agent_plans`, `agent_runs`, `agent_steps`, `agent_upload_operations`, and `agent_summaries` hold profile-private plans and execution history; collection rules have immutable versions, periods, evidence, and transition events; schedules, scheduled runs, in-app notices, and worker heartbeats support background evaluation. New rows reference the existing four profile IDs (`employee`, `manager`, `administration-staff`, `system-administrator`); this selector remains simulated identity, not user provisioning. Existing files, grants, upload bytes, and activity are not rewritten. Resetting examples removes sample fixtures only and preserves user-created plans, rules, periods, evidence, run history, and actual managed uploads.

Before a schema or worker upgrade, stop web, indexer, and agent-worker writers. Back up the SQLite database and the complete managed-object directory as one paired snapshot; use SQLite's backup API or checkpoint/copy the WAL state with the database. Restore both together to the same recovery point. Rollback stops the agent worker and removes the new application code while retaining additive tables; restore the paired backup only when returning to the previous schema, since restoring the database alone can orphan or lose uploaded bytes. Do not delete Docker volumes as a rollback method.

Before upgrading:

1. Stop web/indexer writers.
2. Back up SQLite and the complete managed-object directory **together**. When copying SQLite files, include any WAL state or use a proper SQLite backup/checkpoint; do not copy a live main file alone.
3. Start the new app or run `npm run seed`; verify `PRAGMA foreign_key_check` and test visible files, uploads and denied URLs on a restored copy.
4. Keep the paired backup until acceptance. Reverting to the old mandatory-project schema requires that compatible DB and object snapshot; preserve/export post-migration uploads rather than deleting them to force compatibility.

## API and retired contracts

Current endpoints: `/api/health`, `/api/projects`, `/api/projects/:projectId/files`, `/api/search`, `/api/files/:fileId`, `/preview`, `/download`, `/activity`, `POST /api/files/upload`, demo-only `POST /api/demo-profile`, and the demo schedule API below. Browser forms perform authorized organization/folder/trash/restore actions. Public DTOs omit approval fields and private object keys. Restricted and unknown targets both produce 404; readable targets with disallowed actions produce 403.

### Agent schedule API

- `GET /api/agent/schedules` lists only schedules the current profile can manage; `POST` creates one. The JSON body uses `actionType` (`collection_check` or `collection_summary`), `collectionId`, `scheduleKind` (`once` or `recurring`), and `timezone`. One-off bodies add a future ISO `runAt`; recurring bodies add the validated five-field `cronExpression`.
- `GET /api/agent/schedules/:id` reads a schedule. `PATCH` replaces its configuration and requires its current integer `version`. `DELETE` archives it and also requires `version`; history is retained.
- `POST /api/agent/schedules/:id/control` accepts `{ "intent": "pause"|"resume", "version": n }` or `{ "intent": "run_now", "version": n, "requestId": "..." }`. Run-now is deduplicated by request ID and leaves `nextRunAt` unchanged.
- All mutations require a same-origin request and derive the actor from the signed demo-profile cookie; body actor fields are rejected. A stale version returns 409, an unreadable or restricted target returns 404, and a readable scope without mutation rights returns 403. Responses are private and no-store.

Agent plans are created with same-origin `POST /api/agent/plans` using `{ providerVersion, intent, operation, reason }`; operation fields are strictly allowlisted and the server binds the plan to the current profile, authorized targets, and a 15-minute target fingerprint. `POST /api/agent/plans/:planId/apply` is the explicit confirmation step. It refreshes permissions and fingerprints before creating a durable queued run/step; other profiles see 404, stale/expired or already-applied plans return 409. A queued result means a worker still needs to execute it.

Uploads may include an `Idempotency-Key` header. The server hashes validated bytes and destination/folder/project metadata and binds the key to the current profile; repeating the same operation returns its original file, while a different payload with that key returns 409. Agent multipart requests additionally include their run and step keys; file metadata, upload event, operation fingerprint, and step result commit together. Ordinary uploads without a key remain separate uploads, including duplicate filenames.

Agent organization actions run through the same file-management validator/service as browser edits. Category, tag, folder, project-link and current-permission checks are repeated at execution. Actual file events carry the agent run/step provenance; a retry that finds the requested result already committed finishes the step without emitting duplicate activity. Organization changes affect metadata/links only; source bytes and relation edges are not rewritten.

An enabled, unpaused recipient rule may apply its saved category/tag/folder defaults during a matching new upload, including ordinary UI uploads. The uploader's current contribute grant and the rule's current enabled version are checked in the upload transaction. An explicit upload folder is preserved; conflicting active defaults are skipped and recorded rather than guessed. These are rule-authorized metadata changes, distinct from simulated intent suggestions and explicitly confirmed agent plans.

### Agent summaries

Summary output is a deterministic, source-linked excerpt—not a model-generated interpretation. Authorized TXT/MD and DOCX bytes are extracted with strict size/character bounds; PDF/image output contains metadata only, never OCR or inferred visual content. A typical source card contains the filename, extraction method, fingerprint, an exact text excerpt, and a truncation notice where needed. Collection results report requested/available/unavailable coverage and are capped at 50 sources per execution. No document text is sent to an external model or network service. Cached excerpts are shown only while the current profile can still read the source and its file/metadata timestamps still match; changing, renaming, moving, trashing, or revoking access hides stale excerpts. Summarized text is simulated/extractive; rule-period missing/received/late status comes from actual active upload evidence and is a separate factual result.

### Agent worker

Run `npm run agent-worker` beside the web app, or `npm run agent-worker -- --once` for a single bounded tick. The worker is independent of an open browser; it writes a heartbeat visible at `GET /api/agent/worker`. A running heartbeat older than 45 seconds is reported as stale. Jobs use persisted occurrence IDs, renewable leases and attempt-fenced commits; transient failures retry up to three times. Pausing a schedule skips queued/in-flight work; resume calculates the next future occurrence rather than replaying paused time. Gaps over 90 days coalesce to one bounded catch-up occurrence. Docker Compose includes a separate `agent-worker` service sharing the existing database/managed-file volumes and mounting source content read-only; start the complete stack with `docker compose up --build web indexer agent-worker`.

Collection rules use `GET/POST /api/agent/rules`, `GET/PATCH /api/agent/rules/:id`, and `POST /api/agent/rules/:id/control`. The submitted structured form names a fixed demo recipient, destination collection, optional in-collection project, 1–10 expected slots, allowed extensions, optional filename/category/tag criteria, existing organization defaults, and one-off/weekly/monthly/cron collection windows. Defaults are shown as saved; a new rule is always disabled until a separate explicit enable action. Editing creates an immutable version for future unopened periods. Control intents are `enable`, `disable`, `pause`, `resume`, and `archive`, each with the current rule `version`. Criteria use literal filename substrings, never regular expressions.

Enabled rules materialize recipient-specific periods with a frozen rule version. Upload times exactly at opening or closing count within the window. Status comes from current active evidence: upcoming, pending, partial, received, overdue, or received late. Editing supersedes unopened periods and creates new versioned occurrences; paused rules stop generating future periods, while existing periods remain until an organizer cancels one with a recorded reason. Cancelling is explicit and does not delete the period or its evidence history.

Evidence matching uses the server's actual `uploaded` file event, contributor profile, destination/project, extension, and explicit slot criteria. Fixture/source files and uploads by a different profile do not satisfy recipient slots. A file links at most once per period; if several slots or periods match, the recipient selects one. Late uploads require explicitly choosing an overdue period and slot and remain marked late.

The demo interpreter uses the versioned local provider `demo-intents-v1`; it does not call an external model or network service. Its Spanish templates are “Subir un archivo a [colección]”, “Organizar [archivo] en [categoría]”, “Resumir [archivo o colección]”, “Revisar faltantes de [colección]” and “Preparar una regla para [perfil]”. It returns a guided typed action, asks for clarification when a target is missing or ambiguous, and rejects unsupported requests. Inputs are bounded to 500 characters. Document contents are never treated as instructions; actions remain subject to the current profile's server-side permissions and confirmation flow.

### Agent panel walkthrough

The authorized **Calendario de entregas** preview (sample data) lives in **Configuración → Calendario** (`/settings/calendar`); the default `/file` showcase and project workspaces no longer embed it. Use `/file?panel=agent` for the independent agent drawer. Its direct **Subir y organizar** action works without interpreting or applying a plan; the drawer contains no calendar or rule tabs. Only **Administrador del sistema** sees **Configuración → Calendario** (`/file?panel=rules`), where schedule previews/controls, rule drafts and versioned edits, adoption of blocked legacy configuration, period details, evidence linking, and reasoned cancellation are grouped. Other profiles may inspect only periods/evidence authorized to their recipient or organizer scope. Legacy calendar URLs open the main calendar, while unauthorized legacy rule links show a safe access message. The interpreter is simulated and deterministic; file operations and receipt status use the real local demo services.

Agent routes also include `POST /api/agent/schedules/preview` (same cron validator/occurrence engine), `GET /api/agent/periods?collectionId=…` (recipient-scoped), same-origin `POST /api/agent/evidence` with `{ fileId, periodId, slotKey }` for explicit evidence resolution, and same-origin `POST /api/agent/periods` with `{ periodId, reason }` for audited administrator cancellation. The server rechecks contributor, upload event, collection, period and slot; hidden or mismatched evidence does not disclose target details.

`/file/review` recovers to the library. Former review APIs, file-review mutations and project as-of reconstruction return structured **410 feature_retired**, without executing legacy business workflows. Older workspace POST intents likewise cannot invoke approval functions.

This change supersedes the business-process portions of unarchived `document-file-workspace`, demo scenario/navigation, `governed-document-review`, `document-decision-audit`, `document-as-of-reconstruction`, and `demo-discovery-layout` contracts. Categories/tags, explicit versions, previews, provenance, and source-read-only behavior remain. Earlier OpenSpec artifacts are not edited or archived by this implementation; later reconciliation must retain the corrected file-only scope.

## Docker

```powershell
docker compose up --build
```

SQLite persists in `webfiling-data`; uploads persist in the separate `webfiling-managed-files` volume. Back up/restore both. The source mount stays read-only. Set `SOURCE_ROOT_HOST` only after confirming Docker Desktop can read the Windows/SMB mapping. Browser input never selects a physical source path.

When deployed behind a TLS-terminating reverse proxy, set `PUBLIC_ORIGIN` on the web container to the browser-facing origin (for example, `https://webfiling.openix.net.ar`). This keeps same-origin checks and the signed demo-profile cookie aligned with the public HTTPS URL.

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
