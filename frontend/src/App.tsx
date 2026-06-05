import { useEffect, useMemo, useState } from "react";
import { buildDynamicQuery, FilterPanel } from "./components/FilterPanel";
import { ALL_LANGUAGES } from "./constants/languages";
import {
  clearJobChannelCache,
  createJob,
  fetchJob,
  fetchJobChannels,
  fetchQuotaSummary,
  resolveApiUrl,
  runExport,
  runStage
} from "./lib/api";
import type {
  ChannelListItem,
  ChannelIntelligenceOutput,
  ChannelPageResponse,
  CreateJobInput,
  CreatorResult,
  FilterState,
  JobDetailResponse,
  QuotaSummary,
  ResultStatus
} from "./types";

const defaultFilters: FilterState = {
  keyword: "",
  content_type: "all",
  region: "",
  subscriber_min: "",
  subscriber_max: "",
  language: "",
  age: "",
  follower_min: "1000",
  engagement_min: "0",
  avg_views_min: "300",
  recent_activity: "",
  upload_frequency: "",
  selected_regions: [],
  selected_languages: []
};

type AppMode = "home" | "workspace";
type SortDirection = "asc" | "desc";
type SortKey =
  | "title"
  | "channel_title"
  | "subscribers"
  | "views"
  | "likes"
  | "comments"
  | "days_since_publish"
  | "engagement_rate"
  | "view_sub_ratio"
  | "avg_views"
  | "creator_score"
  | "pre_score"
  | "opportunity_tier"
  | "status";

const metricHelpText = {
  comment_rate: {
    label: "评论率",
    formula: "comments / max(views, 1)",
    meaning: "评论数占播放量的比例，越高通常说明观众更愿意表达观点。"
  },
  engagement_rate: {
    label: "互动率",
    formula: "(likes + comments * 2) / max(views, 1)",
    meaning: "综合点赞和评论的参与强度，其中评论权重更高。"
  },
  video_average_views: {
    label: "平均播放量",
    formula: "average(views)",
    meaning: "基于频道最近 10-20 条候选视频计算的平均播放量。"
  },
  relative_velocity: {
    label: "相对传播速度",
    formula: "views / days_since_publish / max(subscribers, 1)",
    meaning: "考虑发布时间和账号体量后的传播效率。"
  },
  opportunity_tier: {
    label: "机会层级",
    formula: "A >= 85，B >= 70，C >= 55，D < 55",
    meaning: "按 Pre Score 分层，帮助快速判断优先关注范围。"
  },
  pre_score: {
    label: "Pre Score",
    formula:
      "30*sub_fit_score + 30*view_sub_score + 20*engagement_score + 10*comment_score + 10*relative_velocity_score",
    meaning: "基于固定规则计算的预评分，用来优先发现相对表现更强的创作者。"
  },
  creator_score: {
    label: "Creator Score",
    formula: "50%*Avg Views Score + 30%*Engagement Score + 20%*Subscriber Score",
    meaning: "新的默认排序分数，优先反映频道真实流量能力、互动质量和粉丝基础。"
  }
} as const;

const stageLabelMap = {
  created: "已创建",
  search: "候选搜索",
  enrichment: "指标补全",
  channel_intelligence: "频道情报",
  pre_score: "预评分",
  shortlist: "已生成入围",
  export: "已导出",
  done: "完成",
  failed: "失败"
} as const;

const statusLabelMap: Record<ResultStatus, string> = {
  candidate: "候选",
  enriched: "已补全",
  pre_scored: "已预评分",
  shortlisted: "已入围",
  exported: "已导出",
  rejected: "已淘汰",
  failed: "失败"
};

const SEARCH_HISTORY_STORAGE_KEY = "creatortrack.searchHistory";
const FAVORITES_STORAGE_KEY = "creatortrack.favorites";

const quickStartSteps = [
  { title: "输入关键词", description: "输入产品、行业或内容主题关键词" },
  { title: "启动搜索任务", description: "自动拉取候选频道并补全核心指标" },
  { title: "查看高潜创作者", description: "发现表现优于体量的潜力创作者" },
  { title: "导出结果", description: "导出 XLSX 文件，便于团队协作" }
];

const REFINE_COUNTRY_OPTIONS = [
  { type: "group", label: "北美", values: ["US", "CA"] },
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { type: "group", label: "欧洲", values: ["GB", "FR", "DE", "ES", "IT", "PL"] },
  { value: "GB", label: "United Kingdom" },
  { value: "FR", label: "France" },
  { value: "DE", label: "Germany" },
  { value: "ES", label: "Spain" },
  { value: "IT", label: "Italy" },
  { value: "PL", label: "Poland" },
  { type: "group", label: "欧亚交界", values: ["RU", "TR"] },
  { value: "RU", label: "Russia" },
  { value: "TR", label: "Turkey" },
  { type: "group", label: "拉丁美洲", values: ["BR", "MX"] },
  { value: "BR", label: "Brazil" },
  { value: "MX", label: "Mexico" },
  { type: "group", label: "大洋洲", values: ["AU"] },
  { value: "AU", label: "Australia" },
  { type: "group", label: "亚洲（东亚 / 南亚 / 东南亚）", values: ["CN", "JP", "KR", "IN", "SG", "ID", "TH", "VN", "PH"] },
  { value: "CN", label: "China" },
  { value: "JP", label: "Japan" },
  { value: "KR", label: "South Korea" },
  { value: "IN", label: "India" },
  { value: "SG", label: "Singapore" },
  { value: "ID", label: "Indonesia" },
  { value: "TH", label: "Thailand" },
  { value: "VN", label: "Vietnam" },
  { value: "PH", label: "Philippines" }
] as const;

