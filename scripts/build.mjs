// Builds one country's movie list for CinemAlert from TMDB (+ OMDb scores).
// Plain JavaScript with no Node-only code, so it can also be tested in a browser.

const TMDB = "https://api.themoviedb.org/3";
const DAY = 864e5;
// OMDb's free key allows 1,000 lookups a day; the job runs 4 times a day.
export const OMDB_PER_RUN = 220;
// How long a saved IMDb / Rotten Tomatoes score is trusted before it's checked again.
const SCORE_MAX_AGE = 2 * DAY;
// How far ahead "Coming soon" reaches.
const AHEAD_DAYS = 90;
/* "Likely playing near you". TMDB volunteers mark far too many films as wide releases (338 at once in Oct 2026,
   when real wide releases number ~30–50), so a film counts only if it's a wide, non-re-release that is also among
   the most popular of its group: in theaters for at most NOW_MAX_DAYS, or opening within SOON_DAYS. Still an
   educated guess, and the app words it that way.
   Popularity floors (tuned Oct 24, 2026): unreleased films are mostly near 0–5, so a floor keeps tiny releases out of
   a thin "top 20". Non-English films mostly open only at specialty and community cinemas in the US, so they need a
   breakout-level score. */
const NOW_TOP = 45, NOW_MAX_DAYS = 70, SOON_TOP = 20, SOON_DAYS = 14, MIN_POPULARITY = 15, NON_EN_MIN_POPULARITY = 100;

const isoLocal = d => d.toISOString().slice(0, 10);
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function tmdbClient(key, log){
  const bearer = key.length > 60;
  return async function tmdb(path, params = {}){
    const u = new URL(TMDB + path);
    if (!bearer) u.searchParams.set("api_key", key);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    for (let attempt = 1; ; attempt++){
      const r = await fetch(u, bearer ? {headers: {Authorization: "Bearer " + key}} : {});
      if (r.ok) return r.json();
      if (r.status === 401) throw new Error("TMDB rejected the key (401). Check the TMDB_KEY secret.");
      if (r.status === 404) return null;
      if (attempt >= 4) throw new Error(`TMDB ${path} failed with ${r.status}`);
      log?.(`TMDB ${r.status} on ${path}, retrying`);
      await sleep(1000 * attempt * (r.status === 429 ? 3 : 1));
    }
  };
}

