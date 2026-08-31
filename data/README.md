# August 2026 evidence set

This directory contains the source-backed records rendered by Product Safety Signals.

- Review date: August 30, 2026
- Recall window: August 1–27, 2026, the latest CPSC announcement date available at review time
- Recall count: 52 (17 on August 6, 18 on August 13, 7 on August 20, and 10 on August 27)
- Primary recall evidence: CPSC's official recall CSV through August 20 plus the current CPSC recall index for August 27
- Public incident evidence: CPSC recall-notice incident narratives and attempted SaferProducts.gov public lookup
- U.S. public harm-news window: August 31, 2025–August 30, 2026
- Qualified pre-recall matches: 1 of 52; average and longest lead time are both 206 days
- Early-warning cases: 3, with Recall and Safety Alert actions kept separate
- Qualified past-year U.S. harm-news leads: 13 across 8 product categories

SaferProducts.gov returned HTTP 503 during review. CPSC notices often describe reports without publishing submission dates. Those records therefore use `reportDate: null` and explain the boundary instead of inferring a date.

Qualifying evidence must be independent public reporting about an actual consumer-product injury or death, published strictly before the relevant agency action, with a defensible product and hazard match. Recall- or alert-announcement coverage, same-day/post-action reporting, hazard-only stories, and ambiguous product matches are excluded from lead-time calculations. The separate past-year feed uses its own broader inclusion rule while preserving the same recall-coverage exclusion.

One Brookstone tabletop-fire-pit article qualified 206 days before the August 13 recall. A squishy-toy example precedes an August 5 category-level CPSC Safety Alert by 497 days; it is explicitly not a recall, the alert does not name NeeDoh, and the dashboard also links two additional independent pre-alert Axios reports. A CBS Minnesota report about a teen requiring emergency bowel surgery after swallowing a wire grill-brush bristle preceded the August 27 Cuisinart expansion by 58 days, but CBS did not identify the brush brand or model. It is therefore a lower-confidence category/hazard signal and is excluded from exact/probable-product recall averages.

The past-year feed retains 25 independent articles about U.S.-reported injuries or deaths across 15 product categories. International incidents are outside the primary feed. Every lead is labeled Pre-action, Post-action, or No linked action; timing labels describe sequence only and do not imply causation. The 16 no-linked-action leads include an as-of date, a bounded-search statement, and a suggested area for human analyst follow-up. “No linked CPSC action located in review” is not proof that no action exists and is not a recommendation that CPSC act.

The prominent recent-signals view is a four-lead subset covering August 17–30, 2026. Those records remain in the full past-year feed and do not replace it. Seven previously collected recall-announcement articles remain only as excluded-coverage audit records.

A confidence score measures match strength, not the truth of a report, defect, severity, causation, or influence on CPSC action. Lawsuit coverage reports allegations rather than adjudicated findings. The review was bounded and is not represented as global or exhaustive.

## News-search implementation

The search module implements the six-stage workflow: recall ingestion, entity normalization, query generation, candidate retrieval, candidate classification/ranking, and incident clustering. Harm vocabulary and hazard expansions live in `config/harm-taxonomy.json`. The provider interface supports broad retrieval and progressive page fetching without coupling qualification logic to one search vendor.

Search runs retain methodology, classifier, and query-generator versions; every audit record preserves queries, windows, URL/candidate/cluster counts, and the selected candidate. Query results, fetched content, and classifications use separate caches. Reviewer states and notes remain separate from model classification and are not overwritten by a new run.

The automated evaluation fixture covers all 52 bounded recalls and includes actual injury/death reporting, recall coverage, generic hazards, wrong products, local sources, post-recall reporting, and duplicate incidents. The qualification rule remains strict: actual harm, independent reporting, publication before recall, and a sufficient product match are all required.

Live on-demand retrieval uses Google News RSS, Bing News RSS, and GDELT DOC 2.0 behind the Site’s `/api/news-search` endpoint. Each provider is isolated so one failure does not suppress the others; successful responses are cached for 15 minutes. The endpoint deduplicates URLs, fetches the highest-ranked pages first, applies the same classifiers, clusters incidents, and returns explicit provider health and human-review warnings.
