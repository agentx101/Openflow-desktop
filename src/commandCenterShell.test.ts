import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shellPath = resolve(process.cwd(), "public/command-center/Command Center.html");
const shellSource = readFileSync(shellPath, "utf8");

function indexOfOrThrow(needle: string): number {
  const idx = shellSource.indexOf(needle);
  expect(idx, `Expected to find "${needle}" in command-center shell`).not.toBe(-1);
  return idx;
}

describe("desktop command center shell", () => {
  it("primes fallback before remote settings load", () => {
    const primeIdx = indexOfOrThrow("Promise.resolve(primeImmediateOnboardingFallbackFromContext())");
    const settingsIdx = indexOfOrThrow("return loadDesktopSettings();");
    expect(primeIdx).toBeLessThan(settingsIdx);
  });

  it("renders onboarding fallback immediately instead of waiting for full async hydration", () => {
    indexOfOrThrow("try{ renderAll(); }catch(_e){}");
    indexOfOrThrow(".then((primed)=>{");
    indexOfOrThrow("if(primed){");
    indexOfOrThrow("return loadDesktopSettings();");
  });

  it("flags Reddit provider issues even when onboarding insights are still visible", () => {
    indexOfOrThrow("if(providerIssue&&providerIssue.message) return 'ERR';");
    indexOfOrThrow("Latest run · provider issue · showing onboarding insights");
  });

  it("defines onboarding workspace bootstrap helper", () => {
    indexOfOrThrow("async function ensureOnboardingSeedWorkspace(){");
    indexOfOrThrow("primeImmediateOnboardingFallbackFromContext();");
  });

  it("uses timeout-bounded local API fetches", () => {
    indexOfOrThrow("const LOCAL_API_FETCH_TIMEOUT_MS = 1200;");
    indexOfOrThrow("async function fetchWithTimeout(url, opts, timeoutMs){");
    indexOfOrThrow("fetchWithTimeout(`${base}/settings`,{headers:settingsRequestHeaders()},900)");
    indexOfOrThrow("fetchWithTimeout(`${base}${path}`,opts,LOCAL_API_FETCH_TIMEOUT_MS)");
  });

  it("keeps starter fallback seed and derived handoff references separated", () => {
    const starterSeedIdx = indexOfOrThrow("function buildLocalOnboardingFallbackSeed(brandUrl){");
    const derivedBundleIdx = indexOfOrThrow("function buildCustomerLedPresentationBundle(customerState){");
    const firstSeedRefIdx = indexOfOrThrow("customerHandoff:starterCustomerHandoff");
    const derivedRefIdx = indexOfOrThrow("customerHandoff:handoff,");
    expect(firstSeedRefIdx).toBeGreaterThan(starterSeedIdx);
    expect(firstSeedRefIdx).toBeLessThan(derivedBundleIdx);
    expect(derivedRefIdx).toBeGreaterThan(derivedBundleIdx);
  });

  it("avoids legacy global onboarding state reads for first-load detection and preset limits", () => {
    expect(shellSource.includes("localStorage.getItem('openflow.onboarding.statusActive')==='1'")).toBe(false);
    expect(shellSource.includes("localStorage.getItem(ONBOARDING_GENERATE_COUNT_KEY)||'0'")).toBe(false);
    expect(shellSource.includes("return scope ? `${DESKTOP_SETTINGS_STORAGE_KEY}:${scope}` : DESKTOP_SETTINGS_STORAGE_KEY;")).toBe(false);
    expect(shellSource.includes("const legacyRaw=localStorage.getItem(DESKTOP_SETTINGS_STORAGE_KEY);")).toBe(false);
  });

  it("rebuilds onboarding project shell from scope instead of trusting an existing currentProjectId", () => {
    indexOfOrThrow("function expectedOnboardingProjectShell(){");
    indexOfOrThrow("configureInitialProjectShell();");
    expect(
      shellSource.includes("if(!currentProjectId){\n      configureInitialProjectShell();\n    }")
    ).toBe(false);
  });

  it("resets canvas scope before keeping a stale backend snapshot alive", () => {
    indexOfOrThrow("function resetCanvasForWorkspaceScope(workspaceId){");
    indexOfOrThrow("const workspaceChanged=Boolean(backendRunContext.workspaceId && backendRunContext.workspaceId!==workspaceId);");
    indexOfOrThrow("if(!applied && workspaceChanged){");
  });

  it("derives anonymous onboarding workspace ids instead of reusing stale hosted workspace settings", () => {
    indexOfOrThrow("function anonymousWorkspaceIdForScope(){");
    indexOfOrThrow("return scopeSeed ? `ws_public_${sanitizeProjectSlug(scopeSeed)}` : '';");
    indexOfOrThrow("if(hasExplicitOnboardingIntent()){\n    return seededWorkspaceId || anonymousWorkspaceId || '';\n  }");
    indexOfOrThrow("if(runtimeHostedToken && runtimeWorkspaceId) return runtimeWorkspaceId;");
  });

  it("clears stale domain state when workspace fetches succeed without content", () => {
    indexOfOrThrow("function clearBrandProfileState(sourceLabel){");
    indexOfOrThrow("function clearCustomerBrainState(sourceLabel){");
    indexOfOrThrow("function clearGenerationStrategyPacketState(sourceLabel){");
    indexOfOrThrow("function clearPresentationBriefState(sourceLabel){");
    indexOfOrThrow("function clearPresentationStoryboardState(sourceLabel){");
    indexOfOrThrow("clearBrandProfileState('empty workspace state');");
    indexOfOrThrow("clearCustomerBrainState('empty workspace state');");
    indexOfOrThrow("clearGenerationStrategyPacketState('empty workspace state');");
    indexOfOrThrow("clearPresentationBriefState('empty workspace state');");
    indexOfOrThrow("clearPresentationStoryboardState('empty workspace state');");
  });

  it("defers runtime workspace resets until backend state helpers are initialized", () => {
    indexOfOrThrow("let pendingRuntimeScopeReset=false;");
    indexOfOrThrow("function requestRuntimeScopeReset(){");
    indexOfOrThrow("function resetTransientWorkspaceRuntimeState(){");
    indexOfOrThrow("function flushPendingRuntimeScopeReset(){");
    indexOfOrThrow("requestRuntimeScopeReset();");
    indexOfOrThrow("flushPendingRuntimeScopeReset();");
  });

  it("gives brand and customer follow-up nodes richer seeded summaries", () => {
    indexOfOrThrow("function summarizeBrandKitProfile(profile,sourceLabel){");
    indexOfOrThrow("function summarizeBrandGuidelinesProfile(profile,sourceLabel){");
    indexOfOrThrow("Starter brand kit ready");
    indexOfOrThrow("Starter guidelines ready");
    indexOfOrThrow("Starter persona map ready");
    indexOfOrThrow("Starter PNE map ready");
  });

  it("surfaces brand context in brief and storyboard cards", () => {
    indexOfOrThrow("function presentationBrandContextPanel(profile,opts){");
    indexOfOrThrow("Brand Context");
    indexOfOrThrow("Storyboard will inherit this brand frame.");
    indexOfOrThrow("Brief is using this brand frame.");
  });

  it("guards brief and storyboard runs with local prerequisite messaging", () => {
    indexOfOrThrow("function presentationPrerequisiteMessage(outputId){");
    indexOfOrThrow("Shortlist Reddit insights first");
    indexOfOrThrow("Run Persona + Needs + Emotions first");
    indexOfOrThrow("Run PNE Framework first");
    indexOfOrThrow("Run Creative Brief first");
    indexOfOrThrow("Run Storyboard first");
    indexOfOrThrow("Configure Comfy API base in Settings");
    indexOfOrThrow("const prereqMessage=presentationPrerequisiteMessage(outputId);");
  });

  it("shows truthful generation provider readiness for the asset generator", () => {
    indexOfOrThrow("function generationProviderState(kind){");
    indexOfOrThrow("Hosted Comfy workflow workspace is attached.");
    indexOfOrThrow("Comfy endpoint is unreachable from this workspace.");
    indexOfOrThrow("Add an ElevenLabs API key in Settings to enable");
  });

  it("lets a primary PNE row drive the brief handoff", () => {
    indexOfOrThrow("function setPrimaryPneForBrief(event,nodeId,rowId){");
    indexOfOrThrow("Primary for brief");
    indexOfOrThrow("data-is-primary");
    indexOfOrThrow("activePneId");
  });

  it("surfaces the selected strategy route inside brief and storyboard", () => {
    indexOfOrThrow("function customerStrategyRoutePanel(customerHandoff,opts){");
    indexOfOrThrow("Selected Strategy Route");
    indexOfOrThrow("customerSummary");
    indexOfOrThrow("sourceRefs");
  });

  it("surfaces the selected brand route inside brief and storyboard", () => {
    indexOfOrThrow("function brandStrategyRoutePanel(brandContext,opts){");
    indexOfOrThrow("Selected Brand Route");
    indexOfOrThrow("Storyboard is inheriting this brand route.");
    indexOfOrThrow("Brief is using this brand route.");
  });

  it("shows the primary PNE route as the downstream brief handoff", () => {
    indexOfOrThrow("function pneRouteStatusPanel(summary,combos){");
    indexOfOrThrow("Primary PNE route");
    indexOfOrThrow("Feeds brief next");
    indexOfOrThrow("Storyboard after brief");
  });

  it("labels brief and storyboard revisions with explicit versions", () => {
    indexOfOrThrow("function presentationArtifactVersionTag(item,fallback){");
    indexOfOrThrow("saved brief");
    indexOfOrThrow("saved storyboard");
    indexOfOrThrow("count:presentationArtifactVersionTag(item,'BRF')");
    indexOfOrThrow("count:presentationArtifactVersionTag(item,'SB')");
  });

  it("renders persisted generation artifacts inside the asset generator review cards", () => {
    indexOfOrThrow("function assetArtifactCardMarkup(artifact,index){");
    indexOfOrThrow("function assetRunGalleryMarkup(run){");
    indexOfOrThrow("Latest outputs");
    indexOfOrThrow("more saved in this run");
    indexOfOrThrow("${assetRunGalleryMarkup(r)}");
  });
});
