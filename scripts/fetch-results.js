// ============================================================
// Olivos Oracle · fetch-results.js
// Uses plain fetch() — no Supabase JS client, no WebSocket issues
// Node 18+ compatible
// ============================================================

const DRY_RUN = process.argv.includes('--dry-run');
const {
  FOOTBALL_DATA_KEY, API_FOOTBALL_KEY,
  SUPABASE_URL, SUPABASE_SERVICE_KEY
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1);
}
if (!FOOTBALL_DATA_KEY && !API_FOOTBALL_KEY) {
  console.error('❌ Missing API keys'); process.exit(1);
}

// ── SUPABASE REST (plain fetch, no client library) ────────────
const SB_HEADERS = {
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

async function sbSelect(table, query = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: SB_HEADERS });
  if (!r.ok) { console.error(`SB select error ${table}: ${r.status}`); return []; }
  return r.json();
}

async function sbUpsert(table, data, onConflict) {
  if (DRY_RUN) { console.log(`  [DRY] upsert ${table}:`, JSON.stringify(data).substring(0, 80)); return true; }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB_HEADERS, 'Prefer': `resolution=merge-duplicates,return=minimal` },
    body: JSON.stringify(data),
  });
  if (!r.ok) { const t = await r.text(); console.error(`SB upsert error ${table}: ${r.status} ${t.substring(0,100)}`); }
  return r.ok;
}

async function sbPatch(table, query, data) {
  if (DRY_RUN) return true;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: SB_HEADERS,
    body: JSON.stringify(data),
  });
  return r.ok;
}

async function sbInsert(table, data) {
  if (DRY_RUN) return true;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify(data),
  });
  return r.ok;
}

