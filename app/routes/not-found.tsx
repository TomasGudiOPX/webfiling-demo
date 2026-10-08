import { Link } from "react-router";
export default function NotFound() {
  return (
    <main className="shell centered">
      <p className="eyebrow">404 / NO ENCONTRADO</p>
      <h1>Este espacio no existe.</h1>
      <p>Verifica el proyecto o vuelve al inicio de la demo.</p>
      <Link className="button" to="/file">
        Volver a proyectos
      </Link>
    </main>
  );
}
