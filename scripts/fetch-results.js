// ============================================================
// OlivosPredictor · fetch-results.js
// Sources: football-data.org + API-Football + eloratings.net
// ============================================================
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const DRY_RUN = process.argv.includes('--dry-run');
const { FOOTBALL_DATA_KEY, API_FOOTBALL_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

if (!FOOTBALL_DATA_KEY || !API_FOOTBALL_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing env vars'); process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── TEAM NAME MAP ─────────────────────────────────────────────
const TEAM_MAP = {
  'Mexico':'Mexico','South Africa':'South Africa','Korea Republic':'Korea Republic',
  'Czech Republic':'Czechia','Czechia':'Czechia','Canada':'Canada',
  'Bosnia and Herzegovina':'Bosnia & Herzegovina','Qatar':'Qatar','Switzerland':'Switzerland',
  'Brazil':'Brazil','Morocco':'Morocco','Haiti':'Haiti','Scotland':'Scotland',
  'United States':'USA','USA':'USA','Paraguay':'Paraguay','Australia':'Australia',
  'Turkey':'Turkiye','Türkiye':'Turkiye','Turkiye':'Turkiye','Germany':'Germany',
  'Curaçao':'Curacao',"Côte d'Ivoire":"Cote d'Ivoire",'Ivory Coast':"Cote d'Ivoire",
  'Ecuador':'Ecuador','Netherlands':'Netherlands','Japan':'Japan','Sweden':'Sweden',
  'Tunisia':'Tunisia','Belgium':'Belgium','Egypt':'Egypt','Iran':'IR Iran','IR Iran':'IR Iran',
  'New Zealand':'New Zealand','Spain':'Spain','Cape Verde':'Cabo Verde','Cabo Verde':'Cabo Verde',
  'Saudi Arabia':'Saudi Arabia','Uruguay':'Uruguay','France':'France','Senegal':'Senegal',
  'Iraq':'Iraq','Norway':'Norway','Argentina':'Argentina','Algeria':'Algeria',
  'Austria':'Austria','Jordan':'Jordan','Portugal':'Portugal','DR Congo':'Congo DR',
  'Congo DR':'Congo DR','Democratic Republic of Congo':'Congo DR','Uzbekistan':'Uzbekistan',
  'Colombia':'Colombia','England':'England','Croatia':'Croatia','Ghana':'Ghana','Panama':'Panama',
  // eloratings.net specific names
  'United States of America':'USA','Republic of Ireland':'Ireland',
  'Bosnia-Herzegovina':'Bosnia & Herzegovina','Ivory Coast':"Cote d'Ivoire",
  'DR Congo':'Congo DR','Congo DR':'Congo DR',
};

const WC_TEAMS = new Set(Object.values(TEAM_MAP));
function norm(name) { return TEAM_MAP[name] || name; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isFinished(s) { return ['FINISHED','FT','AET','PEN'].includes((s||'').toUpperCase()); }
function recencyWeight(d) {
  const days = (Date.now() - new Date(d)) / 86400000;
  return days<=30?1.0:days<=60?0.85:days<=90?0.70:days<=120?0.55:days<=180?0.40:0.25;
}

// ── ELO RATINGS FROM eloratings.net ──────────────────────────
async function fetchEloRatings() {
  console.log('📡 Fetching Elo ratings from eloratings.net...');
  try {
    const res = await fetch('https://www.eloratings.net/World', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OlivosOracle/1.0)',
        'Accept': 'text/html',
      }
    });
    if (!res.ok) { console.error('  ❌ eloratings.net fetch failed:', res.status); return {}; }
    const html = await res.text();
    const eloMap = {};
    // Parse table rows — eloratings.net format: team name and elo in table
    const rowRegex = /<tr[^>]*>.*?<\/tr>/gs;
    const cellRegex = /<td[^>]*>(.*?)<\/td>/gs;
    const rows = html.match(rowRegex) || [];
    for (const row of rows) {
      const cells = [...row.matchAll(cellRegex)].map(m => m[1].replace(/<[^>]+>/g,'').trim());
      if (cells.length >= 3) {
        const teamName = norm(cells[1] || cells[0]);
        const eloStr = cells[2] || cells[1];
        const elo = parseInt(eloStr?.replace(/[^0-9]/g,''));
        if (teamName && elo > 1000 && elo < 2500 && WC_TEAMS.has(teamName)) {
          eloMap[teamName] = elo;
        }
      }
    }
    // Fallback: try JSON endpoint
    if (Object.keys(eloMap).length < 10) {
      console.log('  Trying JSON endpoint...');
      const jsonRes = await fetch('https://www.eloratings.net/en.json');
      if (jsonRes.ok) {
        const data = await jsonRes.json();
        for (const team of (data.teams || [])) {
          const name = norm(team.name || team.team_name || '');
          const elo = team.elo || team.rating;
          if (name && elo && WC_TEAMS.has(name)) eloMap[name] = elo;
        }
      }
    }
    const count = Object.keys(eloMap).length;
    console.log(`  ✅ Got ${count} Elo ratings`);
    // Log top 10
    const top = Object.entries(eloMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
    top.forEach(([t,e]) => console.log(`     ${t}: ${e}`));
    return eloMap;
  } catch(err) {
    console.error('  ❌ Elo fetch error:', err.message);
    return {};
  }
}

// ── FALLBACK ELO (if scraping fails) ─────────────────────────
const FALLBACK_ELO = {
  France:2057,Argentina:2048,Spain:1972,England:2001,Brazil:1994,
  Portugal:1969,Netherlands:1965,Belgium:1944,Germany:1952,Morocco:1948,
  Uruguay:1934,Colombia:1921,Mexico:1853,USA:1856,Japan:1878,
  'Korea Republic':1830,Croatia:1862,Switzerland:1844,Australia:1817,
  Ecuador:1805,Czechia:1820,Norway:1834,Austria:1837,Sweden:1832,
  Turkiye:1830,Egypt:1782,Algeria:1810,'IR Iran':1840,'Cote d\'Ivoire':1790,
  Tunisia:1770,Qatar:1730,'Saudi Arabia':1755,'Cabo Verde':1720,
  'South Africa':1700,Panama:1734,Ghana:1742,Senegal:1799,
  'Bosnia & Herzegovina':1760,Uzbekistan:1740,'Congo DR':1720,
  Colombia:1921,Jordan:1650,'New Zealand':1610,Haiti:1580,
  Scotland:1790,Iraq:1680,Curacao:1530,
};

// ── COMPUTE TEAM STRENGTH ─────────────────────────────────────
function computeStrength(team, eloMap, formScore, fifaRank) {
  const elo = eloMap[team] || FALLBACK_ELO[team] || 1600;
  // Elo normalized 0-99 (1400=20, 2100=99)
  const eloNorm = Math.max(20, Math.min(99, Math.round((elo - 1400) / 700 * 79 + 20)));
  // FIFA rank normalized (rank 1=95, rank 150=30)
  const rankNorm = Math.max(30, Math.round(95 - (fifaRank - 1) * 0.45));
  // WC history points
  const WC_HISTORY = {
    Brazil:10, Germany:9, Argentina:9, France:8, Spain:7, England:6,
    Uruguay:5, Italy:5, Netherlands:4, Portugal:3, Croatia:3, Mexico:2,
    USA:1, Belgium:1, Sweden:1,
  };
  const historyBonus = WC_HISTORY[team] || 0;
  // Combine: 35% elo + 25% rank + 20% form + 10% history + 5% squad + 5% host
  const base = Math.round(
    eloNorm * 0.35 +
    rankNorm * 0.25 +
    50 * 0.20 + // form will be added live from Supabase
    Math.min(10, historyBonus) * 0.10 * 10 +
    50 * 0.05 + // squad power (static for now)
    50 * 0.05   // host (handled in app)
  );
  const withForm = Math.max(10, Math.min(99, base + (formScore || 0)));
  return { base, withForm, elo, eloNorm, rankNorm };
}

// ── FIFA RANKS ────────────────────────────────────────────────
const FIFA_RANK = {
  Mexico:15,'South Africa':60,'Korea Republic':22,Czechia:43,Canada:30,
  'Bosnia & Herzegovina':66,Qatar:56,Switzerland:19,Brazil:7,Morocco:8,
  Haiti:83,Scotland:40,USA:16,Paraguay:38,Australia:27,Turkiye:24,
  Germany:10,Curacao:82,"Cote d'Ivoire":35,Ecuador:23,Netherlands:6,
  Japan:18,Sweden:41,Tunisia:44,Belgium:9,Egypt:29,'IR Iran':21,
  'New Zealand':85,Spain:1,'Cabo Verde':70,'Saudi Arabia':61,Uruguay:17,
  France:2,Senegal:149,Iraq:59,Norway:31,Argentina:3,Algeria:28,
  Austria:25,Jordan:64,Portugal:5,'Congo DR':48,Uzbekistan:50,Colombia:13,
  England:4,Croatia:11,Ghana:74,Panama:34,
};

// ── FOOTBALL-DATA.ORG ─────────────────────────────────────────
async function fetchFootballData() {
  console.log('📡 Fetching from football-data.org...');
  const results = [];
  try {
    const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches?season=2026', {
      headers: { 'X-Auth-Token': FOOTBALL_DATA_KEY }
    });
    const remaining = res.headers.get('X-Requests-Available-Minute');
    if (remaining && parseInt(remaining) < 3) await sleep(10000);
    if (res.ok) {
      const data = await res.json();
      for (const m of data.matches || []) {
        results.push({
          source:'football-data', competition:'WC2026',
          apiId:String(m.id),
          homeTeam:norm(m.homeTeam?.name||''), awayTeam:norm(m.awayTeam?.name||''),
          homeScore:m.score?.fullTime?.home??null, awayScore:m.score?.fullTime?.away??null,
          status:m.status, matchDate:m.utcDate, stage:m.stage||'GROUP_STAGE',
        });
      }
      console.log(`  ✅ WC2026: ${results.length} matches`);
    }
  } catch(err) { console.error('  ❌ FD error:', err.message); }
  return results;
}