// ── TEAM MAPS ────────────────────────────────────────────────
const TEAM_MAP = {
  'Mexico':'Mexico','South Africa':'South Africa','Korea Republic':'Korea Republic',
  'Czech Republic':'Czechia','Czechia':'Czechia','Canada':'Canada',
  'Bosnia and Herzegovina':'Bosnia & Herzegovina','Bosnia-Herzegovina':'Bosnia & Herzegovina',
  'Qatar':'Qatar','Switzerland':'Switzerland','Brazil':'Brazil','Morocco':'Morocco',
  'Haiti':'Haiti','Scotland':'Scotland','United States':'USA','USA':'USA',
  'Paraguay':'Paraguay','Australia':'Australia','Turkey':'Turkiye','Türkiye':'Turkiye','Turkiye':'Turkiye',
  'Germany':'Germany',"Curaçao":'Curacao',"Côte d'Ivoire":"Cote d'Ivoire",'Ivory Coast':"Cote d'Ivoire",
  'Ecuador':'Ecuador','Netherlands':'Netherlands','Japan':'Japan','Sweden':'Sweden',
  'Tunisia':'Tunisia','Belgium':'Belgium','Egypt':'Egypt','Iran':'IR Iran','IR Iran':'IR Iran',
  'New Zealand':'New Zealand','Spain':'Spain','Cape Verde':'Cabo Verde','Cabo Verde':'Cabo Verde',
  'Saudi Arabia':'Saudi Arabia','Uruguay':'Uruguay','France':'France','Senegal':'Senegal',
  'Iraq':'Iraq','Norway':'Norway','Argentina':'Argentina','Algeria':'Algeria','Austria':'Austria',
  'Jordan':'Jordan','Portugal':'Portugal','DR Congo':'Congo DR','Congo DR':'Congo DR',
  'Democratic Republic of Congo':'Congo DR','Uzbekistan':'Uzbekistan','Colombia':'Colombia',
  'England':'England','Croatia':'Croatia','Ghana':'Ghana','Panama':'Panama',
};
const WC_TEAMS = new Set(Object.values(TEAM_MAP));
function norm(n) { return TEAM_MAP[n] || n; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isFinished(s) { return ['FINISHED','FT','AET','PEN'].includes((s||'').toUpperCase()); }
function recencyWeight(d) {
  const days = (Date.now() - new Date(d)) / 86400000;
  return days<=30?1.0:days<=60?0.85:days<=90?0.70:days<=120?0.55:days<=180?0.40:0.25;
}

// ── FIFA RANKS ────────────────────────────────────────────────
const FIFA_RANK = {
  Mexico:15,'South Africa':60,'Korea Republic':22,Czechia:43,Canada:30,
  'Bosnia & Herzegovina':66,Qatar:56,Switzerland:19,Brazil:7,Morocco:8,Haiti:83,
  Scotland:40,USA:16,Paraguay:38,Australia:27,Turkiye:24,Germany:10,Curacao:82,
  "Cote d'Ivoire":35,Ecuador:23,Netherlands:6,Japan:18,Sweden:41,Tunisia:44,
  Belgium:9,Egypt:29,'IR Iran':21,'New Zealand':85,Spain:1,'Cabo Verde':70,
  'Saudi Arabia':61,Uruguay:17,France:2,Senegal:149,Iraq:59,Norway:31,
  Argentina:3,Algeria:28,Austria:25,Jordan:64,Portugal:5,'Congo DR':48,
  Uzbekistan:50,Colombia:13,England:4,Croatia:11,Ghana:74,Panama:34,
};

// ── ELO RATINGS ───────────────────────────────────────────────
const FALLBACK_ELO = {
  France:2057,Spain:2010,England:2001,Brazil:1994,Argentina:1990,Portugal:1969,
  Netherlands:1965,Germany:1952,Morocco:1948,Belgium:1944,Uruguay:1934,Colombia:1921,
  Japan:1878,'Korea Republic':1830,Mexico:1853,USA:1856,Croatia:1862,Switzerland:1844,
  Australia:1817,Norway:1834,Austria:1837,Sweden:1832,Turkiye:1830,Ecuador:1805,
  'IR Iran':1840,"Cote d'Ivoire":1790,Egypt:1782,Algeria:1810,Tunisia:1770,Czechia:1820,
  Scotland:1790,Senegal:1799,Qatar:1730,'Saudi Arabia':1755,'Cabo Verde':1720,
  'South Africa':1700,Panama:1734,Ghana:1742,'Bosnia & Herzegovina':1760,Uzbekistan:1740,
  'Congo DR':1720,Jordan:1650,'New Zealand':1610,Haiti:1580,Iraq:1680,Curacao:1530,Paraguay:1800,
};
const WC_HISTORY = {
  Brazil:10,Germany:9,Argentina:9,France:8,Spain:7,England:6,Uruguay:5,
  Netherlands:4,Portugal:3,Croatia:3,Mexico:2,USA:1,Belgium:1,Sweden:1,
};

// ── FETCH ELO FROM ELORATINGS.NET ────────────────────────────
async function fetchElo() {
  console.log('📡 Fetching Elo from eloratings.net...');
  try {
    const r = await fetch('https://www.eloratings.net/World', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OlivosOracle/1.0)' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const eloMap = {};
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
        .map(m => m[1].replace(/<[^>]+>/g,'').trim());
      if (cells.length >= 3) {
        const name = norm(cells[1] || cells[0]);
        const elo = parseInt((cells[2]||'').replace(/[^0-9]/g,''));
        if (name && elo > 1000 && elo < 2500 && WC_TEAMS.has(name)) eloMap[name] = elo;
      }
    }
    const count = Object.keys(eloMap).length;
    console.log(`  Got ${count} Elo ratings from web`);
    return count > 20 ? eloMap : FALLBACK_ELO;
  } catch(e) {
    console.log(`  Using fallback Elo (${e.message})`);
    return FALLBACK_ELO;
  }
}

// ── COMPUTE STRENGTH ──────────────────────────────────────────
function computeStr(team, eloMap) {
  const elo = eloMap[team] || 1600;
  const rank = FIFA_RANK[team] || 80;
  const eloN = Math.max(20, Math.min(99, Math.round((elo-1400)/700*79+20)));
  const rankN = Math.max(25, Math.round(95-(rank-1)*0.47));
  const hist = Math.min(2, (WC_HISTORY[team]||0)*0.2);
  return Math.round(eloN*0.55 + rankN*0.35 + hist + 50*0.05);
}

// ── FOOTBALL-DATA.ORG ─────────────────────────────────────────
async function fetchFD() {
  if (!FOOTBALL_DATA_KEY) return [];
  console.log('📡 football-data.org...');
  try {
    const r = await fetch('https://api.football-data.org/v4/competitions/WC/matches?season=2026', {
      headers: { 'X-Auth-Token': FOOTBALL_DATA_KEY }
    });
    if (!r.ok) { console.log(`  FD error: ${r.status}`); return []; }
    const data = await r.json();
    const results = (data.matches||[]).map(m => ({
      source:'football-data', competition:'WC2026',
      apiId: String(m.id),
      homeTeam: norm(m.homeTeam?.name||''), awayTeam: norm(m.awayTeam?.name||''),
      homeScore: m.score?.fullTime?.home??null, awayScore: m.score?.fullTime?.away??null,
      status: m.status, matchDate: m.utcDate, stage: m.stage||'GROUP_STAGE',
    }));
    console.log(`  WC matches: ${results.length}`);
    return results;
  } catch(e) { console.log(`  FD error: ${e.message}`); return []; }
}

