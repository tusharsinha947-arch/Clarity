# Clarity Preview

A responsive AI learning dashboard for beginner math and programming. This preview version has no database: it starts with sample activity and keeps new questions and practice sets in memory while the service is running.

## Deploy on Render

The repository root contains the Render Blueprint. Connect this GitHub repository in Render using New → Blueprint. The Blueprint creates a single Node web service and no database.

The service uses Build Command npm install and Start Command npm start. The start script launches server.mjs, which serves index.html at / and the API at /api/health. If Render shows Cannot GET /, check that the service Root Directory contains render.yaml, package.json, server.mjs, and index.html, then deploy the latest main commit.

## Try the app

Sign-in is not required. Without OPENAI_API_KEY the tutor returns sample explanations and practice questions. To enable live AI answers and generated quizzes, add OPENAI_API_KEY to the Render service environment and redeploy. OPENAI_MODEL defaults to gpt-4.1-mini.

The code editor is included, but code execution requires a separately hosted, isolated Piston-compatible runner. Configure PISTON_API_URL and, if needed, PISTON_API_KEY in the Render environment. The app does not execute submitted code inside its web server.

## Run locally

Requires Node.js 20 or newer. Run npm install, then npm start, and open http://localhost:3000. You can put optional local environment values in .env; see .env.example.

## Preview limitations

All visitors share a demo learner account. New history and practice sets reset when the service restarts or redeploys. There is no real account system or persistent storage in this edition.
