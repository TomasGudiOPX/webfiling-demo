# Webfiling — enhancement roadmap inspired by SYNCON

## Purpose and benchmark

This is a product and delivery brief for moving `webfiling-demo` from a persuasive document-search demo toward a governed, operational knowledge product for construction teams. It uses SYNCON's public positioning as a benchmark, not a specification to copy.

SYNCON's core proposition is **governed corporate memory**: agents may propose, but a person ratifies before information becomes company truth; decisions and escalations remain auditable. Its Company Brain describes this explicitly as a proposer/approver boundary and hierarchical reporting to the human responsible for the decision. ([Company Brain](https://syncon.solutions/productos/company-brain)) Their delivery method also puts context and measurable operational improvement before automation. ([How SYNCON works](https://syncon.solutions/como-trabajamos))

For Webfiling, the equivalent is simple: **the system can detect, explain, and prepare a document decision; the accountable construction role makes the decision; the resulting record is traceable and useful on site.**

## What the demo already does well

The current demo already contains the beginnings of the right product rather than merely a file browser:

- Project-scoped and cross-project document search, status filtering, fixture scenarios, and protected source provenance.
- Clear document states: approved/current, pending review, pending ingestion, superseded, returned, and missing metadata.
- A relationship graph and an explicit Rev C / superseded Rev B comparison.
- Evidence views with source path, approval/review information, reason, relationship, and native PDF preview where available.
- Index findings for missing metadata, possible duplicates, and uncertain relations; each shows confidence, evidence, and a human resolution path.
- Human review, simulated intake confirmation, resettable scenarios, and a visible “suggestions require human ratification” rule.
- A controlled read-only source model with local SQLite persistence and a documented no-auth/no-OCR limitation.

These are strong foundations for the product story: **find the current document, understand why it is current, and govern exceptions before they become site risk.**

## Product gap

Today the demo makes individual documents understandable. It does not yet make the _operation_ understandable. A site manager or document controller cannot quickly answer:

- What needs my decision today, who owns it, and by when?
- Which open risk can stop work or cause rework?
- What changed since yesterday, and which teams were notified?
- Which decisions established the current version as the official one?
- Is the pilot reducing search time, rework risk, and approval latency?

That is the important step from “search with governance” to a construction-specific governed memory system.

## Recommended product direction

### North-star workflow

```text
Source share / upload
        ↓
Index detects candidate metadata, version links, conflicts, and risk
        ↓
Human review queue assigns an accountable role and a due date
        ↓
Reviewer approves, returns, rejects, or escalates with evidence
        ↓
Decision is immutably recorded; current document and affected people update
        ↓
Daily project brief reports changes, overdue risks, and operational outcomes
```

The system should not autonomously publish a “vigente” plan or notify a field crew that a drawing is safe to build from. It may prepare the recommendation and highlight the evidence. This preserves the human-governed principle that makes the benchmark compelling and is appropriate for a safety- and cost-sensitive construction workflow.

## Prioritized enhancements

### P0 — make governance operational (first release)

| Enhancement                                              | Why it matters                                                                                  | Concrete first version                                                                                                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Unified review inbox**                                 | Findings are currently visible inside a selected workspace, but not managed as a queue of work. | Add `/file/review` with tabs for `My queue`, `Unassigned`, `Overdue`, and `Completed`. Each item has severity, confidence, source evidence, owner, due date, and a single recommended decision.                          |
| **Decision record and audit timeline**                   | “Approved” should answer _who decided what, on which evidence, and what changed_.               | Replace the isolated review action with an append-only timeline: detected → assigned → proposed → approved/returned/rejected → superseded. Include actor, role, timestamp, reason, evidence links, and prior/new values. |
| **Explicit responsibility**                              | A generic `demo-reviewer` hides the real accountability chain.                                  | Model `Document controller`, `Technical lead`, `Site manager`, and `Project manager`. Require an owner for pending items and show escalation when SLA expires. Use fixture identities initially.                         |
| **Risk-aware triage**                                    | Missing metadata and duplicate detection are not equally urgent.                                | Add `critical/high/normal/low` severity and a rule-based impact explanation, e.g. “potentially superseded execution drawing” is critical; “missing discipline tag” is normal. Sort queues by severity then due date.     |
| **Decision-ready evidence packet**                       | Reviewers should not reconstruct context manually.                                              | In one side panel show current candidate, predecessor/successor, relation evidence, source location, comparable version, open findings, and an approval/return/escalate form with mandatory reason.                      |
| **Realistic status, not a simulated connectivity claim** | “Modo Obra” is currently a UI toggle rather than a demonstrated reliability capability.         | Rename it to `Connectivity simulation` for the demo, or implement actual cached read-only data with last-sync timestamp and a clearly limited offline mode. Do not present it as field-ready until tested.               |

