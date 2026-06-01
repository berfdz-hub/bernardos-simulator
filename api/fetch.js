// ============================================================
// Olivos Oracle · /api/fetch.js
// Vercel Serverless Function — no npm deps, native fetch only
// ============================================================

function sbH(key){return{'apikey':key,'Authorization':`Bearer ${key}`,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'};}
async function sbUp(url,key,table,data){
  const r=await fetch(`${url}/rest/v1/${table}`,{method:'POST',headers:sbH(key),body:JSON.stringify(Array.isArray(data)?data:[data])});
  if(!r.ok){const t=await r.text();console.error(`SB ${table} ${r.status}`,t.slice(0,100));}
  return r.ok;
}
async function sbPa(url,key,table,q,data){
  const r=await fetch(`${url}/rest/v1/${table}?${q}`,{method:'PATCH',headers:sbH(key),body:JSON.stringify(data)});
  return r.ok;
}
async function sbSe(url,key,table,q=''){
  const r=await fetch(`${url}/rest/v1/${table}?${q}`,{headers:{'apikey':key,'Authorization':`Bearer ${key}`}});
  return r.ok?r.json():[];
}
async function sbIn(url,key,table,data){
  const r=await fetch(`${url}/rest/v1/${table}`,{method:'POST',headers:{...sbH(key),'Prefer':'return=minimal'},body:JSON.stringify(data)});
  return r.ok;
}

const TEAM_MAP={'Mexico':'Mexico','South Africa':'South Africa','Korea Republic':'Korea Republic','Czech Republic':'Czechia','Czechia':'Czechia','Canada':'Canada','Bosnia and Herzegovina':'Bosnia & Herzegovina','Bosnia-Herzegovina':'Bosnia & Herzegovina','Qatar':'Qatar','Switzerland':'Switzerland','Brazil':'Brazil','Morocco':'Morocco','Haiti':'Haiti','Scotland':'Scotland','United States':'USA','USA':'USA','Paraguay':'Paraguay','Australia':'Australia','Turkey':'Turkiye','Türkiye':'Turkiye','Turkiye':'Turkiye','Germany':'Germany','Curaçao':'Curacao',"Côte d'Ivoire":"Cote d'Ivoire",'Ivory Coast':"Cote d'Ivoire",'Ecuador':'Ecuador','Netherlands':'Netherlands','Japan':'Japan','Sweden':'Sweden','Tunisia':'Tunisia','Belgium':'Belgium','Egypt':'Egypt','Iran':'IR Iran','IR Iran':'IR Iran','New Zealand':'New Zealand','Spain':'Spain','Cape Verde':'Cabo Verde','Cabo Verde':'Cabo Verde','Saudi Arabia':'Saudi Arabia','Uruguay':'Uruguay','France':'France','Senegal':'Senegal','Iraq':'Iraq','Norway':'Norway','Argentina':'Argentina','Algeria':'Algeria','Austria':'Austria','Jordan':'Jordan','Portugal':'Portugal','DR Congo':'Congo DR','Congo DR':'Congo DR','Democratic Republic of Congo':'Congo DR','Uzbekistan':'Uzbekistan','Colombia':'Colombia','England':'England','Croatia':'Croatia','Ghana':'Ghana','Panama':'Panama'};
const WC=new Set(Object.values(TEAM_MAP));
const nm=n=>TEAM_MAP[n]||n;
const fin=s=>['FINISHED','FT','AET','PEN'].includes((s||'').toUpperCase());
const rw=d=>{const x=(Date.now()-new Date(d))/86400000;return x<=30?1:x<=60?.85:x<=90?.7:x<=120?.55:x<=180?.4:.25;};

const FR={Mexico:15,'South Africa':60,'Korea Republic':22,Czechia:43,Canada:30,'Bosnia & Herzegovina':66,Qatar:56,Switzerland:19,Brazil:7,Morocco:8,Haiti:83,Scotland:40,USA:16,Paraguay:38,Australia:27,Turkiye:24,Germany:10,Curacao:82,"Cote d'Ivoire":35,Ecuador:23,Netherlands:6,Japan:18,Sweden:41,Tunisia:44,Belgium:9,Egypt:29,'IR Iran':21,'New Zealand':85,Spain:1,'Cabo Verde':70,'Saudi Arabia':61,Uruguay:17,France:2,Senegal:149,Iraq:59,Norway:31,Argentina:3,Algeria:28,Austria:25,Jordan:64,Portugal:5,'Congo DR':48,Uzbekistan:50,Colombia:13,England:4,Croatia:11,Ghana:74,Panama:34};
const FE={France:2057,Spain:2010,England:2001,Brazil:1994,Argentina:1990,Portugal:1969,Netherlands:1965,Germany:1952,Morocco:1948,Belgium:1944,Uruguay:1934,Colombia:1921,Japan:1878,'Korea Republic':1830,Mexico:1853,USA:1856,Croatia:1862,Switzerland:1844,Australia:1817,Norway:1834,Austria:1837,Sweden:1832,Turkiye:1830,Ecuador:1805,'IR Iran':1840,"Cote d'Ivoire":1790,Egypt:1782,Algeria:1810,Tunisia:1770,Czechia:1820,Scotland:1790,Senegal:1799,Qatar:1730,'Saudi Arabia':1755,'Cabo Verde':1720,'South Africa':1700,Panama:1734,Ghana:1742,'Bosnia & Herzegovina':1760,Uzbekistan:1740,'Congo DR':1720,Jordan:1650,'New Zealand':1610,Haiti:1580,Iraq:1680,Curacao:1530,Paraguay:1800};
const WH={Brazil:10,Germany:9,Argentina:9,France:8,Spain:7,England:6,Uruguay:5,Netherlands:4,Portugal:3,Croatia:3,Mexico:2,USA:1,Belgium:1,Sweden:1};

function str(team,em){
  const elo=em[team]||1600,rank=FR[team]||80;
  const eN=Math.max(20,Math.min(99,Math.round((elo-1400)/700*79+20)));
  const rN=Math.max(25,Math.round(95-(rank-1)*0.47));
  const h=Math.min(2,(WH[team]||0)*0.2);
  return Math.round(eN*0.55+rN*0.35+h+50*0.05);
}

async function fetchElo(){
  try{
    const r=await fetch('https://www.eloratings.net/World',{headers:{'User-Agent':'Mozilla/5.0'}});
    if(!r.ok)return FE;
    const html=await r.text(),em={};
    for(const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g)||[]){
      const cells=[...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>m[1].replace(/<[^>]+>/g,'').trim());
      if(cells.length>=3){const n=nm(cells[1]||cells[0]),e=parseInt((cells[2]||'').replace(/[^0-9]/g,''));if(n&&e>1000&&e<2500&&WC.has(n))em[n]=e;}
    }
    return Object.keys(em).length>20?em:FE;
  }catch{return FE;}
}

async function fetchFD(key){
  if(!key)return[];
  try{
    const r=await fetch('https://api.football-data.org/v4/competitions/WC/matches?season=2026',{headers:{'X-Auth-Token':key}});
    if(!r.ok)return[];
    const data=await r.json();
    return(data.matches||[]).map(m=>({source:'football-data',competition:'WC2026',apiId:String(m.id),homeTeam:nm(m.homeTeam?.name||''),awayTeam:nm(m.awayTeam?.name||''),homeScore:m.score?.fullTime?.home??null,awayScore:m.score?.fullTime?.away??null,status:m.status,matchDate:m.utcDate,stage:m.stage||'GROUP_STAGE'}));
  }catch{return[];}
}

async function fetchAF(key){
  if(!key)return[];
  const h={'x-apisports-key':key},res=[];
  try{const r=await fetch('https://v3.football.api-sports.io/fixtures?league=1&season=2026',{headers:h});if(r.ok){const d=await r.json();for(const f of d.response||[])res.push({source:'api-football',competition:'WC2026',apiId:String(f.fixture?.id),homeTeam:nm(f.teams?.home?.name||''),awayTeam:nm(f.teams?.away?.name||''),homeScore:f.goals?.home??null,awayScore:f.goals?.away??null,status:f.fixture?.status?.short||'NS',matchDate:f.fixture?.date,stage:f.league?.round||'GROUP_STAGE'});}}catch{}
  await new Promise(r=>setTimeout(r,1000));
  try{const r=await fetch('https://v3.football.api-sports.io/fixtures?league=9&season=2026&last=60',{headers:h});if(r.ok){const d=await r.json();for(const f of d.response||[]){const hm=nm(f.teams?.home?.name||''),am=nm(f.teams?.away?.name||'');if(f.fixture?.status?.short==='FT'&&(WC.has(hm)||WC.has(am)))res.push({source:'api-football',competition:'FRIENDLY',apiId:String(f.fixture?.id),homeTeam:hm,awayTeam:am,homeScore:f.goals?.home??null,awayScore:f.goals?.away??null,status:'FINISHED',matchDate:f.fixture?.date,stage:'FRIENDLY'});}}}catch{}
  return res;
}

export default async function handler(req,res){
  const secret=process.env.CRON_SECRET;
  if(secret&&req.headers['authorization']!==`Bearer ${secret}`)return res.status(401).json({error:'Unauthorized'});

  const SU=process.env.SUPABASE_URL,SK=process.env.SUPABASE_SERVICE_KEY;
  const FD=process.env.FOOTBALL_DATA_KEY,AF=process.env.API_FOOTBALL_KEY;
  if(!SU||!SK)return res.status(500).json({error:'Missing Supabase config'});

  const log=[];
  const out=m=>{console.log(m);log.push(m);};

  try{
    out(`🟢 ${new Date().toISOString()}`);

    // Elo + team strengths
    const em=await fetchElo();
    out(`Elo: ${Object.keys(em).length} teams`);
    const teams=Object.keys(FR);
    await sbUp(SU,SK,'teams',teams.map(t=>({id:t,name:t,fifa_rank:FR[t],elo_rating:em[t]||FE[t]||1600,base_strength:str(t,em),last_updated:new Date().toISOString()})));
    out(`Teams: ${teams.length} updated`);

    // Match results
    const[primary,secondary]=await Promise.all([fetchFD(FD),fetchAF(AF)]);
    out(`FD:${primary.length} AF:${secondary.length}`);
    const si={};secondary.forEach(m=>{si[`${m.homeTeam}|${m.awayTeam}|${m.competition}`]=m;});

    let synced=0,locked=0,conflicts=0;
    const mb=[],fb=[];

    for(const p of primary){
      const s=si[`${p.homeTeam}|${p.awayTeam}|${p.competition}`];
      const f=fin(p.status);
      const cf=f&&p.homeScore!==null&&s?.homeScore!=null&&(p.homeScore!==s.homeScore||p.awayScore!==s.awayScore);
      const conf=cf?'conflicting':f&&s?'confirmed_both':f?'confirmed_primary':'estimated';
      const id=`${p.competition}_${p.homeTeam}_${p.awayTeam}`.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
      mb.push({id,football_data_id:parseInt(p.apiId)||null,api_football_id:s?parseInt(s.apiId)||null:null,competition:p.competition,stage:p.stage,home_team:p.homeTeam,away_team:p.awayTeam,home_score:f?p.homeScore:null,away_score:f?p.awayScore:null,status:f?'FINISHED':p.status,match_date:p.matchDate,source_primary:f?`${p.homeScore}-${p.awayScore}`:null,source_secondary:(f&&s)?`${s.homeScore}-${s.awayScore}`:null,confidence:conf,locked:f&&!cf,conflict_flagged:cf,last_updated:new Date().toISOString()});
      if(cf){await sbIn(SU,SK,'conflict_log',{match_id:id,primary_score:`${p.homeScore}-${p.awayScore}`,secondary_score:`${s.homeScore}-${s.awayScore}`,detected_at:new Date().toISOString(),resolved:false});conflicts++;}
      if(f&&!cf)locked++;synced++;
      // form
      const w=rw(p.matchDate);
      if(f&&p.homeScore!==null){
        if(WC.has(p.homeTeam))fb.push({team_id:p.homeTeam,opponent_id:p.awayTeam,match_date:p.matchDate,competition:p.competition,home_away:'H',goals_for:p.homeScore,goals_against:p.awayScore,result:p.homeScore>p.awayScore?'W':p.homeScore<p.awayScore?'L':'D',weight:w,source:'football-data'});
        if(WC.has(p.awayTeam))fb.push({team_id:p.awayTeam,opponent_id:p.homeTeam,match_date:p.matchDate,competition:p.competition,home_away:'A',goals_for:p.awayScore,goals_against:p.homeScore,result:p.awayScore>p.homeScore?'W':p.awayScore<p.homeScore?'L':'D',weight:w,source:'football-data'});
      }
    }
    // friendlies form
    for(const m of secondary.filter(m=>m.competition==='FRIENDLY'&&m.homeScore!==null)){
      const w=rw(m.matchDate);
      if(WC.has(m.homeTeam))fb.push({team_id:m.homeTeam,opponent_id:m.awayTeam,match_date:m.matchDate,competition:'FRIENDLY',home_away:'H',goals_for:m.homeScore,goals_against:m.awayScore,result:m.homeScore>m.awayScore?'W':m.homeScore<m.awayScore?'L':'D',weight:w,source:'api-football'});
      if(WC.has(m.awayTeam))fb.push({team_id:m.awayTeam,opponent_id:m.homeTeam,match_date:m.matchDate,competition:'FRIENDLY',home_away:'A',goals_for:m.awayScore,goals_against:m.homeScore,result:m.awayScore>m.homeScore?'W':m.awayScore<m.homeScore?'L':'D',weight:w,source:'api-football'});
    }

    if(mb.length>0)await sbUp(SU,SK,'matches',mb);
    if(fb.length>0)await sbUp(SU,SK,'form_cache',fb);

    // form scores
    const fd=await sbSe(SU,SK,'team_recent_form');
    for(const row of fd){
      const adj=Math.min(10,Math.max(-10,(row.weighted_form_score-1.5)*3));
      await sbPa(SU,SK,'teams',`id=eq.${encodeURIComponent(row.team_id)}`,{form_score:adj,last_updated:new Date().toISOString()});
    }

    out(`✅ Synced:${synced} Locked:${locked} Conflicts:${conflicts}`);
    return res.status(200).json({ok:true,synced,locked,conflicts,log});
  }catch(err){
    console.error('💥',err);
    return res.status(500).json({error:err.message,log});
  }
}
