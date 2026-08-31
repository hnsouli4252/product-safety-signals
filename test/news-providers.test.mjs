import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleNewsRssProvider, BingNewsRssProvider, YahooNewsRssProvider, YahooComNewsSearchProvider, GdeltDocProvider, CompositeNewsProvider } from '../src/news-search/providers.mjs';

const input = { query: '"Acme Model X" hospitalized', window: { start: '2026-07-01', end: '2026-08-01' } };

test('Google News RSS provider applies date and U.S. search parameters and normalizes articles', async () => {
  let requested;
  const xml = `<?xml version="1.0"?><rss><channel><item><title>Acme Model X fire hospitalizes resident - Local TV</title><link>https://news.google.com/rss/articles/example</link><pubDate>Mon, 20 Jul 2026 12:00:00 GMT</pubDate><source>Local TV</source><description>A resident was hospitalized after a fire.</description></item></channel></rss>`;
  const provider = new GoogleNewsRssProvider({ fetchImpl: async url => { requested = String(url); return new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }); } });
  const results = await provider.search(input);
  assert.match(requested, /news\.google\.com\/rss\/search/);
  assert.match(decodeURIComponent(requested), /after:2026-07-01 before:2026-08-01/);
  assert.match(requested, /gl=US/);
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'google_news_rss');
  assert.equal(results[0].publicationDate, '2026-07-20');
});

test('GDELT provider sends bounded ArticleList queries and normalizes JSON results', async () => {
  let requested;
  const payload = { articles: [{ url: 'https://local.example/acme-fire', title: 'Acme Model X fire injures family', domain: 'local.example', seendate: '20260715T120000Z', sourcecountry: 'United States' }] };
  const provider = new GdeltDocProvider({ fetchImpl: async url => { requested = String(url); return Response.json(payload); } });
  const results = await provider.search(input);
  const url = new URL(requested);
  assert.equal(url.searchParams.get('mode'), 'artlist');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('startdatetime'), '20260701000000');
  assert.equal(url.searchParams.get('enddatetime'), '20260801235959');
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'gdelt_doc_2');
  assert.equal(results[0].publicationDate, '2026-07-15');
});

test('Bing News RSS provider applies date and locale parameters and normalizes articles', async () => {
  let requested;
  const xml = `<?xml version="1.0"?><rss xmlns:News="https://www.bing.com/news"><channel><item><title>Acme Model X fire injures resident</title><link>https://local.example/bing-story</link><pubDate>Tue, 21 Jul 2026 12:00:00 GMT</pubDate><News:Source>Local News</News:Source><description>A resident was injured and hospitalized.</description></item></channel></rss>`;
  const provider = new BingNewsRssProvider({ fetchImpl: async url => { requested = String(url); return new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }); } });
  const results = await provider.search(input);
  assert.match(requested, /bing\.com\/news\/search/);
  assert.match(decodeURIComponent(requested), /after:2026-07-01 before:2026-08-01/);
  assert.match(requested, /setlang=en-US/);
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'bing_news_rss');
  assert.equal(results[0].publisher, 'Local News');
});

test('Yahoo News RSS provider fetches the live official feed and labels its source', async () => {
  let requested;
  const xml = `<?xml version="1.0"?><rss><channel><item><title>Acme Model X fire hospitalizes resident</title><link>https://www.yahoo.com/news/acme-model-x-fire.html</link><pubDate>Mon, 20 Jul 2026 12:00:00 GMT</pubDate><description>A resident was hospitalized after a fire.</description></item></channel></rss>`;
  const provider = new YahooNewsRssProvider({ fetchImpl: async url => { requested = String(url); return new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }); } });
  const results = await provider.search(input);
  assert.equal(requested, 'https://news.yahoo.com/rss/');
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'yahoo_news_rss');
  assert.equal(results[0].providerLabel, 'Yahoo News RSS');
  assert.equal(results[0].publisher, 'Yahoo News');
});

test('Yahoo.com News Search provider sends a live query, labels its source, and unwraps result URLs', async () => {
  let requested;
  const html = `<ol><li><div class="dd hometown NewsArticle"><ul><li><a href="https://r.search.yahoo.com/x/RU=https%3A%2F%2Fwww.yahoo.com%2Fnews%2Facme-fire.html/RK=2/RS=x" title="Acme Model X fire injures family"></a><span class="s-source">Yahoo News</span><span class="s-time">3 days ago &middot; </span><p class="s-desc">A family was injured and hospitalized.</p></li></ul></div></li></ol>`;
  const provider = new YahooComNewsSearchProvider({ fetchImpl: async url => { requested = String(url); return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }); } });
  const results = await provider.search({ ...input, window: { start: '2000-01-01', end: '2100-01-01' } });
  assert.match(requested, /news\.search\.yahoo\.com\/search/);
  assert.equal(new URL(requested).searchParams.get('p'), input.query);
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'yahoo_com_news_search');
  assert.equal(results[0].providerLabel, 'Yahoo.com News Search');
  assert.equal(results[0].url, 'https://www.yahoo.com/news/acme-fire.html');
});

test('composite provider isolates a failed source and retains successful live candidates', async () => {
  const good = { id: 'good', label: 'Good provider', async search() { return [{ url: 'https://example.test/story', title: 'Story' }]; } };
  const bad = { id: 'bad', label: 'Bad provider', async search() { throw new Error('temporary failure'); } };
  const provider = new CompositeNewsProvider({ providers: [good, bad] });
  const result = await provider.search(input);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.providerStatus.map(status => [status.id, status.ok]), [['good', true], ['bad', false]]);
});
