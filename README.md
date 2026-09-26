# Ignatius at Home: web

> ## 📐 How it all works: [ARCHITECTURE.md](https://github.com/bcollier/ignatius-hw4-api/blob/main/docs/ARCHITECTURE.md)
>
> The full documentation lives in the API repo, with diagrams: the system and hosting on GitHub Pages, Render and Supabase, the database ERD, sign-in and guest flows, how a retreat is made step by step, the prayer player, status lifecycles, every API endpoint, costs, security, and failure handling.
>
> **Live app:** https://bcollier.github.io/ignatius-hw4-web/ · **Backend repo:** [ignatius-hw4-api](https://github.com/bcollier/ignatius-hw4-api)

The frontend for **Ignatius at Home**: upload a retreat handout or passages you have rights to, press **Make my retreat**, and pray it day by day on any device.

Plain HTML, CSS and JavaScript with no build step, hosted on GitHub Pages and installable on a phone's home screen. The backend is [ignatius-hw4-api](https://github.com/bcollier/ignatius-hw4-api) on Render.

## Views

| URL | View |
| --- | --- |
| `./` | Library: a Continue card (a started, missed or today's day) and retreats grouped by series |
| `./?new` | New retreat: **Simple** (file, series, go) or **Advanced** (models, research service, voices for each part, prayer order and silences, start date, every prompt and the spoken guidance, conversation voice) |
| `./?r=ID` | A retreat: progress while it's being made; then a day strip (prayed, started, missed, today) and each day's grace and passage in full |
| `./?r=ID&pray=N` | Praying: the day's images fill the screen; a small player is docked at the bottom on phones |
| `./?talk&r=ID` | Talk it over: a live spoken conversation with an AI prayer companion (OpenAI GPT-Live over WebRTC, or xAI Grok voice over WebSocket with PCM16 audio) |
| `./?me` | About me: `user info.md` and what you want from the companion |
| `./?about` | What the Spiritual Exercises, a retreat and lectio divina are, with links |

## How it talks to the backend

- `config.js` sets `API_BASE`: `http://localhost:8000` when the page is served from localhost, otherwise the Render URL.
- On load it calls `GET /api/health` and `GET /api/options`. Options carry the voice menus, the default prompts, and the public Supabase settings.
- **Sign-in:** `supabase-js` sends an email link. Each request then carries `Authorization: Bearer <access token>`, which the backend checks with Supabase.
- **Upload:** `fetch` sends `POST /api/retreats` as `FormData`, then polls `GET /api/retreats/{id}` every 2.5 seconds while a job runs.
- **Build:** `POST /api/retreats/{id}/days/{n}/build` sends the voice tier, the voice and the reflection prompts.
- Audio and images load from signed URLs returned by the API.

## Error handling

- **Server unreachable:** the page says that Render's free tier may be waking up and offers a Retry button.
- **API errors:** every error returns a JSON `message`, which is shown as-is. This covers a wrong file type, a file that's too large, a scanned PDF with no text, an expired sign-in (the page returns to the sign-in form) and a day that's already building.
- **Failed jobs:** a failed planning job or track shows its reason. Planning stops polling after 6 minutes with a note.

## The prayer player

**Pray this day** plays in one audio element:

1. the reading
2. the reflection
3. the reading
4. the deep dive
5. the reading
6. a pause: a bell, 30 seconds to 5 minutes of quiet, and a bell
7. the reading one last time

A simpler order is also offered. The pause is real audio, so it keeps going when a phone screen locks. The lock screen shows the current step through the Media Session API. `sounds/` holds a bell and 30 seconds of quiet, synthesized by `tools/make_sounds.py`, so there's no licensing question.

## Printable script

**Printable script (PDF)** on a built day, and **Download the whole retreat (PDF)** in the retreat header, fetch `GET /api/retreats/{id}/script.pdf` with the sign-in token, using the current prayer order and silence lengths, and open the result in a new tab to print or save to an iPad.

## Run locally

```bash
python3 -m http.server 5500
```

Then open <http://localhost:5500> with the API running on port 8000.
