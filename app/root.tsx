import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import stylesheet from "./styles/app.css?url";
import { ThemeToggle } from "./components/theme-toggle";

export function links() {
  return [{ rel: "stylesheet", href: stylesheet }];
}

export default function App() {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <Meta />
        <Links />
      </head>
      <body>
        <ThemeToggle />
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "Error inesperado";

  return (
    <main className="shell centered">
      <p className="eyebrow">WEBFILING / ERROR</p>
      <h1>No pudimos cargar este espacio</h1>
      <p>{message}</p>
      <a className="button" href="/file">
        Volver a proyectos
      </a>
    </main>
  );
}
