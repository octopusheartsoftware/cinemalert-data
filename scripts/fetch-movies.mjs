// Run by the GitHub Actions schedule: builds data/movies-<country>.json.
// Keys come from the TMDB_KEY and OMDB_KEY repository secrets; they never appear in the output.
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {buildMovies} from "./build.mjs";

const countries = (process.env.COUNTRIES || "US").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const tmdbKey = process.env.TMDB_KEY, omdbKey = process.env.OMDB_KEY || "";
if (!tmdbKey) { console.error("TMDB_KEY secret is missing."); process.exit(1); }

await mkdir("data", {recursive: true});
for (const region of countries){
  const file = `data/movies-${region.toLowerCase()}.json`;
  const previous = await readFile(file, "utf8").then(JSON.parse).catch(() => null);
  const result = await buildMovies({tmdbKey, omdbKey, region, previous, log: msg => console.log(msg)});
  // Never replace a good list with an empty one if TMDB had a bad moment.
  if (result.count < 20 && (previous?.count || 0) > 100) { console.error(`${region}: only ${result.count} movies, keeping the previous file.`); process.exitCode = 1; continue; }
  await writeFile(file, JSON.stringify(result));
  console.log(`Wrote ${file}: ${result.count} movies`);
}