// ── API-FOOTBALL ──────────────────────────────────────────────
async function fetchApiFootball() {
  console.log('📡 Fetching from API-Football...');
  const results = [];
  const headers = { 'x-apisports-key': API_FOOTBALL_KEY };
  // WC matches
  try {
    const res = await fetch('https://v3.football.api-sports.io/fixtures?league=1&season=2026', { headers });
    if (res.ok) {
      const data = await res.json();
      let c=0;
      for (const f of data.response||[]) {
        const home=norm(f.teams?.home?.name||''), away=norm(f.teams?.away?.name||'');
        results.push({ source:'api-football', competition:'WC2026',
          apiId:String(f.fixture?.id), homeTeam:home, awayTeam:away,
          homeScore:f.goals?.home??null, awayScore:f.goals?.away??null,
          status:f.fixture?.status?.short||'NS', matchDate:f.fixture?.date,
          stage:f.league?.round||'GROUP_STAGE',
        }); c++;
      }
      console.log(`  ✅ WC2026: ${c} matches from API-Football`);
    }
  } catch(err) { console.error('  ❌ AF WC error:', err.message); }
  // Friendlies
  try {
    await sleep(1000);
    const res = await fetch('https://v3.football.api-sports.io/fixtures?league=9&season=2026&last=60', { headers });
    if (res.ok) {
      const data = await res.json();
      let c=0;
      for (const f of data.response||[]) {
        const home=norm(f.teams?.home?.name||''), away=norm(f.teams?.away?.name||'');
        if (!WC_TEAMS.has(home) && !WC_TEAMS.has(away)) continue;
        if (f.fixture?.status?.short==='FT') {
          results.push({ source:'api-football', competition:'FRIENDLY',
            apiId:String(f.fixture?.id), homeTeam:home, awayTeam:away,
            homeScore:f.goals?.home??null, awayScore:f.goals?.away??null,
            status:'FINISHED', matchDate:f.fixture?.date, stage:'FRIENDLY',
          }); c++;
        }
      }
      console.log(`  ✅ Friendlies: ${c} WC-team matches`);
    }
  } catch(err) { console.error('  ❌ AF friendlies error:', err.message); }
  return results;
}

