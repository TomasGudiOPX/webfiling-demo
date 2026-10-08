import path from "node:path";

export interface AppConfig {
  port: number;
  databasePath: string;
  sourceRoot: string;
  demoMode: boolean;
  indexIntervalSeconds: number;
  sessionSecret: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Configuration error: ${name} is required.`);
  return value;
}

export function getConfig(): AppConfig {
  const port = Number(process.env.PORT ?? "3000");
  const indexIntervalSeconds = Number(
    process.env.INDEX_INTERVAL_SECONDS ?? "300",
  );
  const demoMode = (process.env.DEMO_MODE ?? "true").toLowerCase() === "true";
  const sessionSecret =
    process.env.SESSION_SECRET ?? (demoMode ? "demo-only-secret" : "");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "Configuration error: PORT must be an integer between 1 and 65535.",
    );
  }
  if (!Number.isInteger(indexIntervalSeconds) || indexIntervalSeconds < 0) {
    throw new Error(
      "Configuration error: INDEX_INTERVAL_SECONDS must be a non-negative integer.",
    );
  }
  if (!sessionSecret)
    throw new Error(
      "Configuration error: SESSION_SECRET is required outside DEMO_MODE.",
    );
  const databasePath = path.resolve(
    process.env.DATABASE_PATH ?? "./data/webfiling.sqlite",
  );
  const sourceRoot = path.resolve(process.env.SOURCE_ROOT ?? "./fixtures");
  return {
    port,
    databasePath,
    sourceRoot,
    demoMode,
    indexIntervalSeconds,
    sessionSecret,
  };
}

export function assertAllowedSourceRoot(
  candidate: string,
  configuredRoot = getConfig().sourceRoot,
): string {
  const resolved = path.resolve(candidate);
  const root = path.resolve(configuredRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      `Source path is outside the configured SOURCE_ROOT: ${root}`,
    );
  }
  return resolved;
}
