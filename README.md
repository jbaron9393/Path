\# Cloze Refiner



Anki cloze batch refiner powered by OpenAI.



\## Setup



Create a .env file (not committed):



OPENAI\_API\_KEY=PASTE\_YOUR\_KEY\_HERE  

APP\_USERNAME=SET\_A\_USERNAME\_OR\_PATH\_HERE  



Run:



node server.js



Open http://localhost:3000




## Long-term style seeding (Micro / Gross / Path)

You can seed the rewrite style with your own phrase library stored in the repo.

1. Copy `data/style_seed.example.json` to `data/style_seed.json`.
2. Put your snippets under keys: `micro`, `gross`, and/or `path`.
3. Restart the server, or call:
   - `POST /api/rewrite/reload-style-seed`

Notes:
- This is best for curated style snippets from your own docs (including content copied from Word).
- Confirmed examples saved with **Save Corrected** still persist to `data/rewrite_learning.json`.
- Both the curated seed file and saved corrections are used together to steer future output style.


## Grossing Manual integration

The app now serves the Grossing Manual under the same domain at `/grossing-manual` (no iframe).

### Sync vendored content

The server now attempts to auto-sync the vendor folder on startup and on the first `/grossing-manual` request if files are missing.

You can also run a manual sync:

```bash
npm run sync:grossing-manual
```

### Render build/deploy notes

Recommended Render build/start:

```bash
# Build
npm ci && npm run sync:grossing-manual

# Start
npm start
```

If the build-time sync is skipped, startup auto-sync still attempts to fetch the manual.