// ── CONFLICT DETECTION ────────────────────────────────────────
function detectConflict(p,s) {
  if(!p||!s||p.homeScore===null||s.homeScore===null) return false;
  return p.homeScore!==s.homeScore||p.awayScore!==s.awayScore;
}
function confidence(p,s,conflict) {
  if(conflict) return 'conflicting';
  if(p&&s) return 'confirmed_both';
  if(p) return 'confirmed_primary';
  if(s) return 'confirmed_secondary';
  return 'estimated';
}

// ── FORM CACHE ────────────────────────────────────────────────
async function updateForm(home,away,hs,as_,date,comp,source) {
  if(hs===null||as_===null) return;
  const weight=recencyWeight(date);
  const entries=[];
  if(WC_TEAMS.has(home)) entries.push({team_id:home,opponent_id:away,match_date:date,competition:comp,home_away:'H',goals_for:hs,goals_against:as_,result:hs>as_?'W':hs<as_?'L':'D',weight,source});
  if(WC_TEAMS.has(away)) entries.push({team_id:away,opponent_id:home,match_date:date,competition:comp,home_away:'A',goals_for:as_,goals_against:hs,result:as_>hs?'W':as_<hs?'L':'D',weight,source});
  if(DRY_RUN){entries.forEach(e=>console.log(`  [DRY] Form: ${e.team_id} ${e.result} vs ${e.opponent_id}`));return;}
  for(const entry of entries) {
    await supabase.from('form_cache').upsert(entry,{onConflict:'team_id,match_date',ignoreDuplicates:false});
  }
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n🟢 Olivos Oracle · Sync · ${new Date().toISOString()}\n`);

  // 1. Fetch Elo ratings
  const eloMap = await fetchEloRatings();
  const finalElo = Object.keys(eloMap).length > 10 ? eloMap : FALLBACK_ELO;
  console.log(`  Using ${Object.keys(finalElo).length === Object.keys(FALLBACK_ELO).length && eloMap===FALLBACK_ELO ? 'FALLBACK' : 'LIVE'} Elo data`);

  // 2. Get current form scores from Supabase
  const { data: currentTeams } = await supabase.from('teams').select('id,form_score,fifa_rank');
  const formScores = {};
  (currentTeams||[]).forEach(t => { formScores[t.id] = t.form_score||0; });

  // 3. Update team strengths with new Elo
  console.log('\n🧮 Updating team strengths...');
  for (const [team, rank] of Object.entries(FIFA_RANK)) {
    const { base, withForm, elo } = computeStrength(team, finalElo, formScores[team]||0, rank);
    if (!DRY_RUN) {
      await supabase.from('teams').upsert({
        id:team, name:team, fifa_rank:rank,
        elo_rating:elo, base_strength:base,
        last_updated:new Date().toISOString(),
      }, { onConflict:'id' });
    } else {
      console.log(`  [DRY] ${team}: elo=${elo} base=${base}`);
    }
  }
  console.log('  ✅ Team strengths updated');

  // 4. Fetch match results
  const [primary, secondary] = await Promise.all([fetchFootballData(), fetchApiFootball()]);
  const secIdx = {};
  secondary.forEach(m => { secIdx[`${m.homeTeam}|${m.awayTeam}|${m.competition}`]=m; });

  let synced=0, locked_=0, conflicts=0;

  for (const p of primary) {
    const key=`${p.homeTeam}|${p.awayTeam}|${p.competition}`;
    const s=secIdx[key];
    const fin=isFinished(p.status);
    const conflict=fin&&detectConflict(p,s);
    const conf=confidence(fin?p:null,fin&&s?s:null,conflict);
    const matchId=`${p.competition}_${p.homeTeam}_${p.awayTeam}`.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
    const rec={
      id:matchId, football_data_id:parseInt(p.apiId)||null,
      api_football_id:s?parseInt(s.apiId)||null:null,
      competition:p.competition, stage:p.stage,
      home_team:p.homeTeam, away_team:p.awayTeam,
      home_score:fin?p.homeScore:null, away_score:fin?p.awayScore:null,
      status:fin?'FINISHED':p.status, match_date:p.matchDate,
      source_primary:fin?`${p.homeScore}-${p.awayScore}`:null,
      source_secondary:(fin&&s)?`${s.homeScore}-${s.awayScore}`:null,
      confidence:conf,
      locked:fin&&!conflict&&conf!=='conflicting',
      conflict_flagged:conflict,
      last_updated:new Date().toISOString(),
    };
    if(!DRY_RUN) await supabase.from('matches').upsert(rec,{onConflict:'id'});
    else console.log(`  [DRY] ${p.homeTeam} vs ${p.awayTeam}: ${conf}${conflict?' ⚠️':rec.locked?' 🔒':''}`);
    if(conflict&&!DRY_RUN){await supabase.from('conflict_log').insert({match_id:matchId,primary_score:`${p.homeScore}-${p.awayScore}`,secondary_score:`${s.homeScore}-${s.awayScore}`,detected_at:new Date().toISOString(),resolved:false});conflicts++;}
    if(fin&&p.homeScore!==null) await updateForm(p.homeTeam,p.awayTeam,p.homeScore,p.awayScore,p.matchDate,p.competition,'football-data');
    if(rec.locked) locked_++;
    synced++;
  }

  // Friendlies from API-Football
  for (const m of secondary.filter(m=>m.competition==='FRIENDLY')) {
    const matchId=`FRIENDLY_${m.homeTeam}_${m.awayTeam}_${(m.matchDate||'').substring(0,10)}`.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
    await updateForm(m.homeTeam,m.awayTeam,m.homeScore,m.awayScore,m.matchDate,'FRIENDLY','api-football');
    if(!DRY_RUN) await supabase.from('matches').upsert({id:matchId,api_football_id:parseInt(m.apiId)||null,competition:'FRIENDLY',stage:'FRIENDLY',home_team:m.homeTeam,away_team:m.awayTeam,home_score:m.homeScore,away_score:m.awayScore,status:'FINISHED',match_date:m.matchDate,source_secondary:`${m.homeScore}-${m.awayScore}`,confidence:'confirmed_secondary',locked:true,last_updated:new Date().toISOString()},{onConflict:'id',ignoreDuplicates:true});
  }

  // Recalculate form scores
  const{data:formData}=await supabase.from('team_recent_form').select('*');
  for(const row of formData||[]){
    const adj=Math.min(10,Math.max(-10,(row.weighted_form_score-1.5)*3));
    if(!DRY_RUN) await supabase.from('teams').update({form_score:adj,last_updated:new Date().toISOString()}).eq('id',row.team_id);
  }

  console.log(`\n✅ Done · Synced:${synced} Locked:${locked_} Conflicts:${conflicts}`);
}

main().catch(err=>{console.error('💥',err);process.exit(1);});
