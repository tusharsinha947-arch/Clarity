# Clarity Code Runner Integration (Python + JavaScript)

This is a backend integration starter for your Clarity website. It adds a protected
`POST /api/execute` endpoint that forwards Python or JavaScript code to a separately
hosted Piston runner. It does **not** execute submitted code inside your main website
server.

## Important limitation

I could not merge this directly into your deployed Clarity website because its source
repository/project files were not provided. This ZIP contains the backend integration
and deployment templates; you will still need to connect your existing Run Code button
to this API and deploy the backend service.

## Included

- Express backend with `POST /api/execute`
- Supports Python and JavaScript
- Checks available Piston runtimes and selects an installed version
- Request-size validation, basic rate limiting, timeout handling, and CORS configuration
- Dockerfile for the API backend
- Render environment-variable notes
- Example frontend fetch call
- Docker Compose example for local testing with Piston

## 1. Requirements

- Node.js 20+
- A Piston service reachable from the backend
- For local Piston testing: Docker Desktop with Linux containers

Piston must be treated as a separate, isolated code-execution service. Do not expose a
runner to the public internet without access controls. A private network or authenticated
proxy is strongly preferred.

## 2. Configure the backend

Copy `.env.example` to `.env` and set:

- `PISTON_API_URL`: base URL of your Piston service, for example `http://localhost:2000`
- `FRONTEND_ORIGIN`: your website origin, for example `https://clarity-94na.onrender.com`
- `PORT`: optional; defaults to `3000`

Do not put `PISTON_API_URL` in browser JavaScript or any `VITE_*` / `NEXT_PUBLIC_*` variable.
It belongs only on the server.

## 3. Run the API locally

```bash
npm install
cp .env.example .env
# Edit .env to point PISTON_API_URL to your reachable Piston service
npm start
```

The API health endpoint is `GET /health`. The execute endpoint is `POST /api/execute`.

### Example request

```bash
curl -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"language":"python","code":"print(\"Hello from Clarity\")","stdin":""}'
```

For JavaScript:

```bash
curl -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"language":"javascript","code":"console.log(\"Hello from Clarity\")","stdin":""}'
```

## 4. Deploy to Render

Deploy this folder as a separate **Web Service** from your Git repository:

- Runtime: Docker (Render should detect the included `Dockerfile`)
- Environment variables:
  - `PISTON_API_URL` = private/reachable Piston API base URL
  - `FRONTEND_ORIGIN` = `https://clarity-94na.onrender.com`
  - `NODE_ENV` = `production`

The backend service must be able to reach the Piston service. If Piston is on another host,
use its actual private/reachable URL. `localhost` only works when Piston is reachable from
the same network namespace/container, which is generally not the case for separate Render
services.

A public website URL is not itself a Piston runner. You must deploy/provision Piston
separately and keep it access-controlled.

## 5. Connect the existing Run Code button

Adapt your current frontend code to call the deployed backend URL:

```js
async function runCode(language, code, stdin = "") {
  const response = await fetch("https://YOUR-CLARITY-API.onrender.com/api/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, code, stdin })
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Execution failed");
  return result;
}
```

Use the returned `output`, `stderr`, and `status` fields to render the result panel.
Replace the example URL with the real backend URL. Do not expose runner credentials in the
frontend.

## Security notes

- This starter adds request-size limits and basic per-IP rate limiting, but these are not
  a substitute for a secure runner, authentication, abuse monitoring, and production quotas.
- Keep Piston isolated; do not run submitted code on your main app server.
- Set strict CPU/memory/time limits at the runner/container level too.
- Do not assume CORS protects an API from abuse.
- Review and adapt rate limits, authentication, privacy, and deployment networking before
  making this public.
