# File Browser Example Plugin

Example Paperclip plugin that demonstrates:

- **projectSidebarItem** — A "Files" link under each project in the sidebar that opens the project detail with this plugin’s tab selected.
- **detailTab** (entityType project) — A project detail tab with a workspace-path selector, a desktop two-column layout (file tree left, editor right), and a mobile one-panel flow with a back button from editor to file tree, including save support.

## Slots

| Slot                | Type                | Description                                      |
|---------------------|---------------------|--------------------------------------------------|
| Files (sidebar)     | `projectSidebarItem`| Link under each project → project detail + tab. |
| Files (tab)         | `detailTab`         | Responsive tree/editor layout with save support.|

## Capabilities

- `ui.sidebar.register` — project sidebar item
- `ui.detailTab.register` — project detail tab
- `projects.read` — resolve project
- `project.workspaces.read` — list workspaces and read paths for file access

## Worker

- **getData `workspaces`** — `ctx.projects.listWorkspaces(projectId, companyId)` (ordered, primary first).
- **getData `fileList`** — `{ projectId, workspaceId, directoryPath? }` → list directory entries for the workspace root or a subdirectory (Node `fs`).
- **getData `fileContent`** — `{ projectId, workspaceId, filePath }` → read file content using workspace-relative paths (Node `fs`).
- **performAction `writeFile`** — `{ projectId, workspaceId, filePath, content }` → write the current editor buffer back to disk.

## Local Install (Dev)

From the repo root, build the plugin and install it by local path:

```bash
pnpm --filter @paperclipai/plugin-file-browser-example build
pnpm paperclipai plugin install ./packages/plugins/examples/plugin-file-browser-example
```

To uninstall:

```bash
pnpm paperclipai plugin uninstall paperclip-file-browser-example --force
```

**Local development notes:**

- **Build first.** The host resolves the worker from the manifest `entrypoints.worker` (e.g. `./dist/worker.js`). Run `pnpm build` in the plugin directory before installing so the worker file exists.
- **Reinstall after pulling.** If you installed a plugin by local path before the server stored `package_path`, the plugin may show status **error** (worker not found). Uninstall and install again so the server persists the path and can activate the plugin.
- Optional: use `paperclip-plugin-dev-server` for UI hot-reload with `devUiUrl` in plugin config.

## Structure

- `src/manifest.ts` — manifest with `projectSidebarItem` and `detailTab` (entityTypes `["project"]`).
- `src/worker.ts` — data handlers for workspaces, file list, file content.
- `src/ui/index.tsx` — `FilesLink` (sidebar) and `FilesTab` (workspace path selector + two-panel file tree/editor).
