# Contributing to EssayHarness

Thanks for your interest. EssayHarness is a local-first app: it banks your life experiences on your own machine and drafts scholarship essays and personal statements from them.

## Development setup

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev        # http://127.0.0.1:3400
```

Add your API keys in **Settings** inside the app, or copy `.env.example` to `.env.local` and fill it in there. Never commit `.env.local` or any real key.

The Docker path works too:

```bash
docker compose up -d --build
```

## Before opening a pull request

```bash
npm test           # unit + integration tests against a local fake Anthropic/OpenAI server
npm run typecheck
npm run build
```

All three should pass. If you change behaviour, add or update a test in `tests/`.

## Where things live

| Area | Where |
| --- | --- |
| Model instructions (all prompts) | `server/prompts.ts` |
| Providers | `server/llm/` |
| Notes to bank extraction and merge rules | `server/bank.ts` |
| Plan, draft, revise, fact check | `server/essays.ts` |
| File storage | `server/store.ts`, `server/db.ts` |
| API guard (host / origin checks) | `proxy.ts`, `server/security.ts` |
| Dictation | `components/dictation.tsx`, `public/worklets/pcm-capture.js` |
| Pages | `components/pages/` |

## Ground rules

- **Local first.** User data (notes, the experience bank, essays, saved keys) lives in the data folder outside the project tree. Do not add features that send it anywhere else.
- **Grounded writing.** The essay agent only writes what the user's own material supports. Do not weaken the fact-check step or let the model invent experiences.
- **No telemetry.** There is none, and pull requests that add analytics or tracking will be declined.
- Keep changes focused. Open an issue first for anything large so the approach can be agreed before you build it.
