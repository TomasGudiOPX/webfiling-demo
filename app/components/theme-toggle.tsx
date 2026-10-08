import { useEffect, useState } from "react";

type Theme = "dark" | "light";
const storageKey = "webfiling-theme";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(storageKey, theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    const initialTheme: Theme = stored === "light" ? "light" : "dark";
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={
        theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"
      }
    >
      {theme === "dark" ? "☀ Modo claro" : "◐ Modo oscuro"}
    </button>
  );
}
