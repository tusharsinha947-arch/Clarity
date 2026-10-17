# Clarity AI Tutor

A full-stack starter app for beginner math and programming help. The browser page is served by a small Node.js API server; AI requests go through the server so your API key is not exposed to visitors.

## Deploy on Render

1. Unzip this project and push its contents to a GitHub repository.
2. In Render, choose **New → Blueprint**, then connect that repository. Render reads `render.yaml` to create the web service.
3. In the service's Environment settings, add `OPENAI_API_KEY` with your API key. Render marks this value as secret.
4. Deploy. Render builds and starts the Node service, then checks `/api/health`.

You can also create a Render **Web Service** manually from the GitHub repository with:

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`
- Environment variables: `OPENAI_API_KEY` (required), `OPENAI_MODEL` (optional; defaults to `gpt-4.1-mini`)

## Run locally

Requires Node.js 20 or newer. Set `OPENAI_API_KEY` in your shell, then run:

```sh
npm start
```

Open `http://localhost:3000`. The API key must stay in the server environment; do not put it in `index.html` or commit it to GitHub.

## API

`GET /api/health` reports whether the server is running and whether an AI key is configured.

`POST /api/solve` accepts JSON:

```json
{ "question": "How do I find the area of a triangle?", "subject": "Math" }
```

The server validates input, calls the OpenAI Responses API, and returns the tutor explanation. Prompts are capped at 4,000 characters. The current dashboard history and progress values are sample content and are not saved between visits.

## Before a public launch

This is a deployable starter, not a production account system. Add sign-in and database-backed history before storing personal data. Add rate limits and usage controls before sharing the endpoint widely. Submitted code is explained as text and is never run by this server.
