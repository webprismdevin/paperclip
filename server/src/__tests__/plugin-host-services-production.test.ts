import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildHostServices } from "../services/plugin-host-services.js";
import { companyService } from "../services/companies.js";
import { agentService } from "../services/agents.js";
import { issueService } from "../services/issues.js";
import { logActivity } from "../services/activity-log.js";
import { projectService } from "../services/projects.js";
import { pluginRegistryService } from "../services/plugin-registry.js";
import type { Db } from "@paperclipai/db";
import type { PluginEventBus } from "../services/plugin-event-bus.js";

vi.mock("../services/companies.js");
vi.mock("../services/issues.js");
vi.mock("../services/activity-log.js");
vi.mock("../services/plugin-registry.js");
vi.mock("../services/plugin-state-store.js");
vi.mock("../services/plugin-secrets-handler.js");
vi.mock("../services/agents.js");
vi.mock("../services/projects.js");
vi.mock("../services/goals.js");
vi.mock("../services/activity.js");
vi.mock("../services/costs.js");
vi.mock("../services/assets.js");

/**
 * Helper: configure the registry mock so getCompanyAvailability returns
 * `{ available: true }` for the given companyIds (or all by default).
 */
function mockRegistryAvailability(
  enabledCompanyIds?: Set<string>,
) {
  (pluginRegistryService as any).mockReturnValue({
    getCompanyAvailability: vi.fn().mockImplementation(
      (companyId: string) => {
        const available = !enabledCompanyIds || enabledCompanyIds.has(companyId);
        return Promise.resolve({ available });
      },
    ),
    getConfig: vi.fn().mockResolvedValue(null),
  });
}

