# Clarity Preview

This preview edition runs without PostgreSQL or any other database. It starts with sample learner activity, lets you try the tutor and generate practice sets, and keeps new changes in server memory while the service stays running.

## Deploy on Render

1. Unzip the project and push its contents to a GitHub repository.
2. In Render, choose **New → Blueprint**, then connect the repository. Render reads `render.yaml` and creates one web service. No database is created or required.
3. Deploy and open the service URL. Sign-in is not required in preview mode.

To try live AI answers and AI-generated quizzes, add `OPENAI_API_KEY` under the service's Render Environment settings and redeploy. Without that key, the app provides sample tutor answers and a built-in practice set so the UI can still be explored.

Code execution is shown in the interface but needs a separately hosted isolated Piston-compatible runner. Add `PISTON_API_URL` (and `PISTON_API_KEY` if needed) in Render to enable it. The web service never executes user code itself.

## Run locally

Requires Node.js 20 or newer:

```sh
npm install
npm start
```

Open `http://localhost:3000`. `OPENAI_API_KEY` is optional. You can also copy `.env.example` to `.env` to configure it locally.

## Preview limitations

- All visitors share the demo learner account.
- History and practice sets are held in memory, so they reset when Render restarts or redeploys the service.
- This package intentionally has no database and no real account system.
- Use the database-backed `clarity-ai-tutor-plus` edition when you want durable learner accounts and saved progress.
