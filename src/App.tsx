import { FormEvent, useEffect, useMemo, useState } from "react";

type Provider = "google" | "github";

type PublicUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  provider?: "email" | Provider;
  workspaceId: string;
  onboardingCompleted: boolean;
  brandUrl?: string;
  entitlement: {
    mode: "community" | "pro" | "byok";
    openflowToken: string;
  };
  billing: {
    cycle: "monthly" | "yearly";
    plan: "standard" | "creator" | "pro";
    creditsRemaining: number;
    creditsTotal: number;
  };
};

type AuthState = {
  token: string;
  expiresAt: string;
  user: PublicUser;
};

type LauncherState = {
  localInitialized: boolean;
};

type ProviderAvailability = {
  google: { enabled: boolean };
  github: { enabled: boolean };
  email: { enabled: boolean };
};

const API_BASE = (import.meta.env.VITE_OPENFLOW_API_BASE as string | undefined)?.replace(/\/+$/, "") || "http://127.0.0.1:8787";
const AUTH_STORAGE_KEY = "openflow.desktop.auth.v2";
const LAUNCHER_STORAGE_KEY = "openflow.desktop.launcher.v1";
const DESKTOP_SETTINGS_STORAGE_KEY = "openflow.desktop.settings.v1";
const COMMAND_CENTER_URL = "/command-center/Command%20Center.html?v=20260623-auth";

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

async function fetchApi<T>(path: string, init: RequestInit = {}, token = ""): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const message = await res.text().catch(() => "");
    throw new Error(message || `Request failed (${res.status})`);
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

