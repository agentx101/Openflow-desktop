import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const serverPath = resolve(process.cwd(), "local-backend/server.ts");
const shellPath = resolve(process.cwd(), "public/command-center/Command Center.html");
const serverSource = readFileSync(serverPath, "utf8");
const shellSource = readFileSync(shellPath, "utf8");

describe("desktop local Reddit parity wiring", () => {
  it("reads Apify credentials from workspace connections or desktop settings", () => {
    expect(serverSource.includes('const workspaceApifyToken = getWorkspaceProviderToken(workspaceId, "apify");')).toBe(true);
    expect(serverSource.includes("settings.keys.apifyApiKey")).toBe(true);
  });

  it("returns structured Reddit metadata expected by the command-center UI", () => {
    expect(serverSource.includes("providerIssue,")).toBe(true);
    expect(serverSource.includes("insightMeta,")).toBe(true);
    expect(serverSource.includes("insightsLibrary: derived.insightsLibrary")).toBe(true);
    expect(serverSource.includes("nextRunAt")).toBe(true);
  });

  it("applies hosted-style no-new-insights and response dedupe semantics locally", () => {
    expect(serverSource.includes("deriveLocalRedditRunState({")).toBe(true);
    expect(serverSource.includes("shouldReusePreviousLocalRedditRun(")).toBe(true);
    expect(serverSource.includes("dedupeLocalRedditRunsForResponse(")).toBe(true);
  });

  it("exposes local persistence endpoints used by the Reddit and customer-brain UI flows", () => {
    expect(serverSource.includes('app.get("/workspaces/:workspaceId/reddit/runs"')).toBe(true);
    expect(serverSource.includes('app.get("/workspaces/:workspaceId/reddit/runs/:runId"')).toBe(true);
    expect(serverSource.includes('app.get("/workspaces/:workspaceId/reddit/insights-library"')).toBe(true);
    expect(serverSource.includes('app.get("/workspaces/:workspaceId/nodes/:nodeId/instructions"')).toBe(true);
    expect(serverSource.includes('app.post("/workspaces/:workspaceId/nodes/:nodeId/instructions"')).toBe(true);
    expect(serverSource.includes('app.get("/workspaces/:workspaceId/customer-brain/pne-state"')).toBe(true);
    expect(serverSource.includes('app.post("/workspaces/:workspaceId/customer-brain/insights"')).toBe(true);
    expect(serverSource.includes('app.put("/workspaces/:workspaceId/customer-brain/persona-items"')).toBe(true);
    expect(serverSource.includes('app.put("/workspaces/:workspaceId/customer-brain/pne-combos"')).toBe(true);
  });

  it("exposes local brand and presentation endpoints used by the desktop command-center shell", () => {
    expect(serverSource.includes('app.get("/workspaces/:workspaceId/brand-profile"')).toBe(true);
    expect(serverSource.includes('app.put("/workspaces/:workspaceId/brand-profile"')).toBe(true);
    expect(serverSource.includes('app.post("/workspaces/:workspaceId/brand-profile/analyze"')).toBe(true);
    expect(serverSource.includes('app.get("/workspaces/:workspaceId/presentation/brief-state"')).toBe(true);
    expect(serverSource.includes('app.put("/workspaces/:workspaceId/presentation/briefs"')).toBe(true);
    expect(serverSource.includes('app.put("/workspaces/:workspaceId/presentation/storyboards"')).toBe(true);
    expect(serverSource.includes('app.get("/workspaces/:workspaceId/presentation/storyboard-state"')).toBe(true);
    expect(serverSource.includes('app.get("/workspaces/:workspaceId/generation/strategy-packet"')).toBe(true);
  });

  it("builds local presentation packet payloads in the same shape the shell expects", () => {
    expect(serverSource.includes("function buildPresentationBriefState(")).toBe(true);
    expect(serverSource.includes("function buildPresentationStoryboardState(")).toBe(true);
    expect(serverSource.includes("function buildGenerationStrategyPacket(")).toBe(true);
    expect(serverSource.includes("structuredPrompt: compileStructuredGenerationPrompt(packet)")).toBe(true);
  });

  it("auto-derives starter presentation state when no saved local records exist yet", () => {
    expect(serverSource.includes("function synthesizeCreativeBriefs(")).toBe(true);
    expect(serverSource.includes("function synthesizeStoryboards(")).toBe(true);
    expect(serverSource.includes("const preferredSavedBriefs = preferExplicitPresentationArtifacts(savedBriefs);")).toBe(true);
    expect(serverSource.includes("const preferredSavedStoryboards = preferExplicitPresentationArtifacts(savedStoryboards);")).toBe(true);
    expect(serverSource.includes("autoDerivedFromCustomer: preferredSavedBriefs.length === 0 && briefs.length > 0")).toBe(true);
    expect(serverSource.includes("autoDerivedFromCustomer: preferredSavedStoryboards.length === 0 && storyboards.length > 0")).toBe(true);
    expect(serverSource.includes("function persistAutoDerivedPresentationArtifacts(")).toBe(true);
  });

  it("exposes an Apify API key field in the desktop settings modal", () => {
    expect(shellSource.includes('id="ks-apify"')).toBe(true);
    expect(shellSource.includes("apifyApiKey:document.getElementById('ks-apify').value||''")).toBe(true);
  });
});