// ── API-FOOTBALL ──────────────────────────────────────────────
async function fetchAF() {
  if (!API_FOOTBALL_KEY) return [];
  console.log('📡 API-Football...');
  const headers = { 'x-apisports-key': API_FOOTBALL_KEY };
  const results = [];
  try {
    const r = await fetch('https://v3.football.api-sports.io/fixtures?league=1&season=2026', { headers });
    if (r.ok) {
      const data = await r.json();
      for (const f of data.response||[]) {
        results.push({
          source:'api-football', competition:'WC2026',
          apiId: String(f.fixture?.id),
          homeTeam: norm(f.teams?.home?.name||''), awayTeam: norm(f.teams?.away?.name||''),
          homeScore: f.goals?.home??null, awayScore: f.goals?.away??null,
          status: f.fixture?.status?.short||'NS', matchDate: f.fixture?.date,
          stage: f.league?.round||'GROUP_STAGE',
        });
      }
      console.log(`  WC: ${results.length}`);
    }
  } catch(e) { console.log(`  AF WC error: ${e.message}`); }

  // Try multiple league IDs + date-based fetch for pre-WC friendlies
  const friendlyLeagueIds = [9, 1160, 1161];
  for (const lid of friendlyLeagueIds) {
    await sleep(500);
    try {
      const r = await fetch(`https://v3.football.api-sports.io/fixtures?league=${lid}&season=2026&last=60`, { headers });
      if (r.ok) {
        const data = await r.json();
        let cnt = 0;
        for (const f of data.response||[]) {
          const home = norm(f.teams?.home?.name||''), away = norm(f.teams?.away?.name||'');
          if (!WC_TEAMS.has(home) && !WC_TEAMS.has(away)) continue;
          const st = f.fixture?.status?.short;
          if (['FT','AET','PEN'].includes(st)) {
            results.push({
              source:'api-football', competition:'FRIENDLY', apiId: String(f.fixture?.id),
              homeTeam: home, awayTeam: away,
              homeScore: f.goals?.home??null, awayScore: f.goals?.away??null,
              status:'FINISHED', matchDate: f.fixture?.date, stage:'FRIENDLY',
            }); cnt++;
          }
        }
        if (cnt > 0) console.log(`  Friendlies (league ${lid}): ${cnt}`);
      }
    } catch(e) { console.log(`  AF league ${lid} error: ${e.message}`); }
  }

  // Also fetch by today's date to catch same-day results
  try {
    await sleep(500);
    const today = new Date().toISOString().split('T')[0];
    const r = await fetch(`https://v3.football.api-sports.io/fixtures?date=${today}&timezone=UTC`, { headers });
    if (r.ok) {
      const data = await r.json();
      let cnt = 0;
      for (const f of data.response||[]) {
        const home = norm(f.teams?.home?.name||''), away = norm(f.teams?.away?.name||'');
        if (!WC_TEAMS.has(home) && !WC_TEAMS.has(away)) continue;
        const st = f.fixture?.status?.short;
        const ltype = f.league?.type || '';
        if (['FT','AET','PEN'].includes(st) && ['International','Cup','Friendly'].some(t=>ltype.includes(t))) {
          results.push({
            source:'api-football', competition:'FRIENDLY', apiId: String(f.fixture?.id),
            homeTeam: home, awayTeam: away,
            homeScore: f.goals?.home??null, awayScore: f.goals?.away??null,
            status:'FINISHED', matchDate: f.fixture?.date, stage:'FRIENDLY',
          }); cnt++;
        }
      }
      if (cnt > 0) console.log(`  Today's friendlies: ${cnt}`);
    }
  } catch(e) { console.log(`  AF today error: ${e.message}`); }

  return results;
}

// ── FORM CACHE ────────────────────────────────────────────────
async function updateForm(home, away, hs, as_, date, comp, source) {
  if (hs === null || as_ === null) return;
  const w = recencyWeight(date);
  const entries = [];
  if (WC_TEAMS.has(home)) entries.push({ team_id:home, opponent_id:away, match_date:date, competition:comp, home_away:'H', goals_for:hs, goals_against:as_, result:hs>as_?'W':hs<as_?'L':'D', weight:w, source });
  if (WC_TEAMS.has(away)) entries.push({ team_id:away, opponent_id:home, match_date:date, competition:comp, home_away:'A', goals_for:as_, goals_against:hs, result:as_>hs?'W':as_<hs?'L':'D', weight:w, source });
  for (const e of entries) await sbUpsert('form_cache', e);
}