async function pool(items, n, fn){
  const out = []; let i = 0;
  await Promise.all(Array.from({length: n}, async () => { while (i < items.length){ const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

async function allPages(tmdb, path, params, maxPages = 60){
  const first = await tmdb(path, {...params, page: 1});
  const pages = Math.min(first.total_pages || 1, maxPages);
  const rest = await pool(Array.from({length: pages - 1}, (_, i) => i + 2), 4, p => tmdb(path, {...params, page: p}));
  return [first, ...rest].flatMap(l => l?.results || []).map(r => r.id);
}

// Best trailer: an official YouTube trailer, else any YouTube trailer, else a teaser.
function pickTrailer(videos){
  const yt = (videos?.results || []).filter(v => v.site === "YouTube");
  const v = yt.find(v => v.type === "Trailer" && v.official) || yt.find(v => v.type === "Trailer") || yt.find(v => v.type === "Teaser");
  return v ? v.key : null;
}

/* Release info for one country. TMDB release types: 1 premiere, 2 limited theatrical, 3 wide theatrical. */
function regionRelease(rd, region){
  const list = (rd?.results || []).find(x => x.iso_3166_1 === region)?.release_dates || [];
  const cert = (list.find(x => x.certification) || {}).certification || "";
  const theatrical = list.filter(x => x.type === 2 || x.type === 3)
    .map(x => ({date: x.release_date.slice(0, 10), type: x.type})).sort((a, b) => a.date.localeCompare(b.date));
  return {cert, theatrical};
}

/* `release` = when the film first came out (Date Release filter); `showing` = its current run in this
   country (In theaters / Coming soon, sorting). They differ only for re-releases. Same rules as the app. */
function movieDates(d, rel, inNowPlaying, today){
  const dates = rel.theatrical.map(x => x.date);
  let release = dates[0] || d.release_date || "";
  if (d.release_date && release && daysBetween(d.release_date, release) > 365) release = d.release_date;
  const past = rel.theatrical.filter(x => x.date <= today), future = rel.theatrical.filter(x => x.date > today);
  const current = inNowPlaying ? (past.pop() || null) : (future[0] || past.pop() || null);
  const showing = current?.date || release;
  const reissue = !!(release && showing && daysBetween(release, showing) > 365);
  // Wide = TMDB says this run is a wide (type 3) release. Everything else, including re-releases, is treated as limited.
  const wide = !reissue && current?.type === 3;
  return {release, showing, reissue, wide};
}

function markLikelyNearby(movies, today){
  const soonLimit = isoLocal(new Date(Date.parse(today) + SOON_DAYS * DAY));
  const popularEnough = m => m.popularity >= (m.language === "en" ? MIN_POPULARITY : NON_EN_MIN_POPULARITY);
  const top = (list, n) => new Set(list.filter(popularEnough).sort((a, b) => b.popularity - a.popularity).slice(0, n));
  const now = top(movies.filter(m => m.wide && m.showing <= today && daysBetween(m.showing, today) <= NOW_MAX_DAYS), NOW_TOP);
  const soon = top(movies.filter(m => m.wide && m.showing > today && m.showing <= soonLimit), SOON_TOP);
  for (const m of movies) m.likelyNearby = now.has(m) || soon.has(m);
}

async function omdbScores(key, imdbId){
  const r = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${encodeURIComponent(key)}`);
  if (r.status === 401) throw new Error("OMDb rejected the key or the daily limit is used up (401).");
  const j = await r.json();
  if (j.Response === "False") return {imdb: null, rt: null};
  const rt = (j.Ratings || []).find(x => x.Source === "Rotten Tomatoes");
  return {imdb: j.imdbRating && j.imdbRating !== "N/A" ? +j.imdbRating : null, rt: rt ? parseInt(rt.Value) : null};
}

/**
 * @param opts.tmdbKey   TMDB v3 key or v4 token
 * @param opts.omdbKey   OMDb key (optional; without it scores stay empty)
 * @param opts.region    two-letter country code, e.g. "US"
 * @param opts.previous  the last published file for this country (to reuse saved scores), or null
 * @param opts.omdbLimit max OMDb lookups this run
 * @param opts.log       progress logger
 */
export async function buildMovies({tmdbKey, omdbKey = "", region = "US", previous = null, omdbLimit = OMDB_PER_RUN, log = () => {}, now = new Date()}){
  const tmdb = tmdbClient(tmdbKey, log);
  const today = isoLocal(now);

  // TMDB's "upcoming" list only reaches ~3 weeks ahead; "discover" adds theatrical releases up to ~3 months out,
  // so people following a series hear about the next film early.
  const ahead = isoLocal(new Date(now.getTime() + AHEAD_DAYS * DAY)), tomorrow = isoLocal(new Date(now.getTime() + DAY));
  const [nowIds, soonIds, laterIds] = await Promise.all([
    allPages(tmdb, "/movie/now_playing", {region}),
    allPages(tmdb, "/movie/upcoming", {region}),
    allPages(tmdb, "/discover/movie", {region, with_release_type: "2|3", "release_date.gte": tomorrow, "release_date.lte": ahead, sort_by: "popularity.desc"}, 20)
  ]);
  const nowSet = new Set(nowIds);
  const ids = [...new Set([...nowIds, ...soonIds, ...laterIds])];
  log(`${region}: ${nowSet.size} now playing, ${ids.length} movies in total`);

  let done = 0;
  const movies = (await pool(ids, 8, async id => {
    const d = await tmdb(`/movie/${id}`, {append_to_response: "release_dates,credits,videos,keywords"});
    if (++done % 100 === 0) log(`details ${done}/${ids.length}`);
    if (!d) return null;
    const rel = regionRelease(d.release_dates, region);
    return {
      id: "t" + d.id, title: d.title, overview: d.overview || "No description yet.",
      poster: d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null,
      genres: (d.genres || []).map(g => g.name), cert: rel.cert || "NR", runtime: d.runtime || null,
      ...movieDates(d, rel, nowSet.has(d.id), today),
      countries: (d.production_countries || []).map(x => x.iso_3166_1), language: d.original_language,
      imdbId: d.imdb_id || null,
      people: (d.credits?.cast || []).slice(0, 15).map(x => x.name)
        .concat((d.credits?.crew || []).filter(x => ["Writer", "Screenplay"].includes(x.job)).map(x => x.name)),
      director: (d.credits?.crew || []).filter(x => x.job === "Director").map(x => x.name).join(", "),
      trailer: pickTrailer(d.videos),
      collection: d.belongs_to_collection ? {id: d.belongs_to_collection.id, name: d.belongs_to_collection.name} : null,
      keywords: (d.keywords?.keywords || []).slice(0, 15).map(k => k.name),
      popularity: Math.round((d.popularity || 0) * 10) / 10, votes: d.vote_count || 0,
      imdb: null, rt: null, scoresAt: null
    };
  })).filter(Boolean);
  markLikelyNearby(movies, today);

  // Reuse saved scores, then spend this run's OMDb budget: never-checked movies first, then the
  // newest stale ones (new films' scores change the most).
  const saved = new Map((previous?.movies || []).filter(m => m.imdbId).map(m => [m.imdbId, m]));
  for (const m of movies){ const s = saved.get(m.imdbId); if (s) Object.assign(m, {imdb: s.imdb, rt: s.rt, scoresAt: s.scoresAt}); }
  let lookups = 0;
  if (omdbKey){
    // Films opening more than 3 weeks out have no scores yet; skip them to save the daily budget.
    const soonest = isoLocal(new Date(now.getTime() + 21 * DAY));
    const due = movies.filter(m => m.imdbId && m.showing <= soonest && (!m.scoresAt || now - Date.parse(m.scoresAt) > SCORE_MAX_AGE))
      .sort((a, b) => (!!a.scoresAt - !!b.scoresAt) || b.showing.localeCompare(a.showing))
      .slice(0, omdbLimit);
    await pool(due, 4, async m => {
      try { Object.assign(m, await omdbScores(omdbKey, m.imdbId), {scoresAt: now.toISOString()}); lookups++; }
      catch (e) { log(`OMDb: ${e.message}`); }
    });
  }
  log(`OMDb lookups this run: ${lookups}; movies with an IMDb score: ${movies.filter(m => m.imdb != null).length}/${movies.length}`);

  return {country: region, generatedAt: now.toISOString(), count: movies.length, movies};
}
