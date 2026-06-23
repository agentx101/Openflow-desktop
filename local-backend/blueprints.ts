export type BlueprintConnection = {
  provider: string;
  authType: "oauth" | "api_key";
  scopes?: string[];
  tokenRef?: string;
};

export type NodeBlueprint = {
  id: string;
  category:
    | "brain_hub"
    | "brain_agent"
    | "source_connector"
    | "data_store"
    | "generation"
    | "publishing"
    | "performance"
    | "synth";
  kind: string;
  name: string;
  description: string;
  connection?: BlueprintConnection;
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  execution: {
    mode: "sync" | "async";
    retries: number;
    timeoutMs: number;
    idempotent: boolean;
  };
};

const EXEC_SYNC = { mode: "sync" as const, retries: 1, timeoutMs: 45_000, idempotent: true };
const EXEC_ASYNC = { mode: "async" as const, retries: 2, timeoutMs: 300_000, idempotent: true };

function bp(
  id: string,
  category: NodeBlueprint["category"],
  kind: NodeBlueprint["kind"],
  name: string,
  description: string,
  opts?: Partial<Pick<NodeBlueprint, "connection" | "inputs" | "outputs" | "execution">>
): NodeBlueprint {
  return {
    id,
    category,
    kind,
    name,
    description,
    execution: opts?.execution || (category === "generation" || category === "source_connector" || category === "publishing" ? EXEC_ASYNC : EXEC_SYNC),
    ...(opts?.connection ? { connection: opts.connection } : {}),
    ...(opts?.inputs ? { inputs: opts.inputs } : {}),
    ...(opts?.outputs ? { outputs: opts.outputs } : {})
  };
}

const BRAIN_HUBS: NodeBlueprint[] = [
  bp("brain_customer", "brain_hub", "brain_hub", "Customer Brain", "Customer understanding + emotions + triggers"),
  bp("brain_brand", "brain_hub", "brain_hub", "Brand Brain", "Positioning + voice + internal alignment"),
  bp("brain_presentation", "brain_hub", "brain_hub", "Presentation Brain", "Hooks, scripts, storyboard, CTA"),
  bp("brain_performance", "brain_hub", "brain_hub", "Performance Brain", "Outcomes, reallocation, next tests")
];

const BRAIN_AGENTS: NodeBlueprint[] = [
  "customer_reviews_agent,customer_social_agent,customer_tickets_agent,customer_support_agent,customer_interviews_agent,customer_surveys_agent,customer_objections_agent,customer_jtbd_agent",
  "brand_competitors_agent,brand_performance_context_agent,brand_guidelines_agent,brand_tone_agent,brand_positioning_agent,brand_messaging_agent,brand_ad_library_agent,brand_trends_agent",
  "presentation_formats_agent,presentation_hooks_agent,presentation_pacing_agent,presentation_scripts_agent,presentation_storyboards_agent,presentation_ctas_agent,presentation_thumbnails_agent,presentation_offers_agent",
  "perf_ad_spend_agent,perf_ctr_agent,perf_cac_agent,perf_roas_agent,perf_retention_agent,perf_attribution_agent,perf_cohorts_agent,perf_creative_fatigue_agent,perf_winners_agent,perf_losers_agent,perf_ga4_agent,perf_meta_agent"
]
  .join(",")
  .split(",")
  .filter(Boolean)
  .map((id) => bp(id, "brain_agent", "brain_agent", id, `Brain sub-agent: ${id}`));

