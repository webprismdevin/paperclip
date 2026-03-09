import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import type { DeploymentMode } from "@paperclipai/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface PluginManifest {
  name: string;
  id: string;
  displayName: string;
  version: string;
  nav?: { path: string };
  ui?: { slots: Array<{ type: string; id: string; exportName: string }> };
}

/**
 * Discover plugins in the plugins/ directory, run migrations, and mount routes.
 * Returns metadata about loaded plugins for the UI to consume.
 */
export async function loadPlugins(db: Db, deploymentMode?: DeploymentMode) {
  const pluginsDir = path.resolve(__dirname, "../../plugins");
  if (!fs.existsSync(pluginsDir)) return { router: Router(), plugins: [] };

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  const router = Router();
  const loaded: PluginManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = path.join(pluginsDir, entry.name);
    const manifestPath = path.join(pluginDir, "plugin.json");
    if (!fs.existsSync(manifestPath)) continue;

    const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    console.log(`[plugin] loading ${manifest.name} v${manifest.version}`);

    // Run migrations
    const migrationsDir = path.join(pluginDir, "db", "migrations");
    if (fs.existsSync(migrationsDir)) {
      await runPluginMigrations(db, manifest.name, migrationsDir);
    }

    // Mount server routes
    const serverEntry = path.join(pluginDir, "server", "index.ts");
    if (fs.existsSync(serverEntry)) {
      try {
        const mod = await import(serverEntry);
        const factory = mod.default ?? mod;
        const pluginRouter = factory({ db, Router, sql, deploymentMode });
        router.use(`/plugins/${manifest.name}`, pluginRouter);
        console.log(`[plugin] mounted routes at /api/plugins/${manifest.name}`);
      } catch (err) {
        console.error(`[plugin] failed to load server for ${manifest.name}:`, err);
      }
    }

    loaded.push(manifest);
  }

  // Expose plugin metadata for UI
  router.get("/plugins", (_req, res) => {
    res.json(loaded);
  });

  return { router, plugins: loaded };
}

async function runPluginMigrations(db: Db, pluginName: string, migrationsDir: string) {
  // Ensure migration tracking table exists
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS plugin_migrations (
      id SERIAL PRIMARY KEY,
      plugin_name TEXT NOT NULL,
      migration_name TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(plugin_name, migration_name)
    )
  `);

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    // Check if already applied
    const applied = await db.execute(
      sql`SELECT 1 FROM plugin_migrations WHERE plugin_name = ${pluginName} AND migration_name = ${file}`
    );
    const rows = Array.isArray(applied) ? applied : ((applied as any).rows ?? []);
    if (rows.length > 0) continue;

    const migration = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    console.log(`[plugin] running migration ${pluginName}/${file}`);
    await db.execute(sql.raw(migration));
    await db.execute(
      sql`INSERT INTO plugin_migrations (plugin_name, migration_name) VALUES (${pluginName}, ${file})`
    );
  }
}
