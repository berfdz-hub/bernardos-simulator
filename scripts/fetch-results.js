// ============================================================
// OlivosPredictor · fetch-results.js
// Pulls from football-data.org (primary) + API-Football (secondary)
// Resolves conflicts, updates Supabase, locks finished matches
// ============================================================

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const DRY_RUN = process.argv.includes('--dry-run');

// ── ENV VARS (from GitHub Secrets) ───────────────────────────
const {
  FOOTBALL_DATA_KEY,
  API_FOOTBALL_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
} = process.env;

if (!FOOTBALL_DATA_KEY || !API_FOOTBALL_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

// ── SUPABASE CLIENT (service role = full access) ──────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── TEAM NAME MAPPING ─────────────────────────────────────────
// Maps API names → our internal names
const TEAM_MAP = {
  // football-data.org names
  'Mexico':                    'Mexico',
  'South Africa':              'South Africa',
  'Korea Republic':            'Korea Republic',
  'Czech Republic':            'Czechia',
  'Czechia':                   'Czechia',
  'Canada':                    'Canada',
  'Bosnia and Herzegovina':    'Bosnia & Herzegovina',
  'Qatar':                     'Qatar',
  'Switzerland':               'Switzerland',
  'Brazil':                    'Brazil',
  'Morocco':                   'Morocco',
  'Haiti':                     'Haiti',
  'Scotland':                  'Scotland',
  'United States':             'USA',
  'USA':                       'USA',
  'Paraguay':                  'Paraguay',
  'Australia':                 'Australia',
  'Turkey':                    'Turkiye',
  'Türkiye':                   'Turkiye',
  'Turkiye':                   'Turkiye',
  'Germany':                   'Germany',
  'Curaçao':                   'Curacao',
  "Côte d'Ivoire":             "Cote d'Ivoire",
  'Ivory Coast':               "Cote d'Ivoire",
  'Ecuador':                   'Ecuador',
  'Netherlands':               'Netherlands',
  'Japan':                     'Japan',
  'Sweden':                    'Sweden',
  'Tunisia':                   'Tunisia',
  'Belgium':                   'Belgium',
  'Egypt':                     'Egypt',
  'Iran':                      'IR Iran',
  'IR Iran':                   'IR Iran',
  'New Zealand':               'New Zealand',
  'Spain':                     'Spain',
  'Cape Verde':                'Cabo Verde',
  'Cabo Verde':                'Cabo Verde',
  'Saudi Arabia':              'Saudi Arabia',
  'Uruguay':                   'Uruguay',
  'France':                    'France',
  'Senegal':                   'Senegal',
  'Iraq':                      'Iraq',
  'Norway':                    'Norway',
  'Argentina':                 'Argentina',
  'Algeria':                   'Algeria',
  'Austria':                   'Austria',
  'Jordan':                    'Jordan',
  'Portugal':                  'Portugal',
  'DR Congo':                  'Congo DR',
  'Congo DR':                  'Congo DR',
  'Democratic Republic of Congo': 'Congo DR',
  'Uzbekistan':                'Uzbekistan',
  'Colombia':                  'Colombia',
  'England':                   'England',
  'Croatia':                   'Croatia',
  'Ghana':                     'Ghana',
  'Panama':                    'Panama',
};

function normalizeTeam(name) {
  return TEAM_MAP[name] || name;
}

// ── WORLD CUP TEAMS SET ───────────────────────────────────────
const WC_TEAMS = new Set(Object.values(TEAM_MAP));

// ── RECENCY WEIGHT ────────────────────────────────────────────
function recencyWeight(matchDate) {
  const days = (Date.now() - new Date(matchDate)) / (1000 * 60 * 60 * 24);
  if (days <= 30)  return 1.0;
  if (days <= 60)  return 0.85;
  if (days <= 90)  return 0.70;
  if (days <= 120) return 0.55;
  if (days <= 180) return 0.40;
  return 0.25;
}

// ── FOOTBALL-DATA.ORG ─────────────────────────────────────────
async function fetchFromFootballData() {
  console.log('📡 Fetching from football-data.org...');
  const results = [];

  // 1. World Cup 2026 matches
  try {
    const res = await fetch(
      'https://api.football-data.org/v4/competitions/WC/matches?season=2026',
      { headers: { 'X-Auth-Token': FOOTBALL_DATA_KEY } }
    );

    // Respect rate limit headers
    const remaining = res.headers.get('X-Requests-Available-Minute');
    if (remaining && parseInt(remaining) < 3) {
      console.warn('⚠️  Rate limit approaching on football-data.org, slowing down');
      await sleep(10000);
    }

    if (res.ok) {
      const data = await res.json();
      for (const match of data.matches || []) {
        results.push({
          source: 'football-data',
          competition: 'WC2026',
          apiId: String(match.id),
          homeTeam: normalizeTeam(match.homeTeam?.name || ''),
          awayTeam: normalizeTeam(match.awayTeam?.name || ''),
          homeScore: match.score?.fullTime?.home ?? null,
          awayScore: match.score?.fullTime?.away ?? null,
          status: match.status,
          matchDate: match.utcDate,
          stage: match.stage || 'GROUP_STAGE',
          group: match.group || null,
        });
      }
      console.log(`  ✅ WC2026: ${results.length} matches from football-data.org`);
    } else {
      console.error(`  ❌ WC fetch failed: ${res.status}`);
    }
  } catch (err) {
    console.error(`  ❌ football-data.org WC error: ${err.message}`);
  }

  return results;
}

// ── API-FOOTBALL ──────────────────────────────────────────────
async function fetchFromApiFootball() {
  console.log('📡 Fetching from API-Football...');
  const results = [];

  const headers = {
    'x-apisports-key': API_FOOTBALL_KEY,
  };

  // 1. World Cup 2026 (league=1, season=2026)
  try {
    const res = await fetch(
      'https://v3.football.api-sports.io/fixtures?league=1&season=2026',
      { headers }
    );

    const remaining = res.headers.get('x-ratelimit-requests-remaining');
    if (remaining && parseInt(remaining) < 5) {
      console.warn('⚠️  Rate limit approaching on API-Football');
      await sleep(15000);
    }

    if (res.ok) {
      const data = await res.json();
      let count = 0;
      for (const fixture of data.response || []) {
        const home = normalizeTeam(fixture.teams?.home?.name || '');
        const away = normalizeTeam(fixture.teams?.away?.name || '');
        results.push({
          source: 'api-football',
          competition: 'WC2026',
          apiId: String(fixture.fixture?.id),
          homeTeam: home,
          awayTeam: away,
          homeScore: fixture.goals?.home ?? null,
          awayScore: fixture.goals?.away ?? null,
          status: fixture.fixture?.status?.short || 'NS',
          matchDate: fixture.fixture?.date,
          stage: fixture.league?.round || 'GROUP_STAGE',
        });
        count++;
      }
      console.log(`  ✅ WC2026: ${count} matches from API-Football`);
    }
  } catch (err) {
    console.error(`  ❌ API-Football WC error: ${err.message}`);
  }

  // 2. International friendlies (league=9, season=2026)
  try {
    await sleep(1000); // be polite to API
    const res = await fetch(
      'https://v3.football.api-sports.io/fixtures?league=9&season=2026&last=50',
      { headers }
    );

    if (res.ok) {
      const data = await res.json();
      let count = 0;
      for (const fixture of data.response || []) {
        const home = normalizeTeam(fixture.teams?.home?.name || '');
        const away = normalizeTeam(fixture.teams?.away?.name || '');

        // Only care about WC teams
        if (!WC_TEAMS.has(home) && !WC_TEAMS.has(away)) continue;

        if (fixture.fixture?.status?.short === 'FT') {
          results.push({
            source: 'api-football',
            competition: 'FRIENDLY',
            apiId: String(fixture.fixture?.id),
            homeTeam: home,
            awayTeam: away,
            homeScore: fixture.goals?.home ?? null,
            awayScore: fixture.goals?.away ?? null,
            status: 'FINISHED',
            matchDate: fixture.fixture?.date,
            stage: 'FRIENDLY',
          });
          count++;
        }
      }
      console.log(`  ✅ Friendlies: ${count} WC-team matches from API-Football`);
    }
  } catch (err) {
    console.error(`  ❌ API-Football friendlies error: ${err.message}`);
  }

  return results;
}

// ── CONFLICT DETECTION ────────────────────────────────────────
function detectConflict(primary, secondary) {
  if (!primary || !secondary) return false;
  if (primary.homeScore === null || secondary.homeScore === null) return false;
  return (
    primary.homeScore !== secondary.homeScore ||
    primary.awayScore !== secondary.awayScore
  );
}

function confidenceLevel(primary, secondary, conflict) {
  if (conflict) return 'conflicting';
  if (primary && secondary) return 'confirmed_both';
  if (primary) return 'confirmed_primary';
  if (secondary) return 'confirmed_secondary';
  return 'estimated';
}

function isFinished(status) {
  return ['FINISHED', 'FT', 'AET', 'PEN'].includes(status?.toUpperCase());
}

// ── FORM CACHE UPDATE ─────────────────────────────────────────
async function updateFormCache(homeTeam, awayTeam, homeScore, awayScore, matchDate, competition, source) {
  if (homeScore === null || awayScore === null) return;
  if (!WC_TEAMS.has(homeTeam) && !WC_TEAMS.has(awayTeam)) return;

  const weight = recencyWeight(matchDate);
  const entries = [];

  if (WC_TEAMS.has(homeTeam)) {
    entries.push({
      team_id: homeTeam,
      opponent_id: awayTeam,
      match_date: matchDate,
      competition,
      home_away: 'H',
      goals_for: homeScore,
      goals_against: awayScore,
      result: homeScore > awayScore ? 'W' : homeScore < awayScore ? 'L' : 'D',
      opponent_rank: null,
      weight,
      source,
    });
  }

  if (WC_TEAMS.has(awayTeam)) {
    entries.push({
      team_id: awayTeam,
      opponent_id: homeTeam,
      match_date: matchDate,
      competition,
      home_away: 'A',
      goals_for: awayScore,
      goals_against: homeScore,
      result: awayScore > homeScore ? 'W' : awayScore < homeScore ? 'L' : 'D',
      opponent_rank: null,
      weight,
      source,
    });
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would upsert form cache:`, entries.map(e => `${e.team_id} ${e.result} vs ${e.opponent_id}`));
    return;
  }

  for (const entry of entries) {
    const { error } = await supabase
      .from('form_cache')
      .upsert(entry, {
        onConflict: 'team_id,match_date',
        ignoreDuplicates: false,
      });
    if (error) console.error(`  ❌ Form cache error for ${entry.team_id}:`, error.message);
  }
}

// ── TEAM STRENGTH RECALCULATION ───────────────────────────────
async function recalculateTeamStrengths() {
  console.log('🧮 Recalculating team strengths...');

  const { data: formData, error } = await supabase
    .from('team_recent_form')
    .select('*');

  if (error) {
    console.error('❌ Could not fetch form data:', error.message);
    return;
  }

  for (const row of formData || []) {
    const formAdjustment = Math.min(10, Math.max(-10,
      (row.weighted_form_score - 1.5) * 3
    ));

    if (DRY_RUN) {
      console.log(`  [DRY RUN] ${row.team_id}: form adjustment ${formAdjustment.toFixed(2)}`);
      continue;
    }

    await supabase
      .from('teams')
      .update({
        form_score: formAdjustment,
        last_updated: new Date().toISOString(),
      })
      .eq('id', row.team_id);
  }

  console.log('  ✅ Team strengths updated');
}

// ── MAIN SYNC ─────────────────────────────────────────────────
async function syncResults() {
  console.log(`\n🟢 OlivosPredictor · Result Sync · ${new Date().toISOString()}`);
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  // Fetch from both APIs in parallel
  const [primaryResults, secondaryResults] = await Promise.all([
    fetchFromFootballData(),
    fetchFromApiFootball(),
  ]);

  // Index secondary results for fast lookup
  const secondaryIndex = {};
  for (const m of secondaryResults) {
    const key = `${m.homeTeam}|${m.awayTeam}|${m.competition}`;
    secondaryIndex[key] = m;
  }

  let synced = 0;
  let conflicts = 0;
  let locked = 0;

  // Process primary results
  for (const primary of primaryResults) {
    const key = `${primary.homeTeam}|${primary.awayTeam}|${primary.competition}`;
    const secondary = secondaryIndex[key];

    const finished = isFinished(primary.status);
    const conflict = finished && detectConflict(primary, secondary);
    const confidence = confidenceLevel(
      finished ? primary : null,
      finished && secondary ? secondary : null,
      conflict
    );

    const matchId = `${primary.competition}_${primary.homeTeam}_${primary.awayTeam}`
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '');

    const matchRecord = {
      id: matchId,
      football_data_id: parseInt(primary.apiId) || null,
      api_football_id: secondary ? parseInt(secondary.apiId) || null : null,
      competition: primary.competition,
      stage: primary.stage,
      home_team: primary.homeTeam,
      away_team: primary.awayTeam,
      home_score: finished ? primary.homeScore : null,
      away_score: finished ? primary.awayScore : null,
      status: finished ? 'FINISHED' : primary.status,
      match_date: primary.matchDate,
      source_primary: finished ? `${primary.homeScore}-${primary.awayScore}` : null,
      source_secondary: (finished && secondary)
        ? `${secondary.homeScore}-${secondary.awayScore}`
        : null,
      confidence,
      locked: finished && !conflict && confidence !== 'conflicting',
      conflict_flagged: conflict,
      last_updated: new Date().toISOString(),
    };

    if (DRY_RUN) {
      console.log(`  [DRY RUN] ${primary.homeTeam} vs ${primary.awayTeam}: ${confidence}${conflict ? ' ⚠️ CONFLICT' : ''}${matchRecord.locked ? ' 🔒' : ''}`);
    } else {
      const { error } = await supabase
        .from('matches')
        .upsert(matchRecord, {
          onConflict: 'id',
          ignoreDuplicates: false,
        });

      if (error) {
        console.error(`  ❌ Match upsert error ${matchId}:`, error.message);
        continue;
      }
    }

    // Log conflicts
    if (conflict && !DRY_RUN) {
      await supabase.from('conflict_log').insert({
        match_id: matchId,
        primary_score: `${primary.homeScore}-${primary.awayScore}`,
        secondary_score: `${secondary.homeScore}-${secondary.awayScore}`,
        detected_at: new Date().toISOString(),
        resolved: false,
      });
      conflicts++;
      console.warn(`  ⚠️  CONFLICT: ${primary.homeTeam} vs ${primary.awayTeam} | FD: ${primary.homeScore}-${primary.awayScore} | AF: ${secondary.homeScore}-${secondary.awayScore}`);
    }

    // Update form cache for finished matches
    if (finished && primary.homeScore !== null) {
      await updateFormCache(
        primary.homeTeam,
        primary.awayTeam,
        primary.homeScore,
        primary.awayScore,
        primary.matchDate,
        primary.competition,
        'football-data'
      );
    }

    if (matchRecord.locked) locked++;
    synced++;
  }

  // Process friendly results from API-Football (no primary counterpart)
  const friendlies = secondaryResults.filter(m => m.competition === 'FRIENDLY');
  for (const m of friendlies) {
    const matchId = `FRIENDLY_${m.homeTeam}_${m.awayTeam}_${m.matchDate?.substring(0,10)}`
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '');

    await updateFormCache(
      m.homeTeam,
      m.awayTeam,
      m.homeScore,
      m.awayScore,
      m.matchDate,
      'FRIENDLY',
      'api-football'
    );

    if (!DRY_RUN) {
      await supabase.from('matches').upsert({
        id: matchId,
        api_football_id: parseInt(m.apiId) || null,
        competition: 'FRIENDLY',
        stage: 'FRIENDLY',
        home_team: m.homeTeam,
        away_team: m.awayTeam,
        home_score: m.homeScore,
        away_score: m.awayScore,
        status: 'FINISHED',
        match_date: m.matchDate,
        source_secondary: `${m.homeScore}-${m.awayScore}`,
        confidence: 'confirmed_secondary',
        locked: true,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'id', ignoreDuplicates: true });
    }
  }

  // Recalculate team strengths based on updated form
  await recalculateTeamStrengths();

  console.log(`\n✅ Sync complete`);
  console.log(`   Matches synced: ${synced}`);
  console.log(`   Locked results: ${locked}`);
  console.log(`   Conflicts:      ${conflicts}`);
  if (conflicts > 0) {
    console.log(`   ⚠️  Check pending_conflicts view in Supabase`);
  }
}

// ── HELPERS ───────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── RUN ───────────────────────────────────────────────────────
syncResults().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
