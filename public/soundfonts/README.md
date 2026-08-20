# Local soundfonts (development only)

Drop `SGM-V2_01-XG-2_06.sf2` in this folder and the "SGM-V2.01" built-in works
at `npm run dev` with no env var.

This folder is gitignored — the file is ~229 MB, far past GitHub's 100 MB limit
and Cloudflare Pages' 25 MiB per-asset cap. For the deployed site, host the file
somewhere else and set `VITE_SF_SGM_URL` (see `.env.example`).