interface SearchHistoryItem {
  keyword: string;
  region: string;
  language: string;
  followers: string;
  createdAt: string;
}

interface FavoriteCreator {
  channel_id: string;
  channel_name: string;
  channel_url: string;
  avatar_url: string | null;
  country: string;
  language: string;
  subscribers: number;
}

function readStoredArray<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function formatHistoryTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "最近";
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  return `${Math.floor(diffHours / 24)} 天前`;
}

function Icon(props: { name: "search" | "history" | "star" | "export" | "trend" | "users" | "chart" | "plug" | "trash" | "x"; className?: string }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7v5l3 2" /></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2 7.5 14 3 9.6l6.2-.9L12 3Z" />,
    export: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 19h16" /></>,
    trend: <><path d="M3 17 9 11l4 4 8-8" /><path d="M15 7h6v6" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></>,
    chart: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 15v-4" /><path d="M12 15V8" /><path d="M16 15v-7" /></>,
    plug: <><path d="M9 7V3" /><path d="M15 7V3" /><path d="M6 11h12" /><path d="M8 7h8v5a4 4 0 0 1-8 0Z" /><path d="M12 16v5" /></>,
    trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 15h10l1-15" /></>,
    x: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>
  } as const;

  return (
    <svg className={props.className ?? "ui-icon"} viewBox="0 0 24 24" aria-hidden="true">
      {paths[props.name]}
    </svg>
  );
}

function MetricHelp(props: { metric: keyof typeof metricHelpText; placement?: "default" | "top" }) {
  const info = metricHelpText[props.metric];
  const text = `${info.label}\n公式：${info.formula}\n意义：${info.meaning}`;

  return (
    <span
      className={`metric-help ${props.placement === "top" ? "metric-help--top" : ""}`}
      aria-label={text}
      data-tooltip={text}
      tabIndex={0}
    >
      ?
    </span>
  );
}

function normalizeAvatarUrl(url: string): string {
  return url.replace("https://yt3.ggpht.com/", "https://yt3.googleusercontent.com/");
}