function normalizeAuthPayload(payload: { token?: string; expiresAt?: string; user?: PublicUser }): AuthState {
  if (!payload.token || !payload.expiresAt || !payload.user) throw new Error("Invalid auth response");
  return { token: payload.token, expiresAt: payload.expiresAt, user: payload.user };
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<AuthState | null>(() => readJson<AuthState>(AUTH_STORAGE_KEY));
  const [launcherState, setLauncherState] = useState<LauncherState>(() => readJson<LauncherState>(LAUNCHER_STORAGE_KEY) || { localInitialized: false });
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [brandUrl, setBrandUrl] = useState("");
  const [search, setSearch] = useState("");
  const [onboardingEnv, setOnboardingEnv] = useState<"new" | "cloud">("cloud");
  const [providerAvailability, setProviderAvailability] = useState<ProviderAvailability>({
    google: { enabled: false },
    github: { enabled: false },
    email: { enabled: true }
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.pathname === "/auth/callback") {
      const token = url.searchParams.get("token") || "";
      const oauthError = url.searchParams.get("error") || "";
      if (oauthError) setError(oauthError);
      if (token) {
        window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, expiresAt: "", user: null }));
      }
      window.history.replaceState({}, "", "/instances");
    }
    const boot = async () => {
      try {
        const providers = await fetchApi<ProviderAvailability>("/auth/providers", { method: "GET" });
        setProviderAvailability(providers);
      } catch {
        setProviderAvailability({
          google: { enabled: false },
          github: { enabled: false },
          email: { enabled: true }
        });
      }
      const cached = readJson<{ token?: string }>(AUTH_STORAGE_KEY);
      const token = String(cached?.token || "");
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const next = await fetchApi<{ token: string; expiresAt: string; user: PublicUser }>("/auth/me", { method: "GET" }, token);
        const normalized = normalizeAuthPayload(next);
        setAuth(normalized);
        writeJson(AUTH_STORAGE_KEY, normalized);
      } catch {
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
        setAuth(null);
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, []);

  const requiresOnboarding = Boolean(auth && !auth.user.onboardingCompleted);
  const visibleCards = useMemo(() => {
    const all = [
      { key: "new", title: "New Instance", kind: "new" as const },
      { key: "local", title: "Local Version", kind: "local" as const },
      { key: "cloud", title: "Cloud Version", kind: "cloud" as const }
    ];
    if (!launcherState.localInitialized) return all.filter((item) => item.kind !== "local");
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((item) => item.title.toLowerCase().includes(q));
  }, [launcherState.localInitialized, search]);

  function persistAuth(next: AuthState | null) {
    setAuth(next);
    if (!next) {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      return;
    }
    writeJson(AUTH_STORAGE_KEY, next);
  }

  function persistLauncher(next: LauncherState) {
    setLauncherState(next);
    writeJson(LAUNCHER_STORAGE_KEY, next);
  }

  async function submitEmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const path = authMode === "register" ? "/auth/email/register" : "/auth/email/login";
      const body =
        authMode === "register"
          ? { email: email.trim().toLowerCase(), password, name: name.trim() || email.split("@")[0] }
          : { email: email.trim().toLowerCase(), password };
      const data = await fetchApi<{ token: string; expiresAt: string; user: PublicUser }>(path, {
        method: "POST",
        body: JSON.stringify(body)
      });
      persistAuth(normalizeAuthPayload(data));
    } catch (authError: any) {
      setError(String(authError?.message || "Login failed"));
    } finally {
      setBusy(false);
    }
  }

  async function startOAuth(provider: Provider) {
    if (!providerAvailability[provider]?.enabled) {
      setError(`${provider[0].toUpperCase()}${provider.slice(1)} OAuth is not configured on backend yet.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const redirectTo = `${window.location.origin}/auth/callback`;
      const data = await fetchApi<{ authUrl: string }>(`/auth/oauth/${provider}/url`, {
        method: "POST",
        body: JSON.stringify({ redirectTo })
      });
      window.location.href = data.authUrl;
    } catch (oauthError: any) {
      setError(String(oauthError?.message || "OAuth start failed"));
      setBusy(false);
    }
  }

  async function completeOnboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetchApi<{ user: PublicUser }>(
        "/auth/onboarding",
        { method: "POST", body: JSON.stringify({ brandUrl: brandUrl.trim() }) },
        auth.token
      );
      const next = { ...auth, user: response.user };
      persistAuth(next);
      persistLauncher({ ...launcherState, localInitialized: true });
      openWorkspace(onboardingEnv === "new" ? "local" : "hosted", next);
    } catch (onboardError: any) {
      setError(String(onboardError?.message || "Onboarding failed"));
    } finally {
      setBusy(false);
    }
  }

  function openWorkspace(mode: "local" | "hosted", sessionOverride?: AuthState) {
    const current = sessionOverride || auth;
    if (!current) return;
    const settings = {
      entitlement: current.user.entitlement || { mode: "community", openflowToken: "" },
      keys: {
        openaiApiKey: "",
        anthropicApiKey: "",
        customAgentApiKey: "",
        elevenlabsApiKey: "",
        comfyApiBase: "",
        comfyApiKey: ""
      },
      integrations: {},
      billing: current.user.billing || {
        cycle: "yearly",
        plan: "standard",
        creditsRemaining: 50400,
        creditsTotal: 50400
      },
      runtime: {
        backendMode: mode,
        hostedApiBase: API_BASE,
        hostedWorkspaceId: current.user.workspaceId,
        hostedAuthToken: current.token
      }
    };
    writeJson(DESKTOP_SETTINGS_STORAGE_KEY, settings);
    window.localStorage.setItem("openflow.settingsApiBase", API_BASE);
    if (mode === "hosted") {
      window.localStorage.setItem("openflow.runtimeApiBase", API_BASE);
    } else {
      window.localStorage.removeItem("openflow.runtimeApiBase");
    }
    setShowWorkspace(true);
  }

  async function logout() {
    if (auth?.token) {
      try {
        await fetchApi("/auth/logout", { method: "POST" }, auth.token);
      } catch {
        // no-op
      }
    }
    persistAuth(null);
    setShowWorkspace(false);
  }

  if (loading) return <div className="boot">Loading Openflow…</div>;

  if (showWorkspace && auth) {
    return (
      <div className="app-frame">
        <div className="session-chip">
          <span className="session-dot" />
          <span>{auth.user.name}</span>
          <button className="session-btn" onClick={() => setShowWorkspace(false)} type="button">
            Switch Instance
          </button>
          <button className="session-btn" onClick={logout} type="button">
            Log out
          </button>
        </div>
        <iframe title="Openflow Command Center" src={COMMAND_CENTER_URL} className="command-center-frame" />
      </div>
    );
  }

  if (!auth) {
    const oauthDisabled = !providerAvailability.google.enabled && !providerAvailability.github.enabled;
    return (
      <main className="login-page">
        <section className="login-panel">
          <div className="brand brand-logo">
            <img src="/command-center/assets/openflow-logo.png" alt="Openflow" />
            <span>Openflow</span>
          </div>
          <h1>Log in to your account</h1>
          <p className="login-subtitle">Connect desktop local runtime with your cloud account and agents.</p>
          <div className="provider-buttons">
            <button
              type="button"
              className="provider-btn themed"
              disabled={busy || !providerAvailability.google.enabled}
              onClick={() => startOAuth("google")}
            >
              Continue with Google
            </button>
            <button
              type="button"
              className="provider-btn themed"
              disabled={busy || !providerAvailability.github.enabled}
              onClick={() => startOAuth("github")}
            >
              Continue with GitHub
            </button>
          </div>
          {oauthDisabled ? <p className="oauth-hint">OAuth providers are not configured on backend yet.</p> : null}
          <div className="divider">
            <span>or use email</span>
          </div>
          <form className="login-form" onSubmit={submitEmailAuth}>
            {authMode === "register" ? (
              <label>
                Full name
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
              </label>
            ) : null}
            <label>
              Work email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <button type="submit" className="signin-btn" disabled={busy}>
              {busy ? "Please wait…" : authMode === "register" ? "Create account" : "Log in"}
            </button>
            <button
              type="button"
              className="text-link-btn"
              onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
            >
              {authMode === "login" ? "New here? Create account" : "Already have an account? Log in"}
            </button>
          </form>
        </section>
        <section className="showcase-panel" aria-hidden="true">
          <div className="showcase-wrap">
            <div className="showcase-header">
              <h2>Ad Creative Engine</h2>
              <p>Bring local generation and hosted orchestration into one Openflow runtime.</p>
            </div>
            <div className="creative-stage">
              <div className="device-frame">
                <img src="/command-center/screenshots/hero.png" alt="" />
              </div>
              <article className="creative-card card-a">
                <img src="/command-center/assets/shots/brief.png" alt="" />
                <footer>
                  <strong>UGC Hook Variant</strong>
                  <span>CTR +18.2%</span>
                </footer>
              </article>
              <article className="creative-card card-b">
                <img src="/command-center/assets/shots/network.png" alt="" />
                <footer>
                  <strong>Problem-Solution Reel</strong>
                  <span>CAC -11.4%</span>
                </footer>
              </article>
              <article className="creative-card card-c">
                <img src="/command-center/assets/shots/agents.png" alt="" />
                <footer>
                  <strong>Testimonial Cutdown</strong>
                  <span>ROAS +23.0%</span>
                </footer>
              </article>
              <div className="stat-pill pill-a">6 assets in queue</div>
              <div className="stat-pill pill-b">2 videos rendering</div>
              <div className="stat-pill pill-c">11 concepts approved</div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="instance-page">
      {auth ? (
        <div className="auth-screen-actions">
          <button className="text-link-btn" type="button" onClick={logout}>
            Log out
          </button>
        </div>
      ) : null}
      <div className="instance-shell">
        <h1 className="instance-title">Openflow</h1>
        <div className="instance-search-wrap">
          <input
            className="instance-search"
            placeholder="Search for and open an instance"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="instance-grid">
          {visibleCards.map((card) => (
            <button
              key={card.key}
              className={`instance-card${
                (requiresOnboarding && card.kind === onboardingEnv) || (!requiresOnboarding && card.kind === "cloud")
                  ? " instance-card-highlighted"
                  : ""
              }`}
              type="button"
              onClick={() => {
                if (requiresOnboarding) {
                  if (card.kind === "new" || card.kind === "cloud") {
                    setOnboardingEnv(card.kind);
                  }
                  return;
                }
                if (card.kind === "new") {
                  persistLauncher({ ...launcherState, localInitialized: true });
                  openWorkspace("hosted");
                  return;
                }
                if (card.kind === "local") {
                  openWorkspace("local");
                  return;
                }
                openWorkspace("hosted");
              }}
            >
              <span className="instance-card-title">{card.title}</span>
            </button>
          ))}
        </div>

        {requiresOnboarding ? (
          <form className="onboarding-panel" onSubmit={completeOnboarding}>
            <h2>Set up your creative strategy workflow</h2>
            <label>
              Brand URL
              <input
                type="url"
                placeholder="https://yourbrand.com"
                value={brandUrl}
                onChange={(event) => setBrandUrl(event.target.value)}
                required
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <button type="submit" className="signin-btn" disabled={busy}>
              {busy ? "Setting up…" : 'Set up my "creative strategy workflow"'}
            </button>
          </form>
        ) : null}

        <div className="instance-footer">
        </div>
      </div>
    </main>
  );
}
