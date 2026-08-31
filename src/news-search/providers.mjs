const decode = value => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = value => decode(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '');
const compactDate = (value, end = false) => `${value.replaceAll('-', '')}${end ? '235959' : '000000'}`;
const gdeltDate = value => { const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})/); return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined; };
const safeJson = async response => { try { return await response.json(); } catch { return {}; } };
const withinWindow = (date, window) => !date || (date >= window.start && date <= window.end);
const yahooRedirect = value => {
  const url = text(value);
  const match = url.match(/\/RU=([^/]+)\/RK=/i);
  if (!match) return url;
  try { return decodeURIComponent(match[1]); } catch { return url; }
};
const relativeDate = value => {
  const normalized = text(value).toLowerCase();
  const match = normalized.match(/(\d+)\s+(minute|hour|day|week)s?\s+ago/);
  if (!match) return undefined;
  const multiplier = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[match[2]];
  return new Date(Date.now() - Number(match[1]) * multiplier).toISOString().slice(0, 10);
};
const queryTerms = value => [...new Set(text(value).toLowerCase().match(/[a-z0-9]{4,}/g) || [])]
  .filter(term => !['after', 'before', 'injury', 'injured', 'death', 'killed', 'hospital', 'hospitalized', 'recall', 'consumer', 'product'].includes(term));

export class GoogleNewsRssProvider {
  constructor({ fetchImpl = fetch } = {}) { this.fetchImpl = fetchImpl; this.id = 'google_news_rss'; this.label = 'Google News RSS'; }
  async search({ query, window }) {
    const datedQuery = `${query} after:${window.start} before:${window.end}`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(datedQuery)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await this.fetchImpl(url, { headers: { 'user-agent': 'ProductSafetySignals/2.0' } });
    if (!response.ok) throw new Error(`Google News RSS returned ${response.status}`);
    const xml = await response.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 50).map((match, index) => {
      const item = match[1];
      const title = text(tag(item, 'title'));
      const publisher = text(tag(item, 'source')) || title.split(' - ').at(-1);
      return {
        id: `google_${index}`,
        provider: this.id,
        providerLabel: this.label,
        url: text(tag(item, 'link')),
        canonicalUrl: text(tag(item, 'link')),
        title,
        publisher,
        publicationDate: tag(item, 'pubDate') ? new Date(tag(item, 'pubDate')).toISOString().slice(0, 10) : undefined,
        text: `${title}. ${text(tag(item, 'description'))}`,
        locations: ['United States']
      };
    }).filter(item => item.url && item.title);
  }
}

