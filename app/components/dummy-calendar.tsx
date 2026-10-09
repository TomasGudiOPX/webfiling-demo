const events = [
  { day: 6, title: "Entrega de planos" },
  { day: 14, title: "Registro fotográfico" },
  { day: 22, title: "Informe semanal" },
];

export default function DummyCalendar() {
  const month = new Date();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  const days = Array.from({ length: 35 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  const label = month.toLocaleDateString("es-AR", { month: "long", year: "numeric" });

  return (
    <section className="collection-calendar dummy-calendar" aria-labelledby="dummy-calendar-title">
      <div className="section-heading">
        <div><p className="eyebrow">VISTA PRELIMINAR</p><h2 id="dummy-calendar-title">Calendario de entregas</h2></div>
        <span className="dummy-calendar-badge">Datos de ejemplo</span>
      </div>
      <div className="calendar-month-heading"><h3>{label}</h3></div>
      <div className="calendar-month-grid" role="grid" aria-label={`Calendario de ejemplo: ${label}`}>
        {["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"].map((weekday) => <span role="columnheader" key={weekday}>{weekday}</span>)}
        {days.map((day) => {
          const inMonth = day.getMonth() === month.getMonth();
          const sampleEvents = events.filter((event) => event.day === day.getDate() && inMonth);
          return <div role="gridcell" className={`calendar-day${inMonth ? "" : " outside-month"}`} key={day.toISOString()}>
            <time dateTime={day.toISOString().slice(0, 10)}>{day.getDate()}</time>
            {sampleEvents.map((event) => <span className="dummy-calendar-event" key={event.title}>{event.title}</span>)}
          </div>;
        })}
      </div>
      <ol className="dummy-calendar-agenda" aria-label="Entregas de ejemplo">
        {events.map((event) => <li key={event.title}><strong>{event.day} {month.toLocaleDateString("es-AR", { month: "long" })}</strong><span>{event.title}</span></li>)}
      </ol>
    </section>
  );
}
