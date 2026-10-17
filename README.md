# Clarity AI Tutor Plus

Full-stack learning app for beginner math and programming. Includes account sign-up/sign-in, private problem history, weekly progress, AI-generated practice quizzes, and a code-runner integration. Uses PostgreSQL for persistence and server-side sessions via secure HTTP-only cookies.

## Deploy with Render

1. Unzip this folder and push its contents to a GitHub repository.
2. In Render, choose **New → Blueprint**, then connect the repository. Render reads `render.yaml` and creates a web service and PostgreSQL database.
3. Enter your `OPENAI_API_KEY` when Render asks for the secret.
4. Deploy, then open the new `clarity-ai-tutor-plus` service URL and create an account.

The Blueprint uses Render's Free database plan for a low-cost preview. Render Free Postgres databases are temporary; choose a paid database plan in `render.yaml` or the Render Dashboard before relying on long-term learner history. This creates a new service and database; it does not migrate users or saved problems from an older deployment.

### Existing Render service

To upgrade an existing service instead of creating another, connect this repository to that service and set `DATABASE_URL` to a Render Postgres connection string, `OPENAI_API_KEY` to your key, and `NODE_ENV=production`. The app creates its tables on startup. Existing in-memory/demo history cannot be migrated because it was never stored in a database.

## Run locally

Requires Node.js 20+ and PostgreSQL. Create an empty database, copy `.env.example` to `.env`, fill in the values, then run:

```sh
npm install
npm start
```

Open `http://localhost:3000`. For local work, use a local PostgreSQL URL and set `NODE_ENV=development` in `.env`.

## Features

- **Accounts:** email/password registration, scrypt password hashes, random server-side sessions, `HttpOnly`/`SameSite=Lax` cookies, logout, and request limits on authentication.
- **Saved problems:** AI explanations are stored per account in PostgreSQL, can be revisited in the dashboard, and can be deleted.
- **Live progress:** this week's solved-problem count, a six-problem weekly goal, study-time estimate, and practice-set count.
- **Practice:** generate four multiple-choice questions for a topic, save the set to the learner account, and get an explanation after selecting an answer.
- **Code execution integration:** the API accepts Python or JavaScript and forwards it to a separately hosted Piston-compatible isolated runner with time and memory limits. To enable it, set `PISTON_API_URL` to the private runner's base URL; set `PISTON_API_KEY` if that runner requires a key. The UI reports when the runner is not configured.

### Code runner setup

The web service intentionally does not execute learner code inside its own process. Connect a separately managed, isolated Piston runner that supports `/api/v2/runtimes` and `/api/v2/execute`, then add `PISTON_API_URL` in the Render service environment. Do not point this at an untrusted or public runner; submitted code is sent to that service. Piston's public hosted API is not generally open for anonymous use, so self-host or choose a trusted managed runner and follow its setup requirements.

## API overview

- `GET /api/health` — health and configured integration status.
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` — account and session.
- `POST /api/solve` — generate and save an explanation (signed-in user).
- `GET /api/dashboard`, `DELETE /api/problems/:id` — private history and progress.
- `POST /api/practice`, `GET /api/practice` — generate and list practice sets.
- `GET /api/runtimes`, `POST /api/run` — isolated code-runner integration.

## Before a public launch

Configure a paid/retained database plan, add email verification and password reset, review your privacy and retention policy, and monitor AI/code execution usage. The weekly study-time number is an estimate based on a fixed 12 minutes per saved problem. This starter does not include billing, email delivery, or importing records from the previous demo.