export class BingNewsRssProvider {
  constructor({ fetchImpl = fetch } = {}) { this.fetchImpl = fetchImpl; this.id = 'bing_news_rss'; this.label = 'Bing News RSS'; }
  async search({ query, window }) {
    const datedQuery = `${query} after:${window.start} before:${window.end}`;
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(datedQuery)}&format=rss&setlang=en-US`;
    const response = await this.fetchImpl(url, { headers: { 'user-agent': 'ProductSafetySignals/2.0' } });
    if (!response.ok) throw new Error(`Bing News RSS returned ${response.status}`);
    const xml = await response.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 50).map((match, index) => {
      const item = match[1];
      const title = text(tag(item, 'title'));
      return {
        id: `bing_${index}`,
        provider: this.id,
        providerLabel: this.label,
        url: text(tag(item, 'link')),
        canonicalUrl: text(tag(item, 'link')),
        title,
        publisher: text(tag(item, 'News:Source')) || title.split(' - ').at(-1),
        publicationDate: tag(item, 'pubDate') ? new Date(tag(item, 'pubDate')).toISOString().slice(0, 10) : undefined,
        text: `${title}. ${text(tag(item, 'description'))}`,
        locations: ['United States']
      };
    }).filter(item => item.url && item.title);
  }
}

export class YahooNewsRssProvider {
  constructor({ fetchImpl = fetch } = {}) { this.fetchImpl = fetchImpl; this.id = 'yahoo_news_rss'; this.label = 'Yahoo News RSS'; }
  async search({ query, window }) {
    const response = await this.fetchImpl('https://news.yahoo.com/rss/', { headers: { 'user-agent': 'ProductSafetySignals/2.0', accept: 'application/rss+xml,application/xml' } });
    if (!response.ok) throw new Error(`Yahoo News RSS returned ${response.status}`);
    const xml = await response.text();
    const terms = queryTerms(query);
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 75).map((match, index) => {
      const item = match[1];
      const title = text(tag(item, 'title'));
      const description = text(tag(item, 'description'));
      const publicationDate = tag(item, 'pubDate') ? new Date(tag(item, 'pubDate')).toISOString().slice(0, 10) : undefined;
      return {
        id: `yahoo_news_${index}`,
        provider: this.id,
        providerLabel: this.label,
        url: text(tag(item, 'link')),
        canonicalUrl: text(tag(item, 'link')),
        title,
        publisher: 'Yahoo News',
        publicationDate,
        text: `${title}. ${description}`,
        locations: ['United States']
      };
    }).filter(item => item.url && item.title && withinWindow(item.publicationDate, window) && (!terms.length || terms.some(term => `${item.title} ${item.text}`.toLowerCase().includes(term))));
  }
}

export class YahooComNewsSearchProvider {
  constructor({ fetchImpl = fetch } = {}) { this.fetchImpl = fetchImpl; this.id = 'yahoo_com_news_search'; this.label = 'Yahoo.com News Search'; }
  async search({ query, window }) {
    const url = `https://news.search.yahoo.com/search?p=${encodeURIComponent(query)}`;
    const response = await this.fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html,application/xhtml+xml' } });
    if (!response.ok) throw new Error(`Yahoo.com News Search returned ${response.status}`);
    const html = await response.text();
    return [...html.matchAll(/<div class="dd hometown NewsArticle"[\s\S]*?<\/li><\/ul><\/div><\/li>/gi)].slice(0, 40).map((match, index) => {
      const block = match[0];
      const anchor = block.match(/<a[^>]+href="([^"]+)"[^>]+title="([^"]+)"/i);
      const url = yahooRedirect(anchor?.[1]);
      const title = text(anchor?.[2]);
      const publisher = text(block.match(/<span class="s-source[^>]*>([\s\S]*?)(?:<span|<\/span>)/i)?.[1]) || 'Yahoo.com';
      const publicationDate = relativeDate(block.match(/class="s-time[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
      const description = text(block.match(/class="s-desc[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
      return {
        id: `yahoo_com_${index}`,
        provider: this.id,
        providerLabel: this.label,
        url,
        canonicalUrl: url,
        title,
        publisher,
        publicationDate,
        text: `${title}. ${description}`,
        locations: ['United States']
      };
    }).filter(item => item.url && item.title && withinWindow(item.publicationDate, window));
  }
}

export class GdeltDocProvider {
  constructor({ fetchImpl = fetch } = {}) { this.fetchImpl = fetchImpl; this.id = 'gdelt_doc_2'; this.label = 'GDELT DOC 2.0'; }
  async search({ query, window }) {
    const params = new URLSearchParams({
      query: `${query} sourcelang:english sourcecountry:US`, mode: 'artlist', format: 'json', maxrecords: '75', sort: 'datedesc',
      startdatetime: compactDate(window.start), enddatetime: compactDate(window.end, true)
    });
    const response = await this.fetchImpl(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { headers: { 'user-agent': 'ProductSafetySignals/2.0' } });
    if (!response.ok) throw new Error(`GDELT returned ${response.status}`);
    const payload = await safeJson(response);
    const articles = payload.articles || payload.items || [];
    return articles.slice(0, 75).map((article, index) => ({
      id: `gdelt_${index}`,
      provider: this.id,
      providerLabel: this.label,
      url: article.url || article.external_url,
      canonicalUrl: article.url || article.external_url,
      title: text(article.title),
      publisher: article.domain || article.source?.name || article.sourcecountry,
      publicationDate: gdeltDate(article.seendate) || article.date_published?.slice(0, 10),
      text: `${text(article.title)}. ${text(article.summary || article.description)}`,
      locations: article.sourcecountry ? [article.sourcecountry] : []
    })).filter(item => item.url && item.title);
  }
}

export class CompositeNewsProvider {
  constructor({ fetchImpl = fetch, providers } = {}) {
    this.fetchImpl = fetchImpl;
    this.providers = providers || [new GoogleNewsRssProvider({ fetchImpl }), new BingNewsRssProvider({ fetchImpl }), new YahooNewsRssProvider({ fetchImpl }), new YahooComNewsSearchProvider({ fetchImpl }), new GdeltDocProvider({ fetchImpl })];
  }
  async search(input) {
    const settled = await Promise.allSettled(this.providers.map(provider => provider.search(input)));
    const candidates = [];
    const providerStatus = [];
    settled.forEach((result, index) => {
      const provider = this.providers[index];
      if (result.status === 'fulfilled') {
        providerStatus.push({ id: provider.id, label: provider.label, ok: true, count: result.value.length });
        candidates.push(...result.value);
      } else {
        providerStatus.push({ id: provider.id, label: provider.label, ok: false, count: 0, error: result.reason?.message || 'Provider unavailable' });
      }
    });
    return { candidates, providerStatus };
  }
  async fetchArticle(candidate) {
    const response = await this.fetchImpl(candidate.url, {
      redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 ProductSafetySignals/2.0', accept: 'text/html,application/xhtml+xml' }
    });
    if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) return candidate;
    const html = (await response.text()).slice(0, 750_000);
    const body = text(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ' ')).slice(0, 30_000);
    return { ...candidate, text: `${candidate.text || ''} ${body}`.trim(), contentHash: response.headers.get('etag') || response.headers.get('last-modified') || undefined };
  }
}