### P1 — turn document records into shared project memory

| Enhancement                                | Why it matters                                                                           | Concrete first version                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Project activity feed**                  | Teams need to know what changed without rerunning searches.                              | An event feed filtered by project, discipline, status, actor, and date: uploaded, indexed, relation proposed, review assigned, status changed, notification sent.                                                                                                              |
| **Daily “obra brief”**                     | The demo needs the executive/field visibility SYNCON associates with governed reporting. | A server-rendered daily summary: new current documents, documents superseded, blockers, approvals due in 48 hours, unresolved high-risk findings, and a link to every source decision. Start with on-demand generation; schedule it only after owners validate its usefulness. |
| **Subscriptions and acknowledgements**     | A valid document is only valuable if affected people know it changed.                    | Let users follow a project, document type, or discipline. For a published revision, notify subscribers in-app/email and record acknowledgement; do not confuse notification with approval.                                                                                     |
| **Structured metadata taxonomy**           | Search and confidence improve only when document naming is normalized.                   | Define required fields by document type: discipline, area/sector, revision, contractor, drawing number, document date, and applicability. Render a validation checklist in intake/review.                                                                                      |
| **Relationship confidence and resolution** | The graph is valuable but needs a decision history.                                      | Store relation candidates with candidate source, confidence, evidence, reviewer decision, and timestamps. Permit `supersedes`, `amends`, `references`, `duplicates`, and `not related`.                                                                                        |
| **Role-appropriate views**                 | The same dense workspace is not ideal for controller, manager, and field crew.           | Keep the current detailed workspace for document control; add a stripped “Field view” showing only approved/current documents, last change, download/preview, and safety warnings.                                                                                             |

### P2 — improve retrieval and pilots once the workflow is trusted

| Enhancement                                   | Why it matters                                                                                                | Concrete first version                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Content extraction and OCR**                | Metadata-only search cannot answer questions contained in PDFs/scans.                                         | Async extraction pipeline with document-type limits, page-level citations, extraction status, error state, and a manual override. Never treat extracted text as approval.                 |
| **Evidence-grounded natural-language search** | This is more useful than generic chat for questions like “which current electrical plan applies to sector B?” | Return documents plus quoted/page-cited evidence, filters applied, and “I could not verify” states. No unsupported summaries.                                                             |
| **Duplicate/version-assistance rules**        | Naming-only duplicates produce weak recommendations.                                                          | Combine filename pattern, drawing number, revision, checksum, directory, and extracted title; show which signals led to the proposal.                                                     |
| **Mobile field experience**                   | Site use is a core value proposition but needs separate validation.                                           | Mobile-first read-only current-document access, QR/deep link per drawing, cached approved documents, and visible `last synced` state. Pilot with a small field crew before broad rollout. |
| **Operational integrations**                  | Long-term value comes from fitting the real workflow.                                                         | Start with one source of truth (share/SharePoint), then add issue/RFI or ERP links only when they have a named owner and acceptance criteria.                                             |

## Recommended screen changes

