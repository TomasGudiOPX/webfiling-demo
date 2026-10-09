import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config";
import { openDatabase } from "./db.server";

const within = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return (
    !relative ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};
export async function managedDirectories() {
  const config = getConfig();
  const physical = async (candidate: string): Promise<string> => {
    try {
      return await fs.realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      return path.join(await physical(parent), path.basename(candidate));
    }
  };
  // Resolve symlinked ancestors before creating anything; invalid roots must not write to source.
  const root = await physical(config.managedStorageRoot);
  for (const candidate of [
    config.sourceRoot,
    path.resolve("public"),
    path.resolve("private-fixtures"),
  ]) {
    const other = await physical(candidate);
    if (within(root, other) || within(other, root))
      throw new Error("Managed storage overlaps protected content.");
  }
  const dirs = {
    root,
    staging: path.join(root, "staging"),
    objects: path.join(root, "objects"),
  };
  await fs.mkdir(root, { recursive: true });
  for (const dir of [dirs.staging, dirs.objects]) {
    if ((await physical(dir)) !== dir)
      throw new Error("Managed subdirectories must not be symbolic links.");
    await fs.mkdir(dir, { recursive: true });
  }
  return dirs;
}

/** Explicit maintenance operation: bounded scan, no recursion, references include trash. */
export async function cleanupManagedStorage(
  db = openDatabase(),
  now = Date.now(),
) {
  const dirs = await managedDirectories();
  const references = new Set(
    (
      db
        .prepare(
          "SELECT content_key FROM library_file_metadata WHERE content_key IS NOT NULL",
        )
        .all() as Array<{ content_key: string }>
    ).map((r) => r.content_key),
  );
  let examined = 0;
  let removed = 0;
  for (const dir of [dirs.objects, dirs.staging]) {
    for await (const entry of await fs.opendir(dir)) {
      if (++examined > 500) return { examined: 500, removed };
      if (
        !entry.isFile() ||
        !/^[a-f0-9-]{36}$/.test(entry.name) ||
        references.has(entry.name)
      )
        continue;
      const file = path.join(dir, entry.name);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || now - stat.mtimeMs < 24 * 60 * 60 * 1000) continue;
      await fs.unlink(file);
      removed++;
    }
  }
  return { examined, removed };
}
