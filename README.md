# cinemalert-data

Shared movie data for the CinemAlert app by Octopus Heart Software.

Every 6 hours a scheduled GitHub Action ([refresh.yml](.github/workflows/refresh.yml)) builds `data/movies-us.json` and publishes it on GitHub Pages:

- the movies now playing and opening soon in US theaters, from TMDB
- IMDb and Rotten Tomatoes scores from OMDb, when available

The app downloads this one file, so users never need API keys. The keys live only in this repository's Actions secrets (`TMDB_KEY`, `OMDB_KEY`).

To refresh by hand: **Actions → Refresh movie data → Run workflow**.

This product uses the TMDB API but is not endorsed or certified by TMDB.