1. **Portfolio home (`/file`)** — replace scenario-first entry with active projects, critical open items, recent decisions, documents awaiting review, and a clear “Open project” action. Keep scenarios as a demo switcher, not the primary mental model.
2. **Project command center (`/file/:projectSlug`)** — retain search, evidence, version comparison, and graph. Add a compact project health strip: `critical risks`, `awaiting my decision`, `overdue`, `changed today`, and `current-document coverage`.
3. **Review inbox (`/file/review`)** — the main action surface for controllers and technical leads. Batch actions must still require per-document reasoning or an explicit bulk rationale.
4. **Document detail** — split the existing long panel into tabs: `Evidence`, `Versions`, `Decisions`, `Activity`, and `Access`. The default opens on the information needed to make the next decision.
5. **Daily brief (`/file/:projectSlug/brief`)** — a printable/shareable operational report that links back to individual evidence rather than becoming a detached slide deck.

## Data and API additions

Keep current English code/API names and Spanish user copy. Add the smallest set of durable records needed for the workflow:

```text
users(id, display_name, role, active)
review_assignments(id, file_id, assignee_id, assigned_by, due_at, status, priority)
decision_events(id, file_id, event_type, actor_id, occurred_at, reason, payload_json)
relation_candidates(id, from_file_id, to_file_id, relation, confidence, evidence_json, status)
subscriptions(id, user_id, project_id?, document_type?, discipline?)
notifications(id, recipient_id, event_id, channel, sent_at, acknowledged_at)
```

Suggested endpoints:

- `GET /api/reviews?assignee=me&status=open&priority=critical`
- `POST /api/reviews/:id/assign`
- `POST /api/files/:fileId/decisions`
- `GET /api/files/:fileId/activity`
- `GET /api/projects/:projectId/brief`
- `POST /api/relation-candidates/:id/resolve`

Every changing endpoint should create a `decision_event` in the same transaction. Preserve the existing source share as read-only; a decision changes Webfiling metadata, never the original source file.

## Measures that prove the pilot works

The benchmark emphasizes business measures over tool activity. Establish a baseline before adding automation, then report these per project and per role:

- Median time to find the current approved document.
- Time from ingestion/finding to accountable assignment, and from assignment to decision.
- Count and age of unresolved critical/high findings.
- Percentage of active documents with complete required metadata and a verified version relation.
- Number of superseded-document access attempts, and how many were prevented by the UI.
- Notification acknowledgement rate for published revisions.
- Rework, delay, or RFI incidents linked to document version confusion (qualitative at first, then quantified with the client).

Avoid vanity measures such as number of indexed files, AI suggestions, or prompts unless they are paired with a decision-quality or time outcome.

## Delivery sequence

### Phase 1 — validate the workflow (2–3 weeks)

Implement the review inbox, assignment/priority/due date, decision timeline, severity rules, and fixture roles. Update Playwright tests for an assignee taking a high-risk superseded-drawing finding from detection through a reasoned decision. Demo success: a reviewer can complete this flow without leaving Webfiling.

### Phase 2 — validate team visibility (2–3 weeks)

Add the project activity feed, daily brief, relation-candidate history, and basic subscriptions. Run with one project team; interview document control and one field lead weekly. Success: the brief identifies useful action items and its linked evidence is trusted.

### Phase 3 — validate retrieval quality (after pilot evidence)

Introduce constrained OCR/content extraction and cited natural-language retrieval for a limited document subset. Measure false-positive relations and answer usefulness before expanding data sources or adding autonomous behavior.

## Guardrails and non-goals

- No autonomous publishing of current/approved construction documents.
- No claims of offline readiness without durable cache, conflict policy, device testing, and a visible last-sync state.
- No generic chatbot without document/page citations and clear uncertainty.
- No bulk automation before the review/ownership/SLA workflow produces trustworthy audit records.
- No broad source-system integration before the manual workflow has a named owner and measurable pain point.

## Immediate next move

Build the **review inbox plus append-only decision timeline** first. It compounds existing strengths—findings, evidence, document states, and human review—into the clearest realization of a governed construction-memory product. It will also create the data needed for later briefs, notifications, metrics, and AI-assisted retrieval.
