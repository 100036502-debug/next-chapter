# Next Chapter

A book recommendation site. Enter books you've read (with ratings), favorite and avoided genres, mood, themes, tone, pacing, length, setting, audience, format, content to avoid, and how adventurous you want to be. Mistral returns tailored picks with a reason for each.

The Mistral API key stays on the server and is never sent to the browser.

## Run locally

1. Install Node.js 18 or newer.
2. `npm install`
3. Set your key, either by copying `.env.example` to `.env` and editing it, or:
   - macOS/Linux: `export MISTRAL_API_KEY=your-key`
   - Windows PowerShell: `$env:MISTRAL_API_KEY="your-key"`
4. `npm start`
5. Open http://localhost:3000

## Deploy (Render)

1. Push this repo to GitHub.
2. On render.com, create a new Web Service from the repo.
3. Build command: `npm install`  Start command: `npm start`
4. Add environment variable `MISTRAL_API_KEY` in the dashboard.

## Configuration

| Variable | Required | Default |
|---|---|---|
| `MISTRAL_API_KEY` | yes | none |
| `MISTRAL_MODEL` | no | `mistral-small-latest` |
| `PORT` | no | `3000` |

Get a key at https://console.mistral.ai/
