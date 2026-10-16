import http from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, '.winboard-data');
const dataPath = join(dataDir, 'leads.json');
const starterDataPath = join(root, 'starter-leads.json');
const envPath = join(root, '.env');
const port = Number(process.env.PORT || 4174);
const intervalMs = 30_000;
const subreddits = ['forhire','hiring','freelance_forhire','MachineLearningJobs','WebDeveloperJobs','PythonJobs','JavascriptJobs','BigDataJobs','RemotePython','webflow','developersIndia'];
const serviceTerms = [
  'generative ai','llm','ai agent','rag','machine learning','mlops','computer vision','ai integration','workflow automation',
  'erp implementation','odoo','sap integration','crm integration','enterprise application','legacy modernization','digital transformation',
  'cloud migration','aws','azure','devops','kubernetes','data engineering','etl','data pipeline','analytics platform',
  'web app','mobile app','react','node.js','mvp development','saas product','api integration','qa testing','ecommerce','shopify','webflow','gsap',
  'ui ux','product design','figma','user experience','web design'
];
const hireTerms = ['hiring','looking for','need a developer','seeking a freelancer','freelance project','contractor needed','contract opportunity','need an agency','request for proposal','rfp','build an mvp','help us build','consultant needed'];
const excludeTerms = ['for hire','available for work','hire me','my portfolio','looking for clients','i am a freelancer','i am a developer seeking'];

let leads = [];
let state = { running: false, reddit: { connected: false, message: 'Reddit connection needed' }, linkedin: { connected: false, message: 'LinkedIn access not configured' }, discord: { connected: false, message: 'Discord bot not configured' }, lastCheck: null, nextCheck: null, newThisCycle: 0 };
let token = null;
let tokenExpiresAt = 0;
let pollBusy = false;

