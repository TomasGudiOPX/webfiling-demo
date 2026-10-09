import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useLoaderData } from "react-router";
import type { browserModel } from "../.server/file-browser.server";

type Section = "agent" | "settings";
type Operation = { type: string; collectionId?: string; fileId?: string; fileIds?: string[]; recipientProfileId?: string; [key: string]: unknown };
type Interpretation = { status: "ready" | "clarify" | "unsupported" | "forbidden"; explanation?: string; reason?: string; choices?: string[]; operation?: Operation };
type Plan = { id: string; operation: Operation; reason: string; expiresAt: string };
type Schedule = { id: string; actionType: string; collectionId: string; scheduleKind: string; nextRunAt: string | null; pausedAt: string | null; managementBlocked?: boolean; version: number };
type Rule = { id: string; recipientProfileId: string; collectionId: string; enabled: boolean; pausedAt: string | null; managementBlocked?: boolean; version: number };
type Notice = { id: string; notice_kind: string; collection_id: string; collection_name: string; closes_at: string; missing_json: string };
type HistoryRun = { id: string; status: string; intent: string; createdAt: string; error?: { message: string } | null };
type ApiData = { runs?: HistoryRun[]; schedules?: Schedule[]; rules?: Rule[]; notices?: Notice[]; worker?: { status: string; stale: boolean; heartbeatAt: string | null }; periods?: Array<{ id: string; status: string; missing: string[]; opensAt: string; closesAt: string; slots: Array<{ key: string; label: string; receivedCount: number }> }> };

const sections: Array<{ id: Section; label: string }> = [{ id: "agent", label: "Agente" }, { id: "settings", label: "Configuración · Calendario" }];

async function jsonRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  const data = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? "No se pudo completar la acción.");
  return data;
}

