import { useEffect, useState } from "react";

type Collection = { id: string; name: string };
type Period = { id: string; status: string; timezone: string; opensAt: string; closesAt: string; missing: string[]; slots: Array<{ key: string; label: string; requiredCount: number; receivedCount: number }> };

export default function CollectionCalendar({ collections }: { collections: Collection[] }) {
  const [periods, setPeriods] = useState<Array<Period & { collectionName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [monthOffset, setMonthOffset] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all(collections.map(async (collection) => {
      const response = await fetch(`/api/agent/periods?collectionId=${encodeURIComponent(collection.id)}`, { credentials: "same-origin" });
      if (!response.ok) return [];
      const value = await response.json() as { periods?: Period[] };
      return (value.periods ?? []).map((period) => ({ ...period, collectionName: collection.name }));
    })).then((items) => {
      if (!cancelled) setPeriods(items.flat().sort((a, b) => a.opensAt.localeCompare(b.opensAt)));
    }).catch(() => { if (!cancelled) setPeriods([]); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [collections]);

  const month = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1);
  const monthLabel = month.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  const days = Array.from({ length: 42 }, (_, index) => new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + index));
  const dateKey = (date: Date, timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return <section className="collection-calendar" aria-labelledby="collection-calendar-title">
    <div className="section-heading"><div><p className="eyebrow">SEGUIMIENTO COMPARTIDO</p><h2 id="collection-calendar-title">Calendario de entregas</h2></div><a href="/file?panel=agent">Abrir agente</a></div>
    {loading ? <p aria-live="polite">Cargando fechas autorizadas…</p> : periods.length ? <>
      <div className="calendar-month-heading"><button type="button" aria-label="Mes anterior" onClick={() => setMonthOffset((value) => value - 1)}>‹</button><h3 aria-live="polite">{monthLabel}</h3><button type="button" aria-label="Mes siguiente" onClick={() => setMonthOffset((value) => value + 1)}>›</button></div>
      <div className="calendar-month-grid" role="grid" aria-label={`Calendario ${monthLabel}`}>
        {["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"].map((weekday) => <span role="columnheader" key={weekday}>{weekday}</span>)}
        {days.map((day) => {
          const key = dateKey(day, "UTC");
          const todaysPeriods = periods.filter((period) => dateKey(new Date(period.opensAt), period.timezone) === key);
          return <div role="gridcell" className={day.getMonth() === month.getMonth() ? "calendar-day" : "calendar-day outside-month"} key={day.toISOString()}>
            <time dateTime={key}>{day.getDate()}</time>{todaysPeriods.map((period) => <a key={period.id} href={`#period-${encodeURIComponent(period.id)}`}>{period.collectionName}</a>)}
          </div>;
        })}
      </div>
      <h3 className="calendar-agenda-title">Agenda</h3>
      <ol className="calendar-agenda">{periods.map((period) => <li id={`period-${period.id}`} key={period.id}>
        <time dateTime={period.opensAt}>{new Date(period.opensAt).toLocaleDateString("es-AR", { timeZone: period.timezone })}</time>
        <details><summary><strong>{period.collectionName}</strong> · {period.status}</summary>
          <p>{new Date(period.opensAt).toLocaleString("es-AR", { timeZone: period.timezone })} – {new Date(period.closesAt).toLocaleString("es-AR", { timeZone: period.timezone })}</p>
          <p>{period.missing.length ? `Faltan: ${period.missing.join(", ")}` : "Sin faltantes registrados"}</p>
          <ul>{period.slots.map((slot) => <li key={slot.key}>{slot.label}: {slot.receivedCount}/{slot.requiredCount} recibidos</li>)}</ul>
        </details>
      </li>)}</ol>
    </> : <p>No hay entregas programadas para tus colecciones accesibles.</p>}
  </section>;
}
