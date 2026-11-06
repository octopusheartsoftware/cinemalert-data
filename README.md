# cinemalert-data

Shared movie data for the CinemAlert app by Octopus Heart Software.

Every 6 hours a scheduled GitHub Action ([refresh.yml](.github/workflows/refresh.yml)) builds `data/movies-us.json` and publishes it on GitHub Pages:

- the movies now playing and opening soon in US theaters, from TMDB

The app downloads this one file, so users never need API keys. The TMDB key lives only in this repository's Actions secrets (`TMDB_KEY`). IMDb and Rotten Tomatoes scores from OMDb were dropped Nov 6, 2026, because OMDb's terms allow personal, non-commercial use only; the app links to those sites instead. The `OMDB_KEY` secret is no longer read and can be deleted.

To refresh by hand: **Actions → Refresh movie data → Run workflow**.

This product uses the TMDB API but is not endorsed or certified by TMDB.