function ChannelAvatar(props: {
  url?: string | null;
  label: string;
  size: "row" | "detail";
}) {
  const [failed, setFailed] = useState(false);
  const initials = props.label.slice(0, props.size === "detail" ? 2 : 1).toUpperCase() || "?";

  useEffect(() => {
    setFailed(false);
  }, [props.url]);

  if (props.url && !failed) {
    return (
      <img
        className={props.size === "detail" ? "detail-avatar-image" : "row-avatar-image"}
        src={normalizeAvatarUrl(props.url)}
        alt={props.label}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  return <div className={props.size === "detail" ? "detail-avatar" : "row-avatar"}>{initials}</div>;
}

const REFINE_LANGUAGE_VALUES = ["en", "fr", "de", "es", "it", "pl", "ru", "tr", "zh", "ja", "ko", "hi", "id", "th", "vi", "tl", "ms"] as const;

const REFINE_LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  pl: "Polish",
  ru: "Russian",
  tr: "Turkish",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  hi: "Hindi",
  id: "Indonesian",
  th: "Thai",
  vi: "Vietnamese",
  tl: "Filipino",
  ms: "Malay"
};

const refineLanguages = REFINE_LANGUAGE_VALUES.map((value) => {
  const language = ALL_LANGUAGES.find((option) => option.value === value);
  return {
    value,
    label: REFINE_LANGUAGE_LABELS[value],
    aliases: language?.aliases ?? []
  };
});

function normalizeFilterText(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function countryAliasesForFilter(value: string): string[] {
  const option = REFINE_COUNTRY_OPTIONS.find((country) => "value" in country && country.value === value);
  const aliases = [value, option?.label ?? ""];
  if (value === "middle_east_arab") {
    aliases.push("United Arab Emirates", "Saudi Arabia", "Egypt", "Arab Countries", "AE", "SA", "EG");
  }
  return aliases.map(normalizeFilterText).filter(Boolean);
}

function languageAliasesForFilter(value: string): string[] {
  const refineOption = refineLanguages.find((language) => language.value === value);
  const option = ALL_LANGUAGES.find((language) => language.value === value);
  return [value, refineOption?.label ?? "", option?.label ?? "", ...(option?.aliases ?? [])].map(normalizeFilterText).filter(Boolean);
}

function channelMatchesSelectedCountries(channel: ChannelListItem, selectedCountries: string[]): boolean {
  if (!selectedCountries.length) return true;
  const representative = channel.representative;
  const channelValues = [
    channel.country,
    representative?.channel_country,
    representative?.channel_normalized_country
  ].map(normalizeFilterText);
  const selectedAliases = selectedCountries.flatMap(countryAliasesForFilter);
  return selectedAliases.some((alias) => channelValues.includes(alias));
}

function channelMatchesSelectedLanguages(channel: ChannelListItem, selectedLanguages: string[]): boolean {
  if (!selectedLanguages.length) return true;
  const representative = channel.representative;
  const channelValues = [
    channel.language,
    representative?.channel_language
  ].map(normalizeFilterText);
  const selectedAliases = selectedLanguages.flatMap(languageAliasesForFilter);
  return selectedAliases.some((alias) => channelValues.includes(alias));
}

function RefineFilterPanel(props: {
  filters: FilterState;
  total: number;
  onChange: (next: FilterState) => void;
}) {
  function setField<Key extends keyof FilterState>(key: Key, value: FilterState[Key]) {
    props.onChange({ ...props.filters, [key]: value });
  }

  function toggleArray(key: "selected_regions" | "selected_languages", value: string) {
    const current = props.filters[key];
    setField(key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function toggleCountryGroup(values: readonly string[]) {
    const isGroupSelected = values.every((value) => props.filters.selected_regions.includes(value));
    setField(
      "selected_regions",
      isGroupSelected
        ? props.filters.selected_regions.filter((value) => !values.includes(value))
        : [...new Set([...props.filters.selected_regions, ...values])]
    );
  }

  return (
    <aside className="refine-panel">
      <div className="refine-panel__header">
        <h3>Refine Channel List</h3>
        <p>Search always uses the raw keyword first. Everything below filters the channel set after results come back.</p>
        <span>{props.total} channels</span>
      </div>

      <details className="refine-group" open>
        <summary>Select regions</summary>
        <div className="refine-options">
          {REFINE_COUNTRY_OPTIONS.map((country) =>
            "value" in country ? (
              <label className="check-row" key={country.value}>
                <input
                  type="checkbox"
                  checked={props.filters.selected_regions.includes(country.value)}
                  onChange={() => toggleArray("selected_regions", country.value)}
                />
                <span>{country.label}</span>
              </label>
            ) : (
              <div className="refine-options__group" key={country.label}>
                <span>{country.label}</span>
                <button type="button" onClick={() => toggleCountryGroup(country.values)}>
                  {country.values.every((value) => props.filters.selected_regions.includes(value)) ? "取消" : "全选"}
                </button>
              </div>
            )
          )}
        </div>
      </details>

      <details className="refine-group">
        <summary>Select languages</summary>
        <div className="refine-options">
          {refineLanguages.map((language) => (
            <label className="check-row" key={language.value}>
              <input
                type="checkbox"
                checked={props.filters.selected_languages.includes(language.value)}
                onChange={() => toggleArray("selected_languages", language.value)}
              />
              <span>{language.label}</span>
            </label>
          ))}
        </div>
      </details>

      <div className="slider-group">
        <div className="slider-label"><span>Followers</span><strong>{formatCompactNumber(Number(props.filters.follower_min || 0))}+</strong></div>
        <input type="range" min="1000" max="1000000" step="1000" value={props.filters.follower_min} onChange={(event) => setField("follower_min", event.target.value)} />
        <div className="slider-scale"><span>1K</span><span>10K</span><span>50K</span><span>100K</span><span>500K</span><span>1M</span></div>
      </div>

      <div className="slider-group">
        <div className="slider-label"><span>Engagement Rate</span><strong>{Number(props.filters.engagement_min).toFixed(0)}%+</strong></div>
        <input type="range" min="0" max="15" step="0.5" value={props.filters.engagement_min} onChange={(event) => setField("engagement_min", event.target.value)} />
        <div className="slider-scale"><span>0%</span><span>5%</span><span>10%</span><span>15%</span></div>
      </div>

      <div className="slider-group">
        <div className="slider-label"><span>Average Views</span><strong>{formatCompactNumber(Number(props.filters.avg_views_min || 0))}+</strong></div>
        <input type="range" min="300" max="10000" step="100" value={props.filters.avg_views_min} onChange={(event) => setField("avg_views_min", event.target.value)} />
        <div className="slider-scale"><span>300</span><span>500</span><span>1K</span><span>5K</span><span>10K</span></div>
      </div>

      <label className="refine-select">
        <span>Recent Activity</span>
        <select value={props.filters.recent_activity} onChange={(event) => setField("recent_activity", event.target.value)}>
          <option value="">No limit</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </label>

      <label className="refine-select">
        <span>Upload Frequency</span>
        <select value={props.filters.upload_frequency} onChange={(event) => setField("upload_frequency", event.target.value)}>
          <option value="">No limit</option>
          <option value="156">3+ uploads/week</option>
          <option value="52">Weekly</option>
          <option value="12">Monthly</option>
        </select>
      </label>
    </aside>
  );
}

function DataPanel(props: {
  activePanel: "history" | "favorites" | null;
  searchHistory: SearchHistoryItem[];
  favorites: FavoriteCreator[];
  onClose: () => void;
  onClearHistory: () => void;
  onClearFavorites: () => void;
  onRemoveHistory: (keyword: string) => void;
  onRemoveFavorite: (channelId: string) => void;
  onRunHistory: (item: SearchHistoryItem) => void;
}) {
  if (!props.activePanel) return null;

  const isHistory = props.activePanel === "history";
  return (
    <div className="data-panel-backdrop" onClick={props.onClose}>
      <aside className="data-panel" onClick={(event) => event.stopPropagation()}>
        <header className="data-panel__header">
          <div>
            <h3>{isHistory ? "搜索历史" : "收藏夹"}</h3>
            <p>{isHistory ? "最近搜索会自动保存，可点击重新搜索。" : "收藏高潜创作者，便于后续跟进。"}</p>
          </div>
          <button type="button" className="icon-button" onClick={props.onClose} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>

        <div className="data-panel__body">
          {isHistory ? (
            props.searchHistory.length ? (
              props.searchHistory.map((item) => (
                <div className="panel-row" key={`${item.keyword}-${item.createdAt}`}>
                  <button type="button" className="panel-row__main" onClick={() => props.onRunHistory(item)}>
                    <Icon name="history" />
                    <span>
                      <strong>{item.keyword}</strong>
                      <em>{formatHistoryTime(item.createdAt)}</em>
                    </span>
                  </button>
                  <button type="button" className="icon-button" onClick={() => props.onRemoveHistory(item.keyword)} aria-label="删除搜索记录">
                    <Icon name="trash" />
                  </button>
                </div>
              ))
            ) : (
              <div className="panel-empty">暂无搜索历史。</div>
            )
          ) : props.favorites.length ? (
            props.favorites.map((item) => (
              <div className="panel-row" key={item.channel_id}>
                <a className="panel-row__main" href={item.channel_url} target="_blank" rel="noreferrer">
                  <ChannelAvatar url={item.avatar_url} label={item.channel_name} size="row" />
                  <span>
                    <strong>{item.channel_name}</strong>
                    <em>{item.country} · {item.language} · {formatCompactNumber(item.subscribers)} 粉丝</em>
                  </span>
                </a>
                <button type="button" className="icon-button" onClick={() => props.onRemoveFavorite(item.channel_id)} aria-label="取消收藏">
                  <Icon name="trash" />
                </button>
              </div>
            ))
          ) : (
            <div className="panel-empty">还没有收藏创作者。</div>
          )}
        </div>

        <footer className="data-panel__footer">
          <button type="button" onClick={isHistory ? props.onClearHistory : props.onClearFavorites}>
            清空{isHistory ? "历史" : "收藏"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const absoluteValue = Math.abs(value);
  const formatUnit = (divisor: number, unit: "K" | "M") => {
    const scaled = value / divisor;
    const decimals = Math.abs(scaled) < 10 && !Number.isInteger(scaled) ? 1 : 0;
    return `${scaled.toFixed(decimals).replace(/\.0$/, "")}${unit}`;
  };

  if (absoluteValue >= 1_000_000) {
    return formatUnit(1_000_000, "M");
  }
  if (absoluteValue >= 1_000) {
    return formatUnit(1_000, "K");
  }
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function compareValues(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
  direction: SortDirection
): number {
  const multiplier = direction === "asc" ? 1 : -1;

  if (typeof left === "number" || typeof right === "number") {
    const leftValue = typeof left === "number" ? left : Number.NEGATIVE_INFINITY;
    const rightValue = typeof right === "number" ? right : Number.NEGATIVE_INFINITY;
    return (leftValue - rightValue) * multiplier;
  }

  return String(left ?? "").localeCompare(String(right ?? ""), "zh-CN") * multiplier;
}

function sortResults(results: CreatorResult[], sortKey: SortKey, sortDirection: SortDirection): CreatorResult[] {
  return [...results].sort((left, right) => {
    const compared = compareValues(left[sortKey], right[sortKey], sortDirection);
    if (compared !== 0) return compared;
    return compareValues(left.creator_score, right.creator_score, "desc");
  });
}

function summarizeActionResult(action: string, payload: unknown): string {
  const data = payload as Record<string, unknown>;

  switch (action) {
    case "run-search":
      return `候选搜索完成，新增 ${data.candidate_count ?? 0} 条结果。`;
    case "run-enrichment":
      return `指标补全完成，视频 ${data.video_metric_count ?? 0} 条，频道 ${data.channel_metric_count ?? 0} 条。`;
    case "run-pre-score":
      return `预评分完成，已计算 ${data.scored_count ?? 0} 条，跳过 ${data.skipped_count ?? 0} 条。`;
    case "run-shortlist":
      return `入围生成完成，入围 ${data.shortlisted_count ?? 0} 条，淘汰 ${data.rejected_count ?? 0} 条。`;
    default:
      return "操作已完成。";
  }
}

export default function App() {
  const [mode, setMode] = useState<AppMode>("home");
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [jobData, setJobData] = useState<JobDetailResponse | null>(null);
  const [channelPage, setChannelPage] = useState<ChannelPageResponse | null>(null);
  const [selectedResult, setSelectedResult] = useState<CreatorResult | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelIntelligenceOutput | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotaSummary, setQuotaSummary] = useState<QuotaSummary | null>(null);
  const [showSearchOverlay, setShowSearchOverlay] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [favorites, setFavorites] = useState<FavoriteCreator[]>([]);
  const [activePanel, setActivePanel] = useState<"history" | "favorites" | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("creator_score");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  async function refreshQuotaSummary(): Promise<void> {
    try {
      const quota = await fetchQuotaSummary();
      setQuotaSummary(quota);
    } catch {
      setQuotaSummary(null);
    }
  }

  useEffect(() => {
    void refreshQuotaSummary();
  }, []);

  useEffect(() => {
    setSearchHistory(readStoredArray<SearchHistoryItem>(SEARCH_HISTORY_STORAGE_KEY));
    setFavorites(readStoredArray<FavoriteCreator>(FAVORITES_STORAGE_KEY));
  }, []);

  const channelQuery = useMemo(
    () => ({
      contentType: "all" as const,
      region: filters.region,
      regions: filters.selected_regions,
      language: filters.language === "other" ? "" : filters.language,
      languages: filters.selected_languages,
      minFollowers: filters.follower_min === "" ? null : Number(filters.follower_min),
      maxFollowers: filters.subscriber_max === "" ? null : Number(filters.subscriber_max),
      age: filters.age === "" ? null : Number(filters.age),
      minEngagementRate: filters.engagement_min === "" ? null : Number(filters.engagement_min) / 100,
      minAvgViews: filters.avg_views_min === "" ? null : Number(filters.avg_views_min),
      recentActivityDays: filters.recent_activity === "" ? null : Number(filters.recent_activity),
      minUploadFrequency: filters.upload_frequency === "" ? null : Number(filters.upload_frequency),
      page,
      pageSize,
      sortKey,
      sortDirection
    }),
    [
      filters.age,
      filters.avg_views_min,
      filters.engagement_min,
      filters.follower_min,
      filters.language,
      filters.recent_activity,
      filters.region,
      filters.selected_languages,
      filters.selected_regions,
      filters.subscriber_max,
      filters.upload_frequency,
      page,
      sortDirection,
      sortKey
    ]
  );

  useEffect(() => {
    setPage(1);
  }, [
    filters.age,
    filters.avg_views_min,
    filters.engagement_min,
    filters.follower_min,
    filters.language,
    filters.recent_activity,
    filters.region,
    filters.selected_languages,
    filters.selected_regions,
    filters.subscriber_max,
    filters.upload_frequency
  ]);

  useEffect(() => {
    if (!jobData?.job.id) {
      setChannelPage(null);
      setSelectedResult(null);
      setSelectedChannel(null);
      return;
    }

    let cancelled = false;
    setLoading((current) => (current === null ? "channels" : current));
    fetchJobChannels(jobData.job.id, channelQuery)
      .then((nextPage) => {
        if (cancelled) return;
        setChannelPage(nextPage);
        const first = nextPage.items[0] ?? null;
        setSelectedChannel((current) => nextPage.items.find((item) => item.channel_id === current?.channel_id) ?? first);
        setSelectedResult((current) => {
          const stillExists = nextPage.items.find((item) => item.representative?.id === current?.id);
          return stillExists?.representative ?? first?.representative ?? null;
        });
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "读取频道列表失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading((current) => (current === "channels" ? null : current));
      });

    return () => {
      cancelled = true;
    };
  }, [channelQuery, jobData?.job.id]);

  const filteredChannels = useMemo(
    () =>
      (channelPage?.items ?? []).filter(
        (channel) =>
          channelMatchesSelectedCountries(channel, filters.selected_regions) &&
          channelMatchesSelectedLanguages(channel, filters.selected_languages)
      ),
    [channelPage?.items, filters.selected_languages, filters.selected_regions]
  );
  const hasLocalRefineSelection = filters.selected_regions.length > 0 || filters.selected_languages.length > 0;
  const displayedChannelTotal = hasLocalRefineSelection ? filteredChannels.length : channelPage?.total ?? 0;
  const averageViewsByChannel = useMemo(() => {
    const buckets = new Map<string, { total: number; count: number }>();

    for (const result of jobData?.results ?? []) {
      if (!result.channel_id) continue;
      const current = buckets.get(result.channel_id) ?? { total: 0, count: 0 };
      current.total += result.views;
      current.count += 1;
      buckets.set(result.channel_id, current);
    }

    return buckets;
  }, [jobData?.results]);

  function formatAverageVideoViews(channelId: string, storedAvgViews?: number | null, fallbackViews?: number | null): string {
    if (storedAvgViews !== null && storedAvgViews !== undefined) return formatCompactNumber(Math.round(storedAvgViews));
    const bucket = averageViewsByChannel.get(channelId);
    if (bucket && bucket.count > 0) return formatCompactNumber(Math.round(bucket.total / bucket.count));
    return formatCompactNumber(fallbackViews);
  }

  function applyRefineFilters(nextFilters: FilterState) {
    setPage(1);
    setChannelPage(null);
    setSelectedChannel(null);
    setSelectedResult(null);
    setFilters(nextFilters);
  }

  function handleSort(nextKey: SortKey) {
    setPage(1);
    setSortDirection((currentDirection) => {
      if (sortKey === nextKey) return currentDirection === "asc" ? "desc" : "asc";
      return nextKey === "title" || nextKey === "channel_title" || nextKey === "status" || nextKey === "opportunity_tier" ? "asc" : "desc";
    });
    setSortKey(nextKey);
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  function persistSearchHistory(nextItems: SearchHistoryItem[]) {
    setSearchHistory(nextItems);
    window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(nextItems));
  }

  function persistFavorites(nextItems: FavoriteCreator[]) {
    setFavorites(nextItems);
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(nextItems));
  }

  function followerRangeLabel(nextFilters: FilterState): string {
    const min = nextFilters.subscriber_min || "不限";
    const max = nextFilters.subscriber_max || "不限";
    return `${min}-${max}`;
  }

  function rememberSearch(keyword: string, nextFilters: FilterState) {
    const item: SearchHistoryItem = {
      keyword,
      region: nextFilters.region || "全部国家",
      language: nextFilters.language || "全部语言",
      followers: followerRangeLabel(nextFilters),
      createdAt: new Date().toISOString()
    };
    const nextItems = [item, ...searchHistory.filter((entry) => entry.keyword.toLowerCase() !== keyword.toLowerCase())].slice(0, 12);
    persistSearchHistory(nextItems);
  }

  function removeSearchHistory(keyword: string) {
    persistSearchHistory(searchHistory.filter((entry) => entry.keyword !== keyword));
  }

  function runHistorySearch(item: SearchHistoryItem) {
    setActivePanel(null);
    void runDefaultPipeline(item.keyword);
  }

  function removeFavorite(channelId: string) {
    persistFavorites(favorites.filter((item) => item.channel_id !== channelId));
  }

  function isFavoriteChannel(channelId: string) {
    return favorites.some((item) => item.channel_id === channelId);
  }

  function favoritePayloadForChannel(channel: ChannelListItem): FavoriteCreator {
    return {
      channel_id: channel.channel_id,
      channel_name: channel.channel_name || channel.channel_id,
      channel_url: channel.channel_url,
      avatar_url: channel.representative?.channel_avatar_url ?? null,
      country: channel.country,
      language: channel.language,
      subscribers: channel.subscriber_count
    };
  }

  function toggleFavoriteChannel(channel: ChannelListItem) {
    if (isFavoriteChannel(channel.channel_id)) {
      removeFavorite(channel.channel_id);
      return;
    }

    persistFavorites([favoritePayloadForChannel(channel), ...favorites]);
  }

  async function refreshJob(jobId: string) {
    const detail = await fetchJob(jobId);
    setJobData(detail);
    return detail;
  }

  async function runDefaultPipeline(keywordOverride?: string) {
    const nextFilters = keywordOverride ? { ...filters, keyword: keywordOverride } : filters;
    const keyword = buildDynamicQuery(nextFilters);

    setLoading("search");
    setError(null);
    setMessage(null);

    try {
      const input: CreateJobInput = {
        keyword,
        lookback_days: nextFilters.age === "" ? 30 : Number(nextFilters.age),
        subscriber_min: nextFilters.subscriber_min === "" ? null : Number(nextFilters.subscriber_min),
        subscriber_max: nextFilters.subscriber_max === "" ? null : Number(nextFilters.subscriber_max),
        max_candidates: 50,
        shortlist_size: 50,
        minimum_pre_score: null,
        content_type: "all",
        region: "",
        language: ""
      };
      setFilters(nextFilters);
      const job = await createJob(input);
      clearJobChannelCache(job.id);
      await runStage(job.id, "run-search");
      await runStage(job.id, "run-enrichment");
      await runStage(job.id, "run-pre-score");
      await refreshJob(job.id);
      await refreshQuotaSummary();
      rememberSearch(keyword, nextFilters);
      setMode("workspace");
      setShowSearchOverlay(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "搜索失败，请稍后重试。");
    } finally {
      setLoading(null);
    }
  }

  async function handleStage(action: "run-shortlist") {
    if (!jobData) return;
    setLoading(action);
    setError(null);
    setMessage(null);

    try {
      const payload = await runStage(jobData.job.id, action);
      clearJobChannelCache(jobData.job.id);
      await refreshJob(jobData.job.id);
      setMessage(summarizeActionResult(action, payload));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试。");
    } finally {
      setLoading(null);
    }
  }

  async function handleExport() {
    if (!jobData) return;
    setLoading("export");
    setError(null);
    setMessage(null);

    try {
      const result = await runExport(jobData.job.id, "xlsx");
      await refreshJob(jobData.job.id);
      const link = document.createElement("a");
      link.href = resolveApiUrl(result.download_url);
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setMessage("XLSX 导出已生成。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败，请稍后重试。");
    } finally {
      setLoading(null);
    }
  }

  const currentStage = jobData ? stageLabelMap[jobData.job.stage] ?? jobData.job.stage : "未开始";
  const currentKeyword = jobData?.job.keyword ?? "未运行任务";

  if (mode === "home") {
    return (
      <div className="landing-shell">
        <div className="landing-grid" />
        <div className="landing-glow landing-glow--left" />
        <div className="landing-glow landing-glow--right" />
        <div className="landing-glow landing-glow--bottom" />
        <div className="landing-particle landing-particle--one" />
        <div className="landing-particle landing-particle--two" />
        <div className="landing-particle landing-particle--three" />

        <header className="landing-nav">
          <div className="landing-brand">
            <div className="landing-brand__mark">C</div>
            <span>CreatorTrack</span>
          </div>
          <nav className="landing-nav__links" aria-label="主导航">
            <button type="button" className="landing-nav__link landing-nav__link--active">工作台</button>
            <button type="button" className="landing-nav__link" onClick={() => setActivePanel("history")}>搜索历史</button>
            <button type="button" className="landing-nav__link" onClick={() => setActivePanel("favorites")}>收藏夹</button>
          </nav>
          <div className="landing-quota">
            <span>API 配额</span>
            <strong>{quotaSummary ? `${quotaSummary.used_units.toLocaleString("zh-CN")} / ${quotaSummary.daily_limit.toLocaleString("zh-CN")}` : "-- / --"}</strong>
            <div className="landing-quota__track">
              <div className="landing-quota__bar" style={{ width: `${quotaSummary?.percent_used ?? 0}%` }} />
            </div>
            <div className="landing-user">U</div>
          </div>
        </header>

        <main className="landing-main">
          <section className="landing-hero">
            <div className="landing-copy">
              <h1>发现值得合作的 <span>YouTube</span> 创作者</h1>
              <p>基于数据洞察，找到近期表现优于体量的潜力创作者，加速品牌增长</p>
            </div>

            <section className="landing-search-card">
              <div className="landing-primary-search">
                <input
                  value={filters.keyword}
                  onChange={(event) => setFilters({ ...filters, keyword: event.target.value })}
                  placeholder="输入关键词搜索 YouTube 创作者、频道或内容主题..."
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void runDefaultPipeline();
                    }
                  }}
                />
                <button type="button" onClick={() => void runDefaultPipeline()} disabled={loading === "search"}>
                  {loading === "search" ? "搜索中" : "搜索"}
                </button>
              </div>

              <FilterPanel
                filters={filters}
                loading={loading === "search"}
                onChange={setFilters}
                onSearch={() => void runDefaultPipeline()}
                showSearch={false}
                showFilters={false}
              />

            </section>
            {jobData ? (
              <div className="landing-return">
                <button type="button" className="landing-return__button" onClick={() => setMode("workspace")}>
                  返回工作台
                </button>
                <div className="landing-return__text">当前保留任务：{jobData.job.keyword}</div>
              </div>
            ) : null}
            {error ? <div className="error-banner" style={{ marginTop: 18 }}>{error}</div> : null}
          </section>

          <section className="landing-bottom-grid">
            <div className="landing-card recent-card">
              <div className="landing-card__header">
                <h2>最近搜索</h2>
                <button type="button" onClick={() => setActivePanel("history")}>查看全部 ›</button>
              </div>
              <div className="recent-list">
                {(searchHistory.length ? searchHistory.slice(0, 4) : [
                  { keyword: "AI Tools Review", region: "美国", language: "English", followers: "10K-500K", createdAt: new Date().toISOString() },
                  { keyword: "Tech Channels", region: "英国", language: "English", followers: "50K-1M", createdAt: new Date().toISOString() },
                  { keyword: "Productivity Tips", region: "加拿大", language: "English", followers: "10K-500K", createdAt: new Date().toISOString() }
                ]).map((item) => (
                  <button type="button" className="recent-item" key={item.keyword} onClick={() => void runDefaultPipeline(item.keyword)}>
                    <Icon name="search" className="recent-item__icon" />
                    <strong>{item.keyword}</strong>
                    <em>{formatHistoryTime(item.createdAt)}</em>
                  </button>
                ))}
              </div>
            </div>

            <div className="landing-card quick-card">
              <h2>快速开始</h2>
              <div className="quick-list">
                {quickStartSteps.map((item, index) => (
                  <div className="quick-item" key={item.title}>
                    <span><Icon name={index === 0 ? "search" : index === 1 ? "trend" : index === 2 ? "users" : "export"} /></span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="landing-feature-row" aria-label="产品能力">
            <div><strong>精准数据洞察</strong><span>多维度数据分析</span></div>
            <div><strong>实时更新</strong><span>每日数据更新</span></div>
            <div><strong>智能评分</strong><span>Creator Score 机会评估</span></div>
            <div><strong>相似推荐</strong><span>发现更多潜力创作者</span></div>
            <div><strong>一键导出</strong><span>支持 XLSX 格式</span></div>
          </section>
        </main>
        <DataPanel
          activePanel={activePanel}
          favorites={favorites}
          searchHistory={searchHistory}
          onClearFavorites={() => persistFavorites([])}
          onClearHistory={() => persistSearchHistory([])}
          onClose={() => setActivePanel(null)}
          onRemoveFavorite={removeFavorite}
          onRemoveHistory={removeSearchHistory}
          onRunHistory={runHistorySearch}
        />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      {showSearchOverlay ? (
        <div className="search-overlay" onClick={() => setShowSearchOverlay(false)}>
          <div className="search-overlay__panel" onClick={(event) => event.stopPropagation()}>
            <div className="search-overlay__title">新建搜索任务</div>
            <FilterPanel
              filters={filters}
              loading={loading === "search"}
              onChange={setFilters}
              onSearch={() => void runDefaultPipeline()}
              showFilters={false}
            />
          </div>
        </div>
      ) : null}

      <aside className="dashboard-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand__logo">✦</div>
          <div>
            <div className="sidebar-brand__title">CreatorTrack</div>
            <div className="sidebar-brand__meta">创作者情报工作台</div>
          </div>
        </div>

        <div className="sidebar-task">
          <span>当前任务：</span>
          <strong>{currentKeyword}</strong>
        </div>

        <div className="workspace-header-actions">
          <button type="button" className="dashboard-action" onClick={() => setActivePanel("history")}>
            历史
          </button>
          <button type="button" className="dashboard-action" onClick={() => setActivePanel("favorites")}>
            收藏
          </button>
          <button type="button" className="sidebar-primary-button" onClick={() => setShowSearchOverlay(true)}>
            ＋ 新建搜索
          </button>
          <button type="button" className="dashboard-action dashboard-action--primary" onClick={() => void handleExport()} disabled={!jobData || loading === "export"}>
            {loading === "export" ? "导出中..." : "导出 XLSX"}
          </button>
        </div>

        <nav className="sidebar-nav">
          <button type="button" className="sidebar-link sidebar-link--active">发现中心</button>
        </nav>

        <div className="quota-panel">
          <div className="quota-panel__label">API 额度</div>
          <div className="quota-panel__value">{quotaSummary ? `${quotaSummary.used_units} / ${quotaSummary.daily_limit}` : "-- / --"}</div>
          <div className="quota-panel__progress">
            <div className="quota-panel__progress-bar" style={{ width: `${quotaSummary?.percent_used ?? 0}%` }} />
          </div>
          <div className="quota-panel__meta">
            <span>剩余 {quotaSummary ? quotaSummary.remaining_units : "--"}</span>
            <span>{quotaSummary ? `${quotaSummary.percent_used.toFixed(1)}%` : "--"}</span>
          </div>
          <div className="quota-panel__date">
            {quotaSummary ? `按太平洋时间 ${quotaSummary.usage_date} 统计` : "读取中..."}
          </div>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="top-bar">
          <button type="button" className="dashboard-action dashboard-action--primary top-bar__home-button" onClick={() => setMode("home")}>
            首页
          </button>
          <div className="top-bar__actions">
            <button type="button" className="dashboard-action" onClick={() => void handleStage("run-shortlist")} disabled={!jobData || loading === "run-shortlist"}>
              {loading === "run-shortlist" ? "生成中..." : "生成入围"}
            </button>
            <button type="button" className="dashboard-action dashboard-action--primary top-bar__export-button" onClick={() => void handleExport()} disabled={!jobData || loading === "export"}>
              {loading === "export" ? "导出中..." : "导出 XLSX"}
            </button>
          </div>
        </header>

        <main className="dashboard-content">
          <section className="stat-grid">
            <div className="stat-panel">
              <div className="stat-panel__content">
                <div className="stat-label">频道总数</div>
                <div className="stat-value">{displayedChannelTotal}</div>
              </div>
              <div className="stat-panel__icon"><Icon name="chart" /></div>
            </div>
            <div className="stat-panel stat-panel--quota">
              <div className="stat-panel__content">
                <div className="stat-label">API 额度</div>
                <div className="stat-value">{quotaSummary ? `${quotaSummary.used_units} / ${quotaSummary.daily_limit}` : "-- / --"}</div>
              </div>
              <div className="stat-panel__icon"><Icon name="plug" /></div>
              <div className="quota-panel__progress">
                <div className="quota-panel__progress-bar" style={{ width: `${quotaSummary?.percent_used ?? 0}%` }} />
              </div>
            </div>
          </section>

          {message ? <div className="success-banner">{message}</div> : null}
          {error ? <div className="error-banner">{error}</div> : null}

          <div className="workspace-search-bar workspace-search-bar--global">
            <div className="workspace-search-field">
              <Icon name="search" />
              <input
                value={filters.keyword}
                onChange={(event) => setFilters({ ...filters, keyword: event.target.value })}
                placeholder="搜索关键词（如：slime rng, roblox, simulator...）"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runDefaultPipeline();
                  }
                }}
              />
            </div>
            <button type="button" onClick={() => void runDefaultPipeline()} disabled={loading === "search"}>
              {loading === "search" ? "搜索中..." : "搜索"}
            </button>
          </div>

          <section className="workspace-grid">
            <RefineFilterPanel
              filters={filters}
              total={displayedChannelTotal}
              onChange={applyRefineFilters}
            />

            <section className="workspace-panel workspace-panel--table">
              <div className="workspace-panel__header">
                <div>
                  <h2>候选结果</h2>
                  <p>当前显示第 {channelPage?.page ?? page} 页，共 {displayedChannelTotal} 个频道。</p>
                </div>
              </div>

              <div className="results-table-wrap">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th><span className="table-label">频道</span></th>
                      <th><span className="table-label">国家</span></th>
                      <th><span className="table-label">语言</span></th>
                      <th><span className="table-label">邮箱</span></th>
                      <th className="numeric"><button className="sort-button" onClick={() => handleSort("subscribers")}>粉丝{sortIndicator("subscribers")}</button></th>
                      <th className="numeric"><button className="sort-button" onClick={() => handleSort("engagement_rate")}>互动率<MetricHelp metric="engagement_rate" />{sortIndicator("engagement_rate")}</button></th>
                      <th className="numeric"><button className="sort-button" onClick={() => handleSort("avg_views")}>平均播放量<MetricHelp metric="video_average_views" />{sortIndicator("avg_views")}</button></th>
                      <th className="centered"><button className="sort-button sort-button--accent" onClick={() => handleSort("creator_score")}>Creator Score<MetricHelp metric="creator_score" placement="top" />{sortIndicator("creator_score")}</button></th>
                      <th className="centered"><span className="table-label">收藏</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChannels.map((channel) => {
                      const representative = channel.representative;
                      const isFavorite = isFavoriteChannel(channel.channel_id);
                      return (
                      <tr
                        key={channel.channel_id}
                        title={`${channel.channel_name || channel.channel_id} · ${formatCompactNumber(channel.subscriber_count)} followers · ${formatPercent(representative?.engagement_rate)} engagement · ${formatAverageVideoViews(channel.channel_id, representative?.avg_views, representative?.views)} avg views`}
                        onClick={() => {
                          setSelectedChannel(channel);
                          setSelectedResult(representative);
                        }}
                        className={selectedChannel?.channel_id === channel.channel_id ? "selected" : undefined}
                      >
                        <td>
                          <div className="channel-cell">
                            <ChannelAvatar
                              url={representative?.channel_avatar_url}
                              label={channel.channel_name || "?"}
                              size="row"
                            />
                            <div className="channel-cell__content">
                              <a
                                className="channel-cell__title"
                                href={channel.channel_url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {channel.channel_name || "-"}
                              </a>
                            </div>
                          </div>
                        </td>
                        <td>{channel.country || "无"}</td>
                        <td>{channel.language || "unknown"}</td>
                        <td className="email-cell">{channel.email || "-"}</td>
                        <td className="numeric">{formatCompactNumber(channel.subscriber_count)}</td>
                        <td className={`numeric ${((representative?.engagement_rate ?? 0) > 0.05 ? "metric-positive" : "")}`}>{formatPercent(representative?.engagement_rate)}</td>
                        <td className="numeric">{formatAverageVideoViews(channel.channel_id, representative?.avg_views, representative?.views)}</td>
                        <td className="centered"><span className={`score-pill ${selectedChannel?.channel_id === channel.channel_id ? "score-pill--selected" : ""}`}>{representative?.creator_score?.toFixed(0) ?? representative?.pre_score?.toFixed(0) ?? "-"}</span></td>
                        <td className="centered">
                          <button
                            type="button"
                            className={`favorite-star-button ${isFavorite ? "is-active" : ""}`}
                            aria-label={isFavorite ? "取消收藏创作者" : "收藏创作者"}
                            title={isFavorite ? "取消收藏" : "收藏创作者"}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleFavoriteChannel(channel);
                            }}
                          >
                            {isFavorite ? "★" : "☆"}
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="pagination-bar">
                <button
                  type="button"
                  className="dashboard-action"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1 || loading === "channels"}
                >
                  上一页
                </button>
                <span>
                  第 {page} / {Math.max(1, Math.ceil((channelPage?.total ?? 0) / pageSize))} 页
                </span>
                <button
                  type="button"
                  className="dashboard-action"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={loading === "channels" || page >= Math.max(1, Math.ceil((channelPage?.total ?? 0) / pageSize))}
                >
                  下一页
                </button>
              </div>
            </section>

          </section>
        </main>
      </div>
      <DataPanel
        activePanel={activePanel}
        favorites={favorites}
        searchHistory={searchHistory}
        onClearFavorites={() => persistFavorites([])}
        onClearHistory={() => persistSearchHistory([])}
        onClose={() => setActivePanel(null)}
        onRemoveFavorite={removeFavorite}
        onRemoveHistory={removeSearchHistory}
        onRunHistory={runHistorySearch}
      />
    </div>
  );
}