export default function AgentSections({ active }: { active: Section | null }) {
  const model = useLoaderData<Awaited<ReturnType<typeof browserModel>>>();
  const writableCollections = model.collections.filter((item) => item.capabilities.canContribute);
  const currentWritableCollection = writableCollections.find((item) => item.id === model.collectionId) ?? writableCollections[0];
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const searchKey = searchParams.toString();
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [intentText, setIntentText] = useState("");
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [runId, setRunId] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [data, setData] = useState<ApiData>({});
  const [collectionId, setCollectionId] = useState("collection-project-project-costa-norte");
  const [periods, setPeriods] = useState<ApiData["periods"]>([]);
  const [cronExpression, setCronExpression] = useState("0 9 * * 1");
  const [timezone, setTimezone] = useState("America/Argentina/Buenos_Aires");
  const [ruleRecurrenceKind, setRuleRecurrenceKind] = useState("one_off");
  const [scheduleKind, setScheduleKind] = useState("recurring");
  const [occurrences, setOccurrences] = useState<string[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const panelTitleRef = useRef<HTMLHeadingElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const immediateUploadKey = useRef("");
  const [uploadDestination, setUploadDestination] = useState("");
  const wasOpen = useRef(false);

  useEffect(() => {
    if (active) panelTitleRef.current?.focus();
    else if (wasOpen.current) navRef.current?.querySelector("button")?.focus();
    wasOpen.current = Boolean(active);
  }, [active, searchKey]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError("");
    setData({});
    if (active === "agent") {
      void jsonRequest<ApiData>("/api/agent/runs").then((value) => { if (!cancelled) setData(value); }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo cargar el historial."); });
    } else if (active === "settings") {
      void Promise.all([
        jsonRequest<{ schedules: Schedule[] }>("/api/agent/schedules"),
        jsonRequest<{ notices: Notice[] }>("/api/agent/notices"),
        jsonRequest<{ worker: NonNullable<ApiData["worker"]> }>("/api/agent/worker"),
        jsonRequest<{ rules?: Rule[] }>("/api/agent/rules"),
      ]).then(([schedules, notices, worker, rules]) => { if (!cancelled) setData({ schedules: schedules.schedules, notices: notices.notices, worker: worker.worker, rules: rules.rules }); })
        .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo cargar el calendario."); });
    } else {
      void jsonRequest<ApiData>("/api/agent/rules").then((value) => { if (!cancelled) setData(value); }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudieron cargar las reglas."); });
    }
    return () => { cancelled = true; };
  }, [active, runId, location.key]);

  useEffect(() => {
    const requestedIntent = searchParams.get("intent");
    if (active === "agent" && requestedIntent) setIntentText(requestedIntent.slice(0, 500));
  }, [active, searchKey]);

  useEffect(() => {
    if (active !== "settings" || !collectionId) return;
    void jsonRequest<{ periods: NonNullable<ApiData["periods"]> }>(`/api/agent/periods?collectionId=${encodeURIComponent(collectionId)}`)
      .then((value) => setPeriods(value.periods)).catch(() => setPeriods([]));
  }, [active, collectionId]);

  useEffect(() => {
    if (active !== "agent") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active, searchParams]);

  useEffect(() => {
    setUploadFile(null); setUploadDestination(""); immediateUploadKey.current = "";
    setPlan(null); setRunId(""); setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [model.profile]);

  function selectSection(section: Section | null) {
    const next = new URLSearchParams(searchParams);
    if (section) next.set("panel", section);
    else next.delete("panel");
    setSearchParams(next, { preventScrollReset: true });
  }
  function closePanel() { selectSection(null); }

  async function interpret(event: FormEvent) {
    event.preventDefault(); setError(""); setPlan(null); setRunId(""); setResult(null);
    try {
      const response = await jsonRequest<{ interpretation: Interpretation }>("/api/agent/interpret", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: intentText }),
      });
      setInterpretation(response.interpretation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo interpretar la solicitud."); }
  }

  async function preparePlan() {
    if (interpretation?.status !== "ready" || !interpretation.operation) return;
    setError("");
    try {
      const response = await jsonRequest<{ plan: Plan }>("/api/agent/plans", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerVersion: "demo-intents-v1", intent: intentText, operation: interpretation.operation, reason: interpretation.explanation ?? "Acción guiada" }),
      });
      setPlan(response.plan);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo preparar el plan."); }
  }

  async function retryRun(run: HistoryRun) {
    setError(""); setPlan(null); setRunId(""); setResult(null);
    try {
      const operation = JSON.parse(run.intent) as Operation;
      if (!operation || typeof operation.type !== "string") throw new Error("No se pudo reconstruir la acción.");
      const response = await jsonRequest<{ plan: Plan }>("/api/agent/plans", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerVersion: "demo-intents-v1", intent: "Reintentar acción revisada", operation, reason: "Reintento explícito; se validarán nuevamente permisos y destinos" }),
      });
      setPlan(response.plan);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo preparar el reintento."); }
  }

  async function applyPlan() {
    if (!plan || isApplying) return;
    setIsApplying(true);
    setError("");
    try {
      const response = await jsonRequest<{ run: { runId: string } }>(`/api/agent/plans/${encodeURIComponent(plan.id)}/apply`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      setRunId(response.run.runId);
      if (plan.operation.type === "upload") return;
      const execution = await jsonRequest<{ result: unknown }>(`/api/agent/runs/${encodeURIComponent(response.run.runId)}/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      setResult(execution.result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo aplicar el plan."); }
    finally { setIsApplying(false); }
  }

  async function submitUpload(event: FormEvent) {
    event.preventDefault();
    if (!uploadFile || !plan?.operation.collectionId || !runId || isUploading) return;
    setIsUploading(true);
    setError("");
    const body = new FormData();
    body.append("file", uploadFile);
    body.append("collectionId", plan.operation.collectionId);
    body.append("runId", runId);
    body.append("stepKey", "apply");
    for (const projectId of (plan.operation.projectIds as string[] | undefined) ?? []) body.append("projectId", projectId);
    try {
      const response = await jsonRequest<{ file: unknown }>("/api/files/upload", {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body,
      });
      setResult(response.file); setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      const runs = await jsonRequest<ApiData>("/api/agent/runs");
      setData(runs);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cargar el archivo."); }
    finally { setIsUploading(false); }
  }

  async function submitImmediateUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedDestination = String(form.get("collectionId") ?? uploadDestination);
    if (!uploadFile || !selectedDestination || isUploading) return;
    setIsUploading(true); setError("");
    const destination = model.collections.find((item) => item.id === selectedDestination && item.capabilities.canContribute);
    if (!destination) { setError("El destino ya no está disponible para cargar archivos."); setIsUploading(false); return; }
    const body = new FormData(); body.append("file", uploadFile); body.append("collectionId", destination.id);
    const projectId = model.project?.id ?? destination.projectId;
    if (projectId) body.append("projectId", projectId);
    if (!immediateUploadKey.current) immediateUploadKey.current = crypto.randomUUID();
    try {
      const response = await jsonRequest<{ file: { id: string; filename: string } }>("/api/files/upload", {
        method: "POST", headers: { "Idempotency-Key": immediateUploadKey.current }, body,
      });
      setResult(response.file); setUploadFile(null); immediateUploadKey.current = "";
      if (fileInputRef.current) fileInputRef.current.value = "";
      const runs = await jsonRequest<ApiData>("/api/agent/runs");
      setData(runs);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cargar el archivo."); }
    finally { setIsUploading(false); }
  }

  async function controlSchedule(schedule: Schedule, intent: "pause" | "resume" | "run_now" | "adopt") {
    setError("");
    try {
      await jsonRequest(`/api/agent/schedules/${encodeURIComponent(schedule.id)}/control`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent, version: schedule.version, ...(intent === "run_now" ? { requestId: crypto.randomUUID() } : {}) }),
      });
      const schedules = await jsonRequest<{ schedules: Schedule[] }>("/api/agent/schedules");
      setData((current) => ({ ...current, schedules: schedules.schedules }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cambiar la programación."); }
  }

  async function previewSchedule(event: FormEvent) {
    event.preventDefault(); setError(""); setOccurrences([]);
    try {
      const preview = await jsonRequest<{ occurrences: string[] }>("/api/agent/schedules/preview", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cronExpression, timezone }),
      });
      setOccurrences(preview.occurrences);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo calcular la vista previa."); }
  }

  async function createSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await jsonRequest("/api/agent/schedules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType: String(form.get("actionType")), collectionId: String(form.get("collectionId")), scheduleKind, timezone, ...(scheduleKind === "once" ? { runAt: new Date(String(form.get("runAt"))).toISOString() } : { cronExpression }) }),
      });
      const schedules = await jsonRequest<{ schedules: Schedule[] }>("/api/agent/schedules");
      setData((current) => ({ ...current, schedules: schedules.schedules }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo crear la programación."); }
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const timezone = String(form.get("ruleTimezone"));
      const recurrenceKind = String(form.get("recurrenceKind"));
      const recurrence = recurrenceKind === "weekly" ? {
        kind: "weekly", timezone, weekday: Number(form.get("weekday")), hour: Number(form.get("hour")), minute: Number(form.get("minute")), windowMinutes: Number(form.get("windowMinutes")),
      } : recurrenceKind === "monthly" ? {
        kind: "monthly", timezone, day: Number(form.get("day")), hour: Number(form.get("hour")), minute: Number(form.get("minute")), windowMinutes: Number(form.get("windowMinutes")),
      } : {
        kind: "one_off", timezone,
        opensAt: new Date(String(form.get("opensAt"))).toISOString(),
        closesAt: new Date(String(form.get("closesAt"))).toISOString(),
      };
      await jsonRequest("/api/agent/rules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientProfileId: String(form.get("recipientProfileId")), collectionId: String(form.get("collectionId")), projectId: null,
          definition: {
            slots: [{ key: "documento", label: String(form.get("slotLabel")), requiredCount: 1, allowedExtensions: [String(form.get("extension"))], criteria: {} }],
            organizationDefaults: {}, recurrence,
          },
        }),
      });
      const rules = await jsonRequest<{ rules: Rule[] }>("/api/agent/rules");
      setData((current) => ({ ...current, rules: rules.rules }));
      formElement.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar la regla."); }
  }

  async function changeRule(rule: Rule, intent: "enable" | "pause" | "resume" | "archive" | "adopt") {
    try {
      await jsonRequest(`/api/agent/rules/${encodeURIComponent(rule.id)}/control`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent, version: rule.version }),
      });
      const rules = await jsonRequest<{ rules: Rule[] }>("/api/agent/rules");
      setData((current) => ({ ...current, rules: rules.rules }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cambiar la regla."); }
  }

  async function linkEvidence(event: FormEvent<HTMLFormElement>, periodId: string) {
    event.preventDefault(); setError(""); setFeedback("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await jsonRequest<{ result: { late?: boolean; status: string } }>("/api/agent/evidence", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: String(form.get("fileId")), periodId, slotKey: String(form.get("slotKey")) }),
      });
      setFeedback(response.result.late ? "Recepción vinculada con demora." : "Recepción vinculada.");
      const value = await jsonRequest<{ periods: NonNullable<ApiData["periods"]> }>(`/api/agent/periods?collectionId=${encodeURIComponent(collectionId)}`);
      setPeriods(value.periods);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo vincular la recepción."); }
  }

  async function cancelPeriod(event: FormEvent<HTMLFormElement>, periodId: string) {
    event.preventDefault(); setError(""); setFeedback("");
    const form = new FormData(event.currentTarget);
    try {
      await jsonRequest("/api/agent/periods", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId, reason: String(form.get("reason")) }),
      });
      setFeedback("Período cancelado; se conservó su historial de recepción.");
      const value = await jsonRequest<{ periods: NonNullable<ApiData["periods"]> }>(`/api/agent/periods?collectionId=${encodeURIComponent(collectionId)}`);
      setPeriods(value.periods);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cancelar el período."); }
  }

  return (
    <>
      {active !== "settings" && <nav className="agent-launcher" ref={navRef} aria-label="Herramientas secundarias">
        <span>Herramientas</span>
        <button type="button" aria-pressed={active === "agent"} onClick={() => selectSection("agent")}>Agente</button>
      </nav>}
      {active && <div className={active === "settings" ? "calendar-settings-view" : "agent-panel"} aria-label={active === "settings" ? "Configuración del calendario" : `Panel ${active}`}>
        <header className="agent-panel-header">
          <div><p className="eyebrow">WEBFILING / DEMO</p>{active === "settings" ? <h1 ref={panelTitleRef} tabIndex={-1}>Configuración · Calendario</h1> : <h2 ref={panelTitleRef} tabIndex={-1}>{sections.find((section) => section.id === active)?.label}</h2>}</div>
          {active === "settings" ? <Link className="calendar-settings-back" to="/file">Volver a archivos</Link> : <button type="button" className="agent-close" onClick={closePanel} aria-label="Cerrar panel">×</button>}
        </header>
        {error && <p className="agent-error" role="alert">{error}</p>}
        {feedback && <p className="agent-note" role="status">{feedback}</p>}
        {active === "agent" && <div className="agent-section-body">
          <p className="agent-note">Intérprete local simulado. Revisá el objetivo y confirmá antes de ejecutar.</p>
          <form className="agent-upload-form" onSubmit={submitImmediateUpload}>
            <strong>Subir un archivo directamente</strong>
            <label htmlFor="agent-upload-destination">Destino permitido</label>
            {writableCollections.length ? <>
            <select id="agent-upload-destination" name="collectionId" value={uploadDestination || currentWritableCollection?.id || ""} onChange={(event) => { setUploadDestination(event.target.value); immediateUploadKey.current = ""; }} required>
              {writableCollections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <label htmlFor="agent-upload-file">Archivo</label>
            <input ref={fileInputRef} id="agent-upload-file" type="file" onChange={(event) => { setUploadFile(event.target.files?.[0] ?? null); immediateUploadKey.current = ""; }} required />
            <button className="button" type="submit" disabled={!uploadFile || isUploading}>{isUploading ? "Subiendo…" : "Subir y organizar"}</button>
            </> : <p className="agent-note" role="status">No tienes colecciones habilitadas para cargar archivos. Elige un espacio donde tu perfil pueda aportar.</p>}
          </form>
          <div className="agent-chips" aria-label="Ejemplos de solicitudes">
            {["Revisar faltantes de Costa Norte", "Resumir Costa Norte", "Preparar una regla para empleado"].map((chip) => <button type="button" key={chip} onClick={() => { setIntentText(chip); setInterpretation(null); }}>{chip}</button>)}
          </div>
          <form className="agent-intent-form" onSubmit={interpret}>
            <label htmlFor="agent-intent">¿Qué necesitás hacer?</label>
            <textarea id="agent-intent" value={intentText} maxLength={500} onChange={(event) => setIntentText(event.target.value)} placeholder="Ej.: Resumir un informe de Costa Norte" />
            <div className="agent-form-footer"><span>{intentText.length}/500</span><div className="agent-input-actions"><button className="agent-voice-placeholder" type="button" disabled aria-label="Entrada por voz: próximamente" title="Próximamente"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/></svg></button><button className="button" type="submit" disabled={!intentText.trim()}>Interpretar</button></div></div>
          </form>
          {interpretation?.status === "unsupported" && <p className="agent-note" role="status">No reconozco esa solicitud. Probá una de las acciones guiadas.</p>}
          {interpretation?.status === "forbidden" && <p className="agent-note" role="status">La configuración del calendario requiere el perfil Administrador del sistema. Podés consultar tus fechas autorizadas desde el calendario principal.</p>}
          {interpretation?.status === "clarify" && <div className="agent-card" role="status"><strong>Necesito una aclaración</strong><p>{interpretation.reason === "ambiguous_target" ? "Hay más de un objetivo posible." : "Elegí una colección o un archivo para continuar."}</p>{interpretation.choices?.map((choice) => <button type="button" key={choice} onClick={() => setIntentText(`${intentText} ${choice}`)}>{choice}</button>)}</div>}
          {interpretation?.status === "ready" && <div className="agent-card"><strong>Acción sugerida</strong><p>{interpretation.explanation}</p><code>{interpretation.operation?.type}</code><button className="button" type="button" onClick={preparePlan}>Preparar plan</button></div>}
          {plan && <div className="agent-card agent-plan-card"><strong>Plan para revisar</strong><p>{plan.reason}</p><p>Vence: {new Date(plan.expiresAt).toLocaleString("es-AR")}</p><button className="button" type="button" onClick={applyPlan} disabled={Boolean(runId) || isApplying}>{isApplying ? "Aplicando…" : "Aplicar una vez"}</button></div>}
          {runId && plan?.operation.type === "upload" && <form className="agent-upload-form" onSubmit={submitUpload}><label htmlFor="agent-plan-upload-file">Archivo para el plan</label><input id="agent-plan-upload-file" type="file" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} required /><button className="button" type="submit" disabled={!uploadFile || isUploading}>{isUploading ? "Cargando…" : "Confirmar y cargar"}</button></form>}
          {result !== null && <div className="agent-result" role="status"><strong>Resultado</strong>{(result as { id?: string; filename?: string }).id ? <article><p>{(result as { filename?: string }).filename}</p><Link to={`/file?browse=1&selected=${encodeURIComponent((result as { id: string }).id)}`}>Abrir archivo cargado</Link></article> : Array.isArray((result as { sources?: unknown[] }).sources) ? (result as { sources: Array<{ fileId: string; filename: string; summaryText: string; truncated: boolean }> }).sources.map((source) => <article key={source.fileId}><h3>{source.filename}</h3><p>{source.summaryText}</p>{source.truncated && <small>Extracto limitado.</small>}<Link to={`/file?browse=1&selected=${encodeURIComponent(source.fileId)}`}>Abrir fuente</Link></article>) : <pre>{JSON.stringify(result, null, 2)}</pre>}</div>}
          <section className="agent-history"><h3>Historial reciente</h3><div className="agent-history-list">{data.runs?.slice(0, 5).map((run) => { let action = "acción"; try { action = (JSON.parse(run.intent) as Operation).type ?? action; } catch { action = "acción"; } return <article key={run.id}><p><strong>{run.status}</strong> · {action} · {new Date(run.createdAt).toLocaleString("es-AR")}</p>{run.error && <p>{run.error.message}</p>}{["failed", "partial"].includes(run.status) && <button type="button" onClick={() => retryRun(run)}>Preparar reintento</button>}</article>; })}<div className="agent-history-examples"><p className="agent-note">Actividad de ejemplo (datos ilustrativos).</p><article><p><strong>Completado</strong> · Resumen de Costa Norte · Hoy, 10:24</p><p>Resumen preparado con 3 documentos de la colección.</p></article><article><p><strong>Revisión</strong> · Faltantes de Costa Norte · Ayer, 16:40</p><p>Se identificaron 2 documentos pendientes de entrega.</p></article><article><p><strong>Completado</strong> · Organización de archivos · Ayer, 11:15</p><p>Plano estructural clasificado en la carpeta Planos.</p></article></div></div></section>
        </div>}
        {active === "settings" && <div className="agent-section-body">
          <p className="agent-note">Agenda compartida según tus permisos. Ejecución: {data.worker?.status ?? "cargando"}{data.worker?.heartbeatAt ? ` · latido ${new Date(data.worker.heartbeatAt).toLocaleTimeString("es-AR")}` : ""}</p>
          <form className="agent-rule-form" onSubmit={previewSchedule}><h3>Vista previa cron</h3><label>Expresión de cinco campos<input value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} maxLength={100} required /></label><label>Zona IANA<input value={timezone} onChange={(event) => setTimezone(event.target.value)} maxLength={80} required /></label><button type="submit">Previsualizar próximas 3</button>{occurrences.map((date) => <p key={date}>{new Date(date).toLocaleString("es-AR", { timeZone: timezone })}</p>)}</form>
          <form className="agent-rule-form" onSubmit={createSchedule}><h3>Nueva programación</h3><label>Colección<select name="collectionId" required>{model.collections.filter((item) => item.capabilities.canRead).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Acción<select name="actionType"><option value="collection_check">Revisar faltantes</option><option value="collection_summary">Resumir colección</option></select></label><label>Tipo<select value={scheduleKind} onChange={(event) => setScheduleKind(event.target.value)}><option value="recurring">Recurrente</option><option value="once">Una vez</option></select></label>{scheduleKind === "once" && <label>Ejecutar el<input name="runAt" type="datetime-local" required /></label>}<button className="button" type="submit">Crear programación</button></form>
          <h3>Agenda próxima</h3>
          {!data.schedules?.length && <p className="agent-note">No hay programaciones visibles para este perfil.</p>}
          {data.schedules?.map((schedule) => <article className="agent-list-card" key={schedule.id}><strong>{schedule.actionType === "collection_summary" ? "Resumen" : "Revisión de colección"} · {model.collections.find((item) => item.id === schedule.collectionId)?.name ?? "Colección"}</strong><p>{schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString("es-AR") : "Sin próxima fecha"}</p>{schedule.managementBlocked ? <p>Programación heredada bloqueada; requiere adopción explícita.</p> : null}<div className="agent-inline-actions">{schedule.managementBlocked ? <button type="button" onClick={() => controlSchedule(schedule, "adopt")}>Adoptar y auditar</button> : <><button type="button" onClick={() => controlSchedule(schedule, schedule.pausedAt ? "resume" : "pause")}>{schedule.pausedAt ? "Reanudar" : "Pausar"}</button><button type="button" onClick={() => controlSchedule(schedule, "run_now")}>Ejecutar ahora</button></>}</div></article>)}
          <h3>Avisos</h3>
          {!data.notices?.length && <p className="agent-note">No hay avisos pendientes.</p>}
          {data.notices?.map((notice) => <article className="agent-list-card" key={notice.id}><strong>{notice.notice_kind === "overdue" ? "Vencido" : "Próximo a vencer"} · {notice.collection_name}</strong><p>Vence {new Date(notice.closes_at).toLocaleString("es-AR")}</p><code>{notice.missing_json}</code></article>)}
        </div>}
        {active === "settings" && <div className="agent-section-body">
          <p className="agent-note">Configuración exclusiva del Administrador del sistema. Las reglas nuevas quedan deshabilitadas hasta habilitarlas explícitamente.</p>
          <form className="agent-rule-form" onSubmit={createRule}>
            <label>Colección<select name="collectionId" value={collectionId} onChange={(event) => setCollectionId(event.target.value)} required>{model.collections.filter((item) => item.capabilities.canRead).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Destinatario autorizado<select name="recipientProfileId" required>{(model.collections.find((item) => item.id === collectionId)?.authorizedRecipients ?? []).map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.name}</option>)}</select></label>
            <label>Documento esperado<input name="slotLabel" defaultValue="Informe semanal" required /></label>
            <label>Formato<select name="extension"><option value=".pdf">PDF</option><option value=".docx">DOCX</option><option value=".txt">TXT</option></select></label>
            <label>Recurrencia<select name="recurrenceKind" value={ruleRecurrenceKind} onChange={(event) => setRuleRecurrenceKind(event.target.value)}><option value="one_off">Una vez</option><option value="weekly">Semanal</option><option value="monthly">Mensual</option></select></label>
            <label>Zona horaria IANA<input name="ruleTimezone" defaultValue={timezone} maxLength={80} required /></label>
            {ruleRecurrenceKind === "one_off" ? <><label>Apertura<input name="opensAt" type="datetime-local" required /></label><label>Cierre<input name="closesAt" type="datetime-local" required /></label></> : <>
              {ruleRecurrenceKind === "weekly" ? <label>Día de semana (0–6)<input name="weekday" type="number" min="0" max="6" defaultValue="1" required /></label> : <label>Día del mes (1–31)<input name="day" type="number" min="1" max="31" defaultValue="1" required /></label>}
              <label>Hora<input name="hour" type="number" min="0" max="23" defaultValue="9" required /></label><label>Minuto<input name="minute" type="number" min="0" max="59" defaultValue="0" required /></label><label>Ventana (minutos)<input name="windowMinutes" type="number" min="1" max="10080" defaultValue="1440" required /></label>
            </>}
            <button className="button" type="submit">Guardar borrador</button>
          </form>
          <h3>Reglas de la colección</h3>
          {data.rules?.filter((rule) => rule.collectionId === collectionId).map((rule) => <article className="agent-list-card" key={rule.id}><strong>{model.collections.find((item) => item.id === rule.collectionId)?.authorizedRecipients?.find((recipient) => recipient.id === rule.recipientProfileId)?.name ?? rule.recipientProfileId} · {rule.enabled ? rule.pausedAt ? "Pausada" : "Activa" : "Borrador"}</strong>{rule.managementBlocked && <p>Regla heredada bloqueada; se preserva su creador original.</p>}<div className="agent-inline-actions">{rule.managementBlocked ? <button type="button" onClick={() => changeRule(rule, "adopt")}>Adoptar y auditar</button> : <>{!rule.enabled && <button type="button" onClick={() => changeRule(rule, "enable")}>Habilitar</button>}{rule.enabled && <button type="button" onClick={() => changeRule(rule, rule.pausedAt ? "resume" : "pause")}>{rule.pausedAt ? "Reanudar" : "Pausar"}</button>}<button type="button" onClick={() => changeRule(rule, "archive")}>Archivar</button></>}</div></article>)}
          <h3>Períodos y faltantes</h3>
          {periods?.map((period) => <article className="agent-list-card" key={period.id}><strong>Estado de recepción: {period.status}</strong><p>{new Date(period.opensAt).toLocaleDateString("es-AR")} — {new Date(period.closesAt).toLocaleDateString("es-AR")}</p><p>Faltan: {period.missing.join(", ") || "ninguno"}</p><ul>{period.slots.map((slot) => <li key={slot.key}>{slot.label}: {slot.receivedCount}</li>)}</ul><form onSubmit={(event) => linkEvidence(event, period.id)}><label>Archivo gestionado ID<input name="fileId" required /></label><label>Espacio<select name="slotKey">{period.slots.map((slot) => <option key={slot.key} value={slot.key}>{slot.label}</option>)}</select></label><button type="submit">Vincular recepción existente</button></form>{!['cancelled', 'superseded'].includes(period.status) && <form onSubmit={(event) => cancelPeriod(event, period.id)}><label>Motivo de cancelación<input name="reason" minLength={3} maxLength={500} required /></label><button type="submit">Cancelar período</button></form>}</article>)}
        </div>}
      </div>}
    </>
  );
}
