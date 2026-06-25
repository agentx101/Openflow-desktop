type BrandAnalysisInput = {
  companyName?: string;
  brandName?: string;
  industry?: string;
  productsServices?: string[];
  targetAudience?: string;
};

export type RedditFinding = {
  text: string;
  sourceUrl: string;
  sourceTitle: string;
  score: number;
  subreddit: string;
  type: "post" | "comment";
  author?: string;
};

export type PersonaNeedEmotion = {
  persona: string;
  need: string;
  emotion: string;
  evidence: string[];
};

const APIFY_BASE = "https://api.apify.com/v2";
const APIFY_ACTOR_IDS = [
  "tW0tdmu7XAIoNezk2",
  "harshmaur~reddit-scraper-pro",
  "harshmaur~reddit-scraper",
  "trudax~reddit-scraper",
  "epctex~reddit-scraper"
];
const PULLPUSH_BASE = "https://api.pullpush.io/reddit";
const FETCH_TIMEOUT_MS = 12000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function defaultQueries(brand: BrandAnalysisInput): { queries: string[]; subreddits: string[] } {
  const company = (brand.companyName || brand.brandName || "").trim();
  const products = (brand.productsServices || []).slice(0, 3);
  const queries = new Set<string>();
  for (const p of products) {
    const short = String(p).replace(/[()[\]{}"']/g, "").trim();
    if (!short) continue;
    queries.add(`${short} review`);
    queries.add(`best ${short}`);
    queries.add(`${short} worth it`);
    queries.add(`${short} recommendation`);
  }
  if (company) {
    queries.add(`${company} review`);
    queries.add(`${company} experience`);
  }
  const industry = String(brand.industry || "").toLowerCase();
  const subreddits = industry.includes("beauty")
    ? ["SkincareAddiction", "beauty", "30PlusSkinCare", "AsianBeauty"]
    : ["BuyItForLife", "Frugal", "reviews", "productivity"];
  return { queries: Array.from(queries).slice(0, 15), subreddits };
}

async function scrapeViaApify(queries: string[], subreddits: string[], apiToken: string): Promise<RedditFinding[]> {
  const findings: RedditFinding[] = [];
  const seen = new Set<string>();
  const startUrls = new Set<string>();
  for (const sub of subreddits.slice(0, 10)) {
    for (const q of queries.slice(0, 4)) {
      startUrls.add(`https://www.reddit.com/r/${encodeURIComponent(sub)}/search/?q=${encodeURIComponent(q)}&sort=new&t=year`);
    }
  }
  for (const q of queries.slice(0, 8)) {
    startUrls.add(`https://www.reddit.com/search/?q=${encodeURIComponent(q)}&sort=new&t=year`);
  }

  for (const actorId of APIFY_ACTOR_IDS) {
    try {
      const runRes = await fetchWithTimeout(`${APIFY_BASE}/acts/${actorId}/runs?token=${apiToken}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          searchSort: "new",
          searchTime: "year",
          startUrls: Array.from(startUrls).slice(0, 40).map((url) => ({ url })),
          maxPostsCount: 160,
          maxCommentsCount: 160,
          maxCommentsPerPost: 20,
          maxCommunitiesCount: 20,
          proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] }
        })
      });
      if (!runRes.ok) {
        if (runRes.status === 403 || runRes.status === 404) continue;
        return findings;
      }
      const runData = (await runRes.json()) as { data?: { id?: string; defaultDatasetId?: string } };
      const runId = runData.data?.id;
      if (!runId) continue;

      let status = "RUNNING";
      for (let i = 0; i < 60 && status === "RUNNING"; i += 1) {
        await sleep(3000);
        const statusRes = await fetchWithTimeout(`${APIFY_BASE}/actor-runs/${runId}?token=${apiToken}`);
        if (!statusRes.ok) continue;
        const statusData = (await statusRes.json()) as { data?: { status?: string } };
        status = String(statusData.data?.status || "UNKNOWN");
      }
      if (status !== "SUCCEEDED") continue;

      const datasetId = runData.data?.defaultDatasetId;
      if (!datasetId) continue;
      const itemsRes = await fetchWithTimeout(`${APIFY_BASE}/datasets/${datasetId}/items?token=${apiToken}&limit=500`);
      if (!itemsRes.ok) continue;
      const items = (await itemsRes.json()) as Array<Record<string, unknown>>;
      for (const item of items) {
      const dataType = String(item.dataType || "");
      const text = String(item.body || item.selftext || item.title || "").trim();
      if (text.length < 30 || text === "[deleted]" || text === "[removed]") continue;
      const snippet = text.slice(0, 1000);
      const key = snippet.slice(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);
      const permalink = String(item.permalink || item.url || item.postUrl || "");
      const sourceUrl = permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`;
      const subreddit = String(
        item.subreddit || item.parsedCommunityName || item.communityName || item.subreddit_name_prefixed || ""
      ).replace(/^r\//, "");
      const author = String(item.author || item.username || item.user || "");
        findings.push({
          text: snippet,
          sourceUrl,
          sourceTitle: String(item.title || item.postTitle || `Post in r/${subreddit || "unknown"}`),
          score: Number(item.upVotes || item.score || item.ups || 0),
          subreddit,
          type: dataType === "comment" || item.body ? "comment" : "post",
          author: author && author !== "[deleted]" ? author : undefined
        });
      }
      if (findings.length > 0) return findings;
    } catch {
      // try next actor
      continue;
    }
  }
  return findings;
}

async function scrapeViaPullPush(queries: string[]): Promise<RedditFinding[]> {
  const findings: RedditFinding[] = [];
  const seen = new Set<string>();
  for (const query of queries.slice(0, 8)) {
    try {
      const params = new URLSearchParams({ q: query, size: "50", sort: "desc", sort_type: "score" });
      const [subRes, comRes] = await Promise.all([
        fetchWithTimeout(`${PULLPUSH_BASE}/search/submission/?${params}`),
        fetchWithTimeout(`${PULLPUSH_BASE}/search/comment/?${params}`)
      ]);
      const submissions = subRes.ok ? ((await subRes.json()) as { data?: Array<Record<string, unknown>> }).data || [] : [];
      const comments = comRes.ok ? ((await comRes.json()) as { data?: Array<Record<string, unknown>> }).data || [] : [];
      for (const post of submissions) {
        const text = String(post.selftext || "").trim();
        if (text.length < 50 || text === "[deleted]" || text === "[removed]") continue;
        const snippet = text.slice(0, 1000);
        const key = snippet.slice(0, 100);
        if (seen.has(key)) continue;
        seen.add(key);
        const permalink = String(post.permalink || "");
        findings.push({
          text: snippet,
          sourceUrl: permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`,
          sourceTitle: String(post.title || "Reddit post"),
          score: Number(post.score || 0),
          subreddit: String(post.subreddit || ""),
          type: "post",
          author: String(post.author || "") || undefined
        });
      }
      for (const comment of comments) {
        const text = String(comment.body || "").trim();
        if (text.length < 30 || text === "[deleted]" || text === "[removed]") continue;
        const snippet = text.slice(0, 800);
        const key = snippet.slice(0, 100);
        if (seen.has(key)) continue;
        seen.add(key);
        const permalink = String(comment.permalink || "");
        findings.push({
          text: snippet,
          sourceUrl: permalink.startsWith("http")
            ? permalink
            : `https://www.reddit.com${permalink || `/r/${String(comment.subreddit || "unknown")}`}`,
          sourceTitle: `Comment in r/${String(comment.subreddit || "unknown")}`,
          score: Number(comment.score || 0),
          subreddit: String(comment.subreddit || ""),
          type: "comment",
          author: String(comment.author || "") || undefined
        });
      }
    } catch {
      // continue
    }
    await sleep(400);
  }
  return findings;
}

export async function runRedditScraper(input: {
  brandAnalysis?: BrandAnalysisInput;
  queries?: string[];
  subreddits?: string[];
}): Promise<{ findings: RedditFinding[]; queries: string[]; subreddits: string[] }> {
  const defaults = defaultQueries(input.brandAnalysis || {});
  const queries = (input.queries && input.queries.length ? input.queries : defaults.queries).slice(0, 15);
  const subreddits = (input.subreddits && input.subreddits.length ? input.subreddits : defaults.subreddits).slice(0, 10);
  const apifyToken = process.env.APIFY_API_TOKEN || "";
  let findings: RedditFinding[] = [];
  if (apifyToken) {
    findings = await scrapeViaApify(queries, subreddits, apifyToken);
  }
  if (findings.length < 20) {
    const pull = await scrapeViaPullPush(queries);
    const seen = new Set(findings.map((f) => f.text.slice(0, 100)));
    for (const p of pull) {
      const key = p.text.slice(0, 100);
      if (!seen.has(key)) findings.push(p);
    }
  }
  return { findings: findings.sort((a, b) => b.score - a.score), queries, subreddits };
}

function fallbackPersonaNeedEmotion(findings: RedditFinding[]): PersonaNeedEmotion[] {
  const text = findings.map((f) => f.text.toLowerCase()).join(" ");
  const sets: PersonaNeedEmotion[] = [];
  if (/price|expensive|budget|afford/.test(text)) {
    sets.push({
      persona: "Value-driven buyer",
      need: "Affordable quality without compromise",
      emotion: "Frustration",
      evidence: findings.slice(0, 3).map((f) => f.text.slice(0, 120))
    });
  }
  if (/sensitive|reaction|irritat|safe/.test(text)) {
    sets.push({
      persona: "Risk-averse evaluator",
      need: "Safety and proven reliability",
      emotion: "Anxiety",
      evidence: findings.slice(0, 3).map((f) => f.text.slice(0, 120))
    });
  }
  sets.push({
    persona: "Outcome-focused improver",
    need: "Visible results quickly",
    emotion: "Hope",
    evidence: findings.slice(0, 3).map((f) => f.text.slice(0, 120))
  });
  return sets.slice(0, 6);
}

async function llmPersonaNeedEmotion(
  brandAnalysis: BrandAnalysisInput,
  findings: RedditFinding[]
): Promise<PersonaNeedEmotion[] | null> {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) return null;
  const sample = findings.slice(0, 40).map((f, i) => `[${i + 1}] r/${f.subreddit}: ${f.text}`).join("\n");
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Return JSON with key `items` as an array of Persona-Need-Emotion objects: {persona, need, emotion, evidence:[short quotes]}. Keep 4-8 items."
          },
          {
            role: "user",
            content: `Brand: ${brandAnalysis.companyName || brandAnalysis.brandName || "Unknown"}\nIndustry: ${brandAnalysis.industry || "Unknown"}\nFindings:\n${sample}`
          }
        ]
      })
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as { items?: PersonaNeedEmotion[] };
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    return parsed.items.slice(0, 8);
  } catch {
    return null;
  }
}

export async function runPersonaNeedEmotion(input: {
  brandAnalysis?: BrandAnalysisInput;
  findings: RedditFinding[];
}): Promise<{ items: PersonaNeedEmotion[] }> {
  const brand = input.brandAnalysis || {};
  const llm = await llmPersonaNeedEmotion(brand, input.findings || []);
  if (llm) return { items: llm };
  return { items: fallbackPersonaNeedEmotion(input.findings || []) };
}

export function runPneFramework(input: {
  items: PersonaNeedEmotion[];
  limit?: number;
}): { pneCombos: Array<{ id: string; persona: string; need: string; emotion: string; confidence: number }> } {
  const list = (input.items || []).slice(0, Math.max(1, input.limit || 12));
  const pneCombos = list.map((item, idx) => ({
    id: `pne-${idx + 1}`,
    persona: item.persona,
    need: item.need,
    emotion: item.emotion,
    confidence: Math.max(0.55, 0.9 - idx * 0.05)
  }));
  return { pneCombos };
}
