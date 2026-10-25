# AGENTS.md

## Project
`horarios-app`: React + Vite frontend + Express/MySQL backend. Captures handwritten work schedules from photos via Gemini, validates extracted casas/trabajadores against MySQL, lets the user review/edit in the UI, saves schedules to the DB, and browses history.

## Layout
- `frontend/` — Vite + React (ESM). Entry `src/main.jsx`; almost all UI/state lives in `src/App.jsx`. API base is hardcoded to `http://localhost:3000/api`.
- `backend/` — CommonJS Express. Entry `server.js` -> `src/app.js`. Routes in `src/router/`. DB access `src/config/db.js` (mysql2 pool). Gemini integration `src/services/gemini.service.js`. Validation lists `src/data/casas.js`, `src/data/trabajadores.js`.
- Database: MySQL `horarios_app` with tables `casas`, `trabajadores`, `dias`, `horarios`, `horario_trabajadores`.

## Commands
Backend (run from `backend/`):
- `npm run dev` — nodemon `server.js`
- `npm start` — node `server.js`
- `node test-db.js` — verify MySQL connection
- No tests/lint/typecheck configured (`npm test` is a placeholder).

Frontend (run from `frontend/`):
- `npm run dev`, `npm run build`, `npm run lint`, `npm run preview`

Verification order for frontend changes: `npm run lint` then `npm run build`.

## Environment
- `backend/.env` is required and not committed: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`, `GOOGLE_API_KEY`. There is no `.env.example`.
- Local MySQL must be running on the configured port.
- `GOOGLE_API_KEY` is required for `POST /api/horarios/analizar`.

## Backend quirks
- `src/config/db.js` exports a pool as the default export; `require(...)` works whether named `db` or `pool`.
- Multer `dest` is `"uploads/"` relative to the process cwd. Start the backend from `backend/` so files land in `backend/uploads/`; starting from the repo root creates a separate root `uploads/`.
- Duplicate CRUD implementations exist: `casas.routes.js` / `trabajadores.routes.js` (mounted at `/api/casas` and `/api/trabajadores`, used by the frontend) and equivalent endpoints embedded in `horarios.routes.js` (served under `/api/horarios/casas` and `/api/horarios/trabajadores`, legacy/unused). Keep them in sync or remove the legacy copies.
- `horarios.routes.js` filters `activo = TRUE` on its casas/trabajadores GETs; the standalone routes return all rows and the frontend filters active ones client-side.
- `gemini.service.js` hardcodes model id `gemini-3.5-flash-lite` and reads the `src/data/*` lists. `const { response } = require("../app")` is undefined/unused (`app` exports no `response`). `config: { responseMimeType }` is nested inside `contents` instead of being top-level.
- Uploaded files are never deleted.

## Frontend quirks
- `API_BASE` is hardcoded to `http://localhost:3000/api`; there is no Vite proxy or env-based URL. CORS is fully open (`cors()`).
- Management UI calls `/api/casas` and `/api/trabajadores` (standalone routes), not the `/api/horarios/*` duplicates.
- `activo` is a tinyint; the frontend normalizes it with `=== true || === 1`.

## Database
No schema/migration files are in the repo; the DB must be created manually. Constraints worth knowing: `casas.nombre` and `trabajadores.codigo` are unique; `dias.fecha` is unique; deleting a `dias` row cascades to `horarios`; deleting a referenced `trabajador` is restricted.

## Agent orchestration (OpenCode)
- Project-level agents live in `.opencode/agents/` (`lead` is primary; the rest are subagents). `opencode.json` sets `default_agent: lead`.
- Assignments: `lead`/`architect` `openai/gpt-6-luna#medium`; `backend`/`frontend` `opencode/deepseek-v4.1-flash-free#medium`; `qa`/`devops` `opencode/glm-5.3-flash-free#high`; `reviewer` `openai/gpt-6-luna#high`; `explore` `opencode/mimo-v2.6-flash-free`.
- `lead` is the only agent allowed to launch subagents; subagents run with fresh context, so pass full context when delegating.

## Git / ops
- `.env` and `uploads/` must not be committed (secrets and user images). No CI workflows are present.
- `AGENTS.md` was previously empty; this file is the current source of repo guidance.