describe("buildHostServices production implementation", () => {
  let db: Db;
  let eventBus: PluginEventBus;
  const pluginId = "plugin-uuid";
  const pluginKey = "test.plugin";

  beforeEach(() => {
    db = {} as Db;
    eventBus = {
      forPlugin: vi.fn().mockReturnValue({
        emit: vi.fn(),
      }),
    } as any;
    vi.clearAllMocks();
    // Default: plugin is available for all companies
    mockRegistryAvailability();
  });

  it("delegates companies.list to companyService, filtered by availability", async () => {
    const mockList = vi.fn().mockResolvedValue([
      { id: "c1", name: "Acme" },
      { id: "c2", name: "Other" },
    ]);
    (companyService as any).mockReturnValue({ list: mockList });
    // Plugin enabled only for c1
    mockRegistryAvailability(new Set(["c1"]));

    const services = buildHostServices(db, pluginId, pluginKey, eventBus);
    const result = await services.companies.list({});

    expect(mockList).toHaveBeenCalled();
    expect(result).toEqual([{ id: "c1", name: "Acme" }]);
  });

  it("delegates issues.create to issueService and validates companyId", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: "i1", title: "New Issue" });
    (issueService as any).mockReturnValue({ create: mockCreate });

    const services = buildHostServices(db, pluginId, pluginKey, eventBus);

    // Should fail without companyId
    await expect(services.issues.create({ title: "No Co" } as any))
      .rejects.toThrow("companyId is required");

    // Should succeed with companyId
    const result = await services.issues.create({ companyId: "c1", title: "With Co" });
    expect(mockCreate).toHaveBeenCalledWith("c1", { companyId: "c1", title: "With Co" });
    expect(result).toEqual({ id: "i1", title: "New Issue" });
  });

  it("delegates activity.log to logActivity", async () => {
    const services = buildHostServices(db, pluginId, pluginKey, eventBus);

    await services.activity.log({
      companyId: "c1",
      message: "Something happened",
      entityType: "issue",
      entityId: "i1",
      metadata: { foo: "bar" }
    });

    expect(logActivity).toHaveBeenCalledWith(db, {
      companyId: "c1",
      actorType: "plugin",
      actorId: pluginId,
      action: "Something happened",
      entityType: "issue",
      entityId: "i1",
      details: { foo: "bar" }
    });
  });

  it("ensures companyId for projects.list", async () => {
    const mockList = vi.fn().mockResolvedValue([]);
    (projectService as any).mockReturnValue({ list: mockList });

    const services = buildHostServices(db, pluginId, pluginKey, eventBus);
    await expect(services.projects.list({} as any)).rejects.toThrow("companyId is required");
  });

  it("hides cross-company projects from direct reads", async () => {
    const mockGetById = vi.fn().mockResolvedValue({
      id: "p1",
      companyId: "c2",
      name: "Other company project",
    });
    const mockListWorkspaces = vi.fn().mockResolvedValue([{ id: "w1" }]);
    const mockGetPrimaryWorkspace = vi.fn().mockResolvedValue({ id: "w1" });
    (projectService as any).mockReturnValue({
      getById: mockGetById,
      listWorkspaces: mockListWorkspaces,
      getPrimaryWorkspace: mockGetPrimaryWorkspace,
    });

    const services = buildHostServices(db, pluginId, pluginKey, eventBus);

    await expect(
      services.projects.get({ projectId: "p1", companyId: "c1" }),
    ).resolves.toBeNull();
    await expect(
      services.projects.listWorkspaces({ projectId: "p1", companyId: "c1" }),
    ).resolves.toEqual([]);
    await expect(
      services.projects.getPrimaryWorkspace({ projectId: "p1", companyId: "c1" }),
    ).resolves.toBeNull();
    expect(mockListWorkspaces).not.toHaveBeenCalled();
    expect(mockGetPrimaryWorkspace).not.toHaveBeenCalled();
  });

  it("blocks cross-company issue mutations and hides comment reads", async () => {
    const mockGetById = vi.fn().mockResolvedValue({
      id: "i1",
      companyId: "c2",
      title: "Other company issue",
    });
    const mockUpdate = vi.fn();
    const mockListComments = vi.fn();
    const mockAddComment = vi.fn();
    (issueService as any).mockReturnValue({
      getById: mockGetById,
      update: mockUpdate,
      listComments: mockListComments,
      addComment: mockAddComment,
    });

    const services = buildHostServices(db, pluginId, pluginKey, eventBus);

    await expect(
      services.issues.get({ issueId: "i1", companyId: "c1" }),
    ).resolves.toBeNull();
    await expect(
      services.issues.listComments({ issueId: "i1", companyId: "c1" }),
    ).resolves.toEqual([]);
    await expect(
      services.issues.update({ issueId: "i1", patch: { title: "Nope" }, companyId: "c1" }),
    ).rejects.toThrow("Issue not found");
    await expect(
      services.issues.createComment({ issueId: "i1", body: "Hello", companyId: "c1" }),
    ).rejects.toThrow("Issue not found");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockListComments).not.toHaveBeenCalled();
    expect(mockAddComment).not.toHaveBeenCalled();
  });

  // ---- Regression tests: disabled plugin cannot access company data via RPC ----

  describe("company-availability enforcement in host services", () => {
    const enabledCompany = "c-enabled";
    const disabledCompany = "c-disabled";

    beforeEach(() => {
      mockRegistryAvailability(new Set([enabledCompany]));
    });

    it("disabled plugin cannot read issues for that company via worker RPC", async () => {
      const mockList = vi.fn().mockResolvedValue([]);
      const mockGetById = vi.fn().mockResolvedValue({ id: "i1", companyId: disabledCompany });
      const mockCreate = vi.fn().mockResolvedValue({ id: "i2" });
      (issueService as any).mockReturnValue({
        list: mockList,
        getById: mockGetById,
        create: mockCreate,
      });

      const services = buildHostServices(db, pluginId, pluginKey, eventBus);

      await expect(
        services.issues.list({ companyId: disabledCompany }),
      ).rejects.toThrow('not enabled for company');

      await expect(
        services.issues.get({ issueId: "i1", companyId: disabledCompany }),
      ).rejects.toThrow('not enabled for company');

      await expect(
        services.issues.create({ companyId: disabledCompany, title: "Sneaky" }),
      ).rejects.toThrow('not enabled for company');

      // Domain services should never be reached
      expect(mockList).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("disabled plugin cannot invoke agents for that company", async () => {
      const mockGetById = vi.fn().mockResolvedValue({ id: "a1", companyId: disabledCompany });
      const mockList = vi.fn().mockResolvedValue([]);
      (agentService as any).mockReturnValue({
        getById: mockGetById,
        list: mockList,
      });

      const services = buildHostServices(db, pluginId, pluginKey, eventBus);

      await expect(
        services.agents.list({ companyId: disabledCompany }),
      ).rejects.toThrow('not enabled for company');

      await expect(
        services.agents.get({ agentId: "a1", companyId: disabledCompany }),
      ).rejects.toThrow('not enabled for company');

      await expect(
        services.agents.invoke({ agentId: "a1", companyId: disabledCompany, prompt: "hack" }),
      ).rejects.toThrow('not enabled for company');

      expect(mockList).not.toHaveBeenCalled();
    });

    it("disabled plugin cannot access company details", async () => {
      (companyService as any).mockReturnValue({
        list: vi.fn().mockResolvedValue([
          { id: enabledCompany, name: "Enabled Co" },
          { id: disabledCompany, name: "Disabled Co" },
        ]),
        getById: vi.fn().mockResolvedValue({ id: disabledCompany, name: "Disabled Co" }),
      });

      const services = buildHostServices(db, pluginId, pluginKey, eventBus);

      // companies.list should only return enabled companies
      const listed = await services.companies.list({});
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe(enabledCompany);

      // companies.get should block disabled company
      await expect(
        services.companies.get({ companyId: disabledCompany }),
      ).rejects.toThrow('not enabled for company');
    });

    it("enabled plugin CAN access data for its enabled company", async () => {
      const mockList = vi.fn().mockResolvedValue([{ id: "i1", title: "OK" }]);
      (issueService as any).mockReturnValue({ list: mockList });

      const services = buildHostServices(db, pluginId, pluginKey, eventBus);

      const result = await services.issues.list({ companyId: enabledCompany });
      expect(result).toEqual([{ id: "i1", title: "OK" }]);
      expect(mockList).toHaveBeenCalledWith(enabledCompany, expect.anything());
    });

    it("disabled plugin cannot log activity for that company", async () => {
      const services = buildHostServices(db, pluginId, pluginKey, eventBus);

      await expect(
        services.activity.log({
          companyId: disabledCompany,
          message: "Sneaky log",
        }),
      ).rejects.toThrow('not enabled for company');

      expect(logActivity).not.toHaveBeenCalled();
    });

    it("disabled plugin cannot emit events for that company", async () => {
      const mockEmit = vi.fn();
      (eventBus.forPlugin as any).mockReturnValue({ emit: mockEmit });

      const services = buildHostServices(db, pluginId, pluginKey, eventBus);

      await expect(
        services.events.emit({ name: "test", companyId: disabledCompany, payload: {} }),
      ).rejects.toThrow('not enabled for company');

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