// ── CONFLICT DETECTION ────────────────────────────────────────
function conflict(p, s) {
  if (!p||!s||p.homeScore===null||s.homeScore===null) return false;
  return p.homeScore!==s.homeScore || p.awayScore!==s.awayScore;
}
function confidence(p, s, c) {
  if (c) return 'conflicting';
  if (p&&s) return 'confirmed_both';
  if (p) return 'confirmed_primary';
  if (s) return 'confirmed_secondary';
  return 'estimated';
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n🟢 Olivos Oracle · Sync · ${new Date().toISOString()}\n`);

  // 1. Elo ratings
  const eloMap = await fetchElo();

  // 2. Update team strengths
  console.log('🧮 Updating team strengths...');
  const teams = Object.keys(FIFA_RANK);
  for (const team of teams) {
    const str = computeStr(team, eloMap);
    const elo = eloMap[team] || FALLBACK_ELO[team] || 1600;
    await sbUpsert('teams', {
      id: team, name: team, fifa_rank: FIFA_RANK[team],
      elo_rating: elo, base_strength: str,
      last_updated: new Date().toISOString(),
    });
  }
  console.log(`  ✅ ${teams.length} teams updated`);

  // 3. Fetch match results
  const [primary, secondary] = await Promise.all([fetchFD(), fetchAF()]);
  const secIdx = {};
  secondary.forEach(m => { secIdx[`${m.homeTeam}|${m.awayTeam}|${m.competition}`] = m; });

  let synced=0, locked=0, conflicts=0;

  for (const p of primary) {
    const key = `${p.homeTeam}|${p.awayTeam}|${p.competition}`;
    const s = secIdx[key];
    const fin = isFinished(p.status);
    const cflt = fin && conflict(p, s);
    const conf = confidence(fin?p:null, fin&&s?s:null, cflt);
    const id = `${p.competition}_${p.homeTeam}_${p.awayTeam}`.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'');

    await sbUpsert('matches', {
      id, football_data_id: parseInt(p.apiId)||null,
      api_football_id: s?parseInt(s.apiId)||null:null,
      competition: p.competition, stage: p.stage,
      home_team: p.homeTeam, away_team: p.awayTeam,
      home_score: fin?p.homeScore:null, away_score: fin?p.awayScore:null,
      status: fin?'FINISHED':p.status, match_date: p.matchDate,
      source_primary: fin?`${p.homeScore}-${p.awayScore}`:null,
      source_secondary: (fin&&s)?`${s.homeScore}-${s.awayScore}`:null,
      confidence: conf, locked: fin&&!cflt, conflict_flagged: cflt,
      last_updated: new Date().toISOString(),
    });

    if (cflt) {
      await sbInsert('conflict_log', {
        match_id:id, primary_score:`${p.homeScore}-${p.awayScore}`,
        secondary_score:`${s.homeScore}-${s.awayScore}`,
        detected_at: new Date().toISOString(), resolved: false,
      });
      conflicts++;
    }
    if (fin && p.homeScore !== null) await updateForm(p.homeTeam, p.awayTeam, p.homeScore, p.awayScore, p.matchDate, p.competition, 'football-data');
    if (fin && !cflt) locked++;
    synced++;
  }

  // 4. Friendlies
  for (const m of secondary.filter(m=>m.competition==='FRIENDLY')) {
    const id = `FRIENDLY_${m.homeTeam}_${m.awayTeam}_${(m.matchDate||'').substring(0,10)}`.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
    await updateForm(m.homeTeam, m.awayTeam, m.homeScore, m.awayScore, m.matchDate, 'FRIENDLY', 'api-football');
    await sbUpsert('matches', {
      id, api_football_id: parseInt(m.apiId)||null, competition:'FRIENDLY', stage:'FRIENDLY',
      home_team:m.homeTeam, away_team:m.awayTeam, home_score:m.homeScore, away_score:m.awayScore,
      status:'FINISHED', match_date:m.matchDate,
      source_secondary:`${m.homeScore}-${m.awayScore}`, confidence:'confirmed_secondary',
      locked:true, last_updated:new Date().toISOString(),
    });
  }

  // 5. Recalculate form scores
  const formData = await sbSelect('team_recent_form');
  for (const row of formData) {
    const adj = Math.min(10, Math.max(-10, (row.weighted_form_score - 1.5) * 3));
    await sbPatch('teams', `id=eq.${encodeURIComponent(row.team_id)}`, {
      form_score: adj, last_updated: new Date().toISOString()
    });
  }

  console.log(`\n✅ Done · Synced:${synced} Locked:${locked} Conflicts:${conflicts}`);
}

main().catch(err => { console.error('💥', err.message); process.exit(1); });