async function loadEnv() {
  try {
    const content = await readFile(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}
async function loadLeads() {
  try {
    leads = JSON.parse(await readFile(dataPath, 'utf8'));
  } catch {
    try { leads = JSON.parse(await readFile(starterDataPath, 'utf8')); }
    catch { leads = []; }
  }
  if (!Array.isArray(leads)) leads = [];
}
async function saveLeads() { await mkdir(dataDir, { recursive: true }); await writeFile(dataPath, JSON.stringify(leads, null, 2), 'utf8'); }
function hasRedditCredentials() { return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET); }
function publicStatus() {
  return { ...state, running: true, intervalSeconds: intervalMs / 1000, configured: { reddit: hasRedditCredentials(), linkedin: false, discord: false }, count: leads.length };
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'http://127.0.0.1:' + port, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(JSON.stringify(body)); }
async function bodyJson(req) {
  let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 12_000) throw new Error('Request too large'); }
  return JSON.parse(data || '{}');
}
function fitPost(post) {
  const text = `${post.title || ''} ${post.selftext || ''}`.toLowerCase();
  return hireTerms.some(term => text.includes(term)) && serviceTerms.some(term => text.includes(term)) && !excludeTerms.some(term => text.includes(term));
}
async function redditToken() {
  if (token && Date.now() < tokenExpiresAt - 60_000) return token;
  const auth = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': process.env.REDDIT_USER_AGENT || 'Winboard/1.0 (personal freelance lead board)' },
    body: 'grant_type=client_credentials'
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error(`Reddit authentication failed (HTTP ${response.status}). Check app credentials and approved access.`);
  token = result.access_token; tokenExpiresAt = Date.now() + Number(result.expires_in || 3600) * 1000;
  return token;
}
async function pollReddit() {
  if (!hasRedditCredentials() || pollBusy) return;
  pollBusy = true; state.lastCheck = new Date().toISOString(); state.newThisCycle = 0;
  try {
    const bearer = await redditToken();
    for (const community of subreddits) {
      const params = new URLSearchParams({ limit: '100', sort: 'new', t: 'week', q: 'hiring OR "looking for" OR "freelance project" OR "contract opportunity"' });
      const response = await fetch(`https://oauth.reddit.com/r/${community}/search?${params}&restrict_sr=on`, {
        headers: { Authorization: `Bearer ${bearer}`, 'User-Agent': process.env.REDDIT_USER_AGENT || 'Winboard/1.0 (personal freelance lead board)' }
      });
      if (response.status === 429) { state.reddit = { connected: true, message: 'Rate limited; will retry after the next interval.' }; break; }
      if (!response.ok) throw new Error(`Reddit API returned HTTP ${response.status}.`);
      const payload = await response.json();
      for (const child of payload?.data?.children || []) {
        const p = child.data || {};
        if (!p.id || !fitPost(p) || leads.some(existing => existing.id === `reddit-${p.id}`)) continue;
        leads.unshift({ id: `reddit-${p.id}`, title: p.title || 'Untitled post', source: 'Reddit', community: `r/${p.subreddit || community}`, when: 'Just now', days: 0, status: 'New', url: `https://www.reddit.com${p.permalink || '/'}`, description: (p.selftext || '').slice(0, 1200), tags: serviceTerms.filter(term => `${p.title} ${p.selftext}`.toLowerCase().includes(term)).slice(0, 5), value: 0, createdUtc: p.created_utc || null });
        state.newThisCycle++;
      }
      const remainingHeader = response.headers.get('x-ratelimit-remaining');
      const remaining = remainingHeader === null ? NaN : Number(remainingHeader);
      if (Number.isFinite(remaining) && remaining < 5 && community !== subreddits.at(-1)) { state.reddit = { connected: true, message: 'Pausing to respect Reddit rate limits.' }; break; }
    }
    if (state.newThisCycle) { leads.sort((a,b) => (b.createdUtc || 0) - (a.createdUtc || 0)); await saveLeads(); }
    state.reddit = { connected: true, message: state.newThisCycle ? `${state.newThisCycle} new matching leads found.` : 'Connected; no new matching leads.' };
  } catch (error) {
    state.reddit = { connected: false, message: error.message };
  } finally { state.nextCheck = new Date(Date.now() + intervalMs).toISOString(); pollBusy = false; }
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': 'http://127.0.0.1:' + port, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && url.pathname === '/api/status') { await loadLeads(); return json(res, 200, publicStatus()); }
    if (req.method === 'GET' && url.pathname === '/api/leads') { await loadLeads(); return json(res, 200, leads); }
    if (req.method === 'POST' && url.pathname === '/api/update') {
      try {
        const payload = await bodyJson(req); const lead = leads.find(item => item.id === payload.id);
        if (!lead || !['New','Saved','Applied','Closed'].includes(payload.status)) return json(res, 404, { error: 'Lead or status not found.' });
        lead.status = payload.status; await saveLeads(); return json(res, 200, { ok: true });
      } catch (error) { return json(res, 400, { error: error.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/connect/reddit') {
      try {
        const payload = await bodyJson(req);
        const clientId = String(payload.clientId || '').trim(); const clientSecret = String(payload.clientSecret || '').trim();
        if (!clientId || !clientSecret || clientId.length > 200 || clientSecret.length > 500 || /[\r\n]/.test(clientId + clientSecret)) return json(res, 400, { error: 'Enter a valid Reddit application ID and secret.' });
        const data = `REDDIT_CLIENT_ID=${clientId}\nREDDIT_CLIENT_SECRET=${clientSecret}\nREDDIT_USER_AGENT=Winboard/1.0 (personal freelance lead board)\n`;
        await writeFile(envPath, data, { encoding: 'utf8', mode: 0o600 });
        process.env.REDDIT_CLIENT_ID = clientId; process.env.REDDIT_CLIENT_SECRET = clientSecret; token = null;
        await pollReddit();
        return json(res, 200, { status: publicStatus() });
      } catch (error) { return json(res, 400, { error: error.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/sync') { await pollReddit(); return json(res, 200, publicStatus()); }
    return json(res, 404, { error: 'Unknown endpoint.' });
  }
  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = resolve(root, requested);
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    await access(file); const content = await readFile(file);
    const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
});

await loadEnv(); await loadLeads();
server.listen(port, '127.0.0.1', () => console.log(`Winboard is running at http://127.0.0.1:${port}`));
state.nextCheck = new Date(Date.now() + intervalMs).toISOString();
setTimeout(() => { pollReddit(); setInterval(pollReddit, intervalMs); }, 1500);