const SOURCE_CONNECTORS: NodeBlueprint[] = [
  bp("src_reddit_scraper", "source_connector", "source_connector", "Reddit Scraper", "Scrape Reddit pain themes", {
    connection: { provider: "apify", authType: "api_key", tokenRef: "APIFY_API_TOKEN" }
  }),
  bp("src_amazon_reviews_scraper", "source_connector", "source_connector", "Amazon Reviews", "Ingest Amazon reviews", {
    connection: { provider: "apify", authType: "api_key", tokenRef: "APIFY_API_TOKEN" }
  }),
  bp("src_google_reviews_scraper", "source_connector", "source_connector", "Google Reviews", "Ingest Google business reviews", {
    connection: { provider: "google_places", authType: "api_key", tokenRef: "GOOGLE_PLACES_API_KEY" }
  }),
  bp("src_trustpilot_scraper", "source_connector", "source_connector", "Trustpilot Reviews", "Ingest Trustpilot reviews", {
    connection: { provider: "apify", authType: "api_key", tokenRef: "APIFY_API_TOKEN" }
  }),
  bp("src_facebook_comments_ingest", "source_connector", "source_connector", "Facebook Comments", "Ingest FB comments", {
    connection: { provider: "meta", authType: "oauth", scopes: ["pages_read_engagement"] }
  }),
  bp("src_support_tickets_ingest", "source_connector", "source_connector", "Support Tickets", "Ingest helpdesk tickets", {
    connection: { provider: "helpdesk", authType: "api_key", tokenRef: "HELPDESK_API_KEY" }
  }),
  bp("src_survey_ingest", "source_connector", "source_connector", "Survey Ingest", "Ingest surveys/forms", {
    connection: { provider: "typeform", authType: "api_key", tokenRef: "TYPEFORM_API_KEY" }
  }),
  bp("src_interview_transcripts_gdrive", "source_connector", "source_connector", "GDrive Transcripts", "Ingest transcript files from Drive", {
    connection: { provider: "google_drive", authType: "oauth", scopes: ["https://www.googleapis.com/auth/drive.readonly"] }
  }),
  bp("src_customer_quiz_ingest", "source_connector", "source_connector", "Customer Quiz", "Ingest quiz responses", {
    connection: { provider: "quiz", authType: "api_key", tokenRef: "QUIZ_API_KEY" }
  }),
  bp("src_slack_channel_reader", "source_connector", "source_connector", "Slack Reader", "Read configured Slack channels", {
    connection: { provider: "slack", authType: "oauth", scopes: ["channels:history", "channels:read"] }
  }),
  bp("src_notion_docs_ingest", "source_connector", "source_connector", "Notion Docs", "Ingest Notion docs", {
    connection: { provider: "notion", authType: "oauth" }
  }),
  bp("src_brand_docs_gdrive", "source_connector", "source_connector", "Brand Docs GDrive", "Ingest brand docs from Drive", {
    connection: { provider: "google_drive", authType: "oauth", scopes: ["https://www.googleapis.com/auth/drive.readonly"] }
  }),
  bp("src_competitor_ads_library_meta", "source_connector", "source_connector", "Meta Ads Library", "Ingest competitor ads library", {
    connection: { provider: "meta", authType: "oauth", scopes: ["ads_read"] }
  }),
  bp("src_paid_campaigns_ingest", "source_connector", "source_connector", "Paid Campaigns", "Ingest paid campaign metadata", {
    connection: { provider: "meta", authType: "oauth", scopes: ["ads_read"] }
  }),
  bp("src_motion_brand_reports", "source_connector", "source_connector", "Motion Brand Reports", "Ingest Motion reports", {
    connection: { provider: "motion", authType: "api_key", tokenRef: "MOTION_API_KEY" }
  }),
  bp("src_semrush_ingest", "source_connector", "source_connector", "SEMrush", "Ingest SEMrush data", {
    connection: { provider: "semrush", authType: "api_key", tokenRef: "SEMRUSH_API_KEY" }
  }),
  bp("src_gsc_ingest", "source_connector", "source_connector", "Google Search Console", "Ingest GSC data", {
    connection: { provider: "google_search_console", authType: "oauth", scopes: ["https://www.googleapis.com/auth/webmasters.readonly"] }
  }),
  bp("src_instagram_trends_ingest", "source_connector", "source_connector", "Instagram Trends", "Ingest Instagram trends", {
    connection: { provider: "instagram", authType: "oauth" }
  }),
  bp("src_tiktok_trends_ingest", "source_connector", "source_connector", "TikTok Trends", "Ingest TikTok trends", {
    connection: { provider: "tiktok", authType: "oauth" }
  }),
  bp("src_youtube_trends_ingest", "source_connector", "source_connector", "YouTube Trends", "Ingest YouTube trends", {
    connection: { provider: "youtube", authType: "oauth", scopes: ["https://www.googleapis.com/auth/youtube.readonly"] }
  }),
  bp("src_pinterest_trends_ingest", "source_connector", "source_connector", "Pinterest Trends", "Ingest Pinterest trends", {
    connection: { provider: "pinterest", authType: "oauth" }
  }),
  bp("src_meta_ad_creatives_ingest", "source_connector", "source_connector", "Meta Creative Ingest", "Ingest Meta creatives", {
    connection: { provider: "meta", authType: "oauth", scopes: ["ads_read"] }
  }),
  bp("src_tiktok_creative_center_ingest", "source_connector", "source_connector", "TikTok Creative Center", "Ingest TikTok Creative Center", {
    connection: { provider: "tiktok", authType: "oauth" }
  }),
  bp("src_motion_inspo_ingest", "source_connector", "source_connector", "Motion Inspiration", "Ingest Motion inspiration", {
    connection: { provider: "motion", authType: "api_key", tokenRef: "MOTION_API_KEY" }
  }),
  bp("src_competitor_creative_scraper", "source_connector", "source_connector", "Competitor Creative Scraper", "Ingest competitor creatives", {
    connection: { provider: "apify", authType: "api_key", tokenRef: "APIFY_API_TOKEN" }
  }),
  bp("src_creator_content_ingest", "source_connector", "source_connector", "Creator Content", "Ingest creator/UGC content", {
    connection: { provider: "creator_platform", authType: "api_key", tokenRef: "CREATOR_API_KEY" }
  }),
  bp("src_motion_analytics_ingest", "source_connector", "source_connector", "Motion Analytics", "Ingest Motion analytics", {
    connection: { provider: "motion", authType: "api_key", tokenRef: "MOTION_API_KEY" }
  }),
  bp("src_meta_ads_metrics_ingest", "source_connector", "source_connector", "Meta Ads Metrics", "Ingest Meta insights", {
    connection: { provider: "meta", authType: "oauth", scopes: ["ads_read"] }
  }),
  bp("src_google_ads_metrics_ingest", "source_connector", "source_connector", "Google Ads Metrics", "Ingest Google Ads metrics", {
    connection: { provider: "google_ads", authType: "oauth", scopes: ["https://www.googleapis.com/auth/adwords"] }
  }),
  bp("src_tiktok_ads_metrics_ingest", "source_connector", "source_connector", "TikTok Ads Metrics", "Ingest TikTok Ads metrics", {
    connection: { provider: "tiktok_ads", authType: "oauth" }
  }),
  bp("src_ga4_ingest", "source_connector", "source_connector", "GA4 Ingest", "Ingest GA4 metrics", {
    connection: { provider: "ga4", authType: "oauth", scopes: ["https://www.googleapis.com/auth/analytics.readonly"] }
  }),
  bp("src_meta_pixel_ingest", "source_connector", "source_connector", "Meta Pixel", "Ingest Meta pixel events", {
    connection: { provider: "meta_pixel", authType: "oauth" }
  }),
  bp("src_shopify_ingest", "source_connector", "source_connector", "Shopify Ingest", "Ingest Shopify commerce data", {
    connection: { provider: "shopify", authType: "oauth" }
  }),
  bp("src_klaviyo_ingest", "source_connector", "source_connector", "Klaviyo Ingest", "Ingest Klaviyo data", {
    connection: { provider: "klaviyo", authType: "api_key", tokenRef: "KLAVIYO_API_KEY" }
  }),
  bp("src_post_purchase_survey_ingest", "source_connector", "source_connector", "Post Purchase Survey", "Ingest post purchase survey", {
    connection: { provider: "survey", authType: "api_key", tokenRef: "SURVEY_API_KEY" }
  }),
  bp("src_landing_page_analytics_ingest", "source_connector", "source_connector", "Landing Analytics", "Ingest landing page analytics", {
    connection: { provider: "analytics", authType: "api_key", tokenRef: "ANALYTICS_API_KEY" }
  }),
  bp("src_youtube_analytics_ingest", "source_connector", "source_connector", "YouTube Analytics", "Ingest YouTube analytics", {
    connection: { provider: "youtube", authType: "oauth", scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"] }
  })
];

const DATA_STORES: NodeBlueprint[] =
  "db_customer_quotes,db_micro_moments,db_trigger_library,db_persona_segments,db_objection_library,db_brand_health_snapshots,db_positioning_matrix,db_message_pillars,db_competitor_claims,db_voice_guidelines,db_hooks_library,db_formats_library,db_scripts_library,db_storyboard_library,db_offer_frames,db_thumbstop_patterns,db_winning_creative_dna,db_prompt_library,db_generation_runs,db_asset_registry,db_policy_flags,db_campaign_calendar,db_budget_plan,db_launch_log,db_naming_taxonomy,db_kpi_timeseries,db_creative_scorecards,db_test_registry,db_fatigue_tracker,db_budget_reallocations,db_learning_loops"
    .split(",")
    .map((id) => bp(id, "data_store", "data_store", id, `Persistent store: ${id}`));

const GENERATION: NodeBlueprint[] = [
  bp("gen_router", "generation", "generation.template", "Generation Router", "Routes generation by policy", {
    connection: { provider: "comfy", authType: "api_key", tokenRef: "COMFY_API_KEY" }
  }),
  bp("gen_comfy_image_node", "generation", "generation.image", "Comfy Image", "Generate image via Comfy", {
    connection: { provider: "comfy", authType: "api_key", tokenRef: "COMFY_API_KEY" }
  }),
  bp("gen_comfy_video_node", "generation", "generation.video", "Comfy Video", "Generate video via Comfy", {
    connection: { provider: "comfy", authType: "api_key", tokenRef: "COMFY_API_KEY" }
  }),
  bp("gen_comfy_workflow_runner", "generation", "generation.template", "Comfy Workflow Runner", "Execute Comfy template", {
    connection: { provider: "comfy", authType: "api_key", tokenRef: "COMFY_API_KEY" }
  }),
  bp("gen_fal_image_node", "generation", "generation.image", "fal Image", "Generate image via fal", {
    connection: { provider: "fal", authType: "api_key", tokenRef: "FAL_KEY" }
  }),
  bp("gen_fal_video_node", "generation", "generation.video", "fal Video", "Generate video via fal", {
    connection: { provider: "fal", authType: "api_key", tokenRef: "FAL_KEY" }
  }),
  bp("gen_fal_upscale_node", "generation", "generation.image", "fal Upscale", "Upscale assets via fal", {
    connection: { provider: "fal", authType: "api_key", tokenRef: "FAL_KEY" }
  }),
  bp("gen_elevenlabs_voice_node", "generation", "generation.audio", "ElevenLabs Voice", "Generate voice assets", {
    connection: { provider: "elevenlabs", authType: "api_key", tokenRef: "ELEVENLABS_API_KEY" }
  }),
  bp("gen_elevenlabs_music_node", "generation", "generation.music", "ElevenLabs Music", "Generate music assets", {
    connection: { provider: "elevenlabs", authType: "api_key", tokenRef: "ELEVENLABS_API_KEY" }
  }),
  bp("gen_asset_qc_agent", "generation", "generation.template", "Asset QC Agent", "Validate generated assets"),
  bp("gen_variant_packager", "generation", "generation.template", "Variant Packager", "Package test-ready bundles")
];

const PUBLISHING: NodeBlueprint[] = [
  bp("pub_meta_ads_scheduler", "publishing", "publishing", "Meta Scheduler", "Schedule Meta campaigns", {
    connection: { provider: "meta", authType: "oauth", scopes: ["ads_management"] }
  }),
  bp("pub_google_ads_scheduler", "publishing", "publishing", "Google Ads Scheduler", "Schedule Google campaigns", {
    connection: { provider: "google_ads", authType: "oauth", scopes: ["https://www.googleapis.com/auth/adwords"] }
  }),
  bp("pub_tiktok_ads_scheduler", "publishing", "publishing", "TikTok Ads Scheduler", "Schedule TikTok campaigns", {
    connection: { provider: "tiktok_ads", authType: "oauth" }
  }),
  bp("pub_youtube_ads_scheduler", "publishing", "publishing", "YouTube Ads Scheduler", "Schedule YouTube campaigns", {
    connection: { provider: "youtube", authType: "oauth", scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"] }
  }),
  bp("pub_budget_allocator_agent", "publishing", "publishing", "Budget Allocator", "Allocate budget"),
  bp("pub_launch_rules_engine", "publishing", "publishing", "Launch Rules", "Apply launch controls"),
  bp("pub_utm_tagging_agent", "publishing", "publishing", "UTM Tagging", "Apply naming + UTMs"),
  bp("pub_creative_to_adset_mapper", "publishing", "publishing", "Creative Mapper", "Map variants to matrix")
];

const PERFORMANCE_NODES: NodeBlueprint[] = [
  bp("insight_feed_router", "performance", "performance", "Insight Feed Router", "Feed learnings back to brains"),
  bp("brief_synthesizer", "synth", "synth", "Brief Synthesizer", "Build strategic brief"),
  bp("creative_plan_synthesizer", "synth", "synth", "Creative Plan Synthesizer", "Build creative sprint plan")
];

export const NODE_BLUEPRINTS: NodeBlueprint[] = [
  ...BRAIN_HUBS,
  ...BRAIN_AGENTS,
  ...SOURCE_CONNECTORS,
  ...DATA_STORES,
  ...GENERATION,
  ...PUBLISHING,
  ...PERFORMANCE_NODES
];

export const DATA_STORE_BLUEPRINT_IDS = new Set(
  NODE_BLUEPRINTS.filter((bp) => bp.category === "data_store").map((bp) => bp.id)
);

export function getBlueprintById(id?: string) {
  if (!id) return undefined;
  return NODE_BLUEPRINTS.find((bp) => bp.id === id);
}
