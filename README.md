# Next Chapter

A book recommendation site. Enter books you've read (with ratings), favorite and avoided genres, mood, themes, tone, pacing, length, setting, audience, format, content to avoid, and how adventurous you want to be. OpenRouter returns tailored picks with a reason for each.

The OpenRouter API key stays on the server and is never sent to the browser.

The whole site sits behind a password gate: nothing is served (not the page, the
scripts, the stylesheet or the API) without a valid session, which you get by
entering `ACCESS_CODE` once. See "Access code" below.

## Run locally

1. Install Node.js 18 or newer.
2. `npm install`
3. Set your key, either by copying `.env.example` to `.env` and editing it, or:
   - macOS/Linux: `export OPENROUTER_API_KEY=your-key`
   - Windows PowerShell: `$env:OPENROUTER_API_KEY="your-key"`
4. `npm start`
5. Open http://localhost:3000

## Deploy (Vercel)

The repo is already configured for Vercel via `vercel.json`, which serves
`public/` as static files and routes `/api/*` to the Express app in `server.js`.

1. Push this repo to GitHub.
2. On vercel.com choose **Add New > Project** and import the repo.
3. Framework preset: **Other**. Leave the build command empty; the start
   command is not used on Vercel.
4. Under **Environment Variables** add `ACCESS_CODE` and `OPENROUTER_API_KEY`
   (and optionally `OPENROUTER_MODEL` and `PUBLIC_SITE_URL`). Do not set `PORT`.
5. Deploy and open the public URL, then enter your access code.

Any Node host works the same way with `npm install` / `npm start` and the key
set as an environment variable. Static-only hosts (GitHub Pages) will not work,
because the key must stay on a server.

## Configuration

| Variable | Required | Default |
|---|---|---|
| `ACCESS_CODE` | yes | none (site stays locked) |
| `OPENROUTER_API_KEY` | yes | none |
| `OPENROUTER_MODEL` | no | `openai/gpt-4o-mini` |
| `PUBLIC_SITE_URL` | no | `http://localhost:$PORT` |
| `PORT` | no | `3000` |

Get a key at https://openrouter.ai/keys and see the available model IDs at
https://openrouter.ai/models. Any model that supports JSON output will work;
`openai/gpt-4o-mini` is the default because it is cheap and reliable for this.

If the model you pick rejects `response_format`, the server automatically
retries once without it and parses the reply leniently, so most models work
either way.

## Access code

`ACCESS_CODE` is the single password for the site. It is checked on the server
in `POST /api/login`, never in the browser, so the code is not exposed in the
page source.

- A correct code sets an `HttpOnly` session cookie valid for 30 days, so you
  type it once per browser.
- The cookie is signed with an HMAC keyed from `ACCESS_CODE` itself, so
  changing the code instantly logs out every existing session and no second
  secret has to be managed.
- The gate runs before the static file handler, which means no page, script,
  stylesheet or API route is served without a session. `vercel.json` sends
  every path to the Express app for this reason; a static-only route would
  bypass the gate.
- Wrong codes are rate limited to 10 attempts per IP per 10 minutes.
- If `ACCESS_CODE` is unset the site fails closed and returns 503 rather than
  running unprotected.

Use a long random value, for example `openssl rand -base64 24`.

## Reading log

Each recommendation has a **Read it** button. Clicking it asks how you liked the
book on a 1-5 scale, and the answer is stored in `localStorage` under
`nc_read_log`. Those books are then sent with later requests as books you have
read, with your rating, so they are excluded from results and steer the next
round. A **clear** link next to the count wipes the log.
