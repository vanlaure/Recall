# Deploying Recall on Railway

Recall deploys as one service (the app) plus an optional second service (the Laya decision model). The app has no
npm dependencies and no build step; Railway builds it from the `Dockerfile` at the repository root.

What was verified locally with Docker on 2026-10-02, and what was not:

- Verified: the app image builds (236 MB), starts, serves the studio, registers an account, builds a storyboard,
  generates and inspects an image, and keeps accounts, kits and images across a container restart when `/data` is a
  volume. It used about 30 MB of memory.
- Verified: the Laya image builds with its model inside (3.3 GB) and starts with no network access. It used about
  1.9 GB of memory at start and 2.9 GB after use.
- Not verified: anything on Railway itself. The steps below follow Railway's documented behaviour (Dockerfile builds,
  volumes, `railway.json`, private networking) but have not been run there.

## 1. The app

1. In Railway: **New Project → Deploy from GitHub repo** and pick this repository. Railway reads `railway.json`,
   builds the `Dockerfile` and checks `/api/config` for health.
2. **Add a volume** to the service, mounted at `/data`. Without it, every redeploy erases all accounts and kits. The container runs as the unprivileged `node` user (uid 1000); if the volume is not writable by it, the server logs "The data directory /data is not writable" at start.
3. **Set the variables** (Service → Variables). Railway provides `PORT` itself; do not set `HOST`, `PORT` or
   `DATA_DIR`, the image already does.

   | Variable | Value |
   |---|---|
   | `TEXT_PROVIDER` | `nebius` (required for the hackathon: the Nemotron call must run on Token Factory) |
   | `NEBIUS_API_KEY` | your Token Factory key |
   | `NEBIUS_MODEL` | `nvidia/nemotron-3-super-120b-a12b` |
   | `NVIDIA_API_KEY` | your build.nvidia.com key (images and speech) |
   | `IMAGE_BASE_URL` | `https://ai.api.nvidia.com/v1/genai` |
   | `IMAGE_MODEL` | `black-forest-labs/flux.2-klein-4b` |
   | `SPEECH_BASE_URL` | `https://grpc.nvcf.nvidia.com:443` |
   | `SPEECH_MODEL` | `nvidia/parakeet-tdt-0.6b-v2` |
   | `SPEECH_FUNCTION_ID` | `d3fe9151-442b-4204-a70d-5fcc597fd610` |
   | `NEBIUS_VISION_MODEL` | `zai-org/GLM-5.3-Flash` |
   | `TAVILY_API_KEY` | your Tavily key (`tvly-…`); enables the Tavily search step in the Research Agent and qualifies for the Best Use of Tavily bonus |
   | `SIGNUP_CODE` | a code of your choosing; give it to the judges. Without it anyone can sign up and spend your credits. |

4. **Generate a domain** (Service → Settings → Networking). Railway serves it over HTTPS; the app then marks its
   session cookie `Secure`.
5. Open `https://<your-domain>/app`, create your account with the sign-up code, and build a storyboard.

The image sets `TRUST_PROXY=1`, so login-attempt limits use the caller's address from `X-Forwarded-For` rather than
Railway's proxy address.

## 2. Laya (optional)

Without Laya the app still works: code facts decide what they can, and the Nemotron Memory Expert chooses the rest.
Laya adds the typed decision step shown in the studio's "How this technique was chosen" panel.

Cost: Laya holds about 2–3 GB of memory the whole time it runs. At Railway's published rate of about $10 per GB of
memory per month, that is roughly $20–30 a month, against well under $1 for the app. Check the current rates before
enabling it.

1. In the same project: **New → GitHub Repo**, pick this repository again, and set the service's **Root Directory**
   to `docker/laya`. Railway reads `docker/laya/railway.json` and builds that `Dockerfile`. The first build downloads
   PyTorch and the 1.5 GB model, so it takes several minutes.
2. Name the service `laya` and set one variable on it: `LAYA_HOST` = `::` (Railway's private network uses IPv6).
   Do not generate a public domain for it.
3. On the app service, set `LAYA_BASE_URL` = `http://laya.railway.internal:8000` and `LAYA_MIN_CONFIDENCE` = `0.5`.
4. Redeploy the app and build a storyboard. The progress list should show "Decision model: recall target: …". If it
   shows "unavailable", the app could not reach Laya; the storyboard still completes.

## 3. After deploying

- Run through the studio once as a new account: sign up, create a storyboard, generate all images, check recall.
- Images and speech use NVIDIA's free developer key, which is rate-limited and intended for prototyping. If judges
  hit its limits, image generation and transcription will fail while text keeps working.
- Per-account hourly limits (`LIMIT_STORYBOARDS_PER_HOUR`, `LIMIT_IMAGES_PER_HOUR`, `LIMIT_TRANSCRIPTIONS_PER_HOUR`)
  cap what one login can spend.
- Back up the `/data` volume if the kits matter; kit data is plain JSON and is not encrypted.

## Running the same containers locally

```sh
docker build -t recall-app .
docker run --env-file .env -e HOST=:: -e PORT=3000 -e DATA_DIR=/data -v recall-data:/data -p 127.0.0.1:3000:3000 recall-app
```

If `.env` points `LAYA_BASE_URL` at `127.0.0.1`, override it for the container, for example
`-e LAYA_BASE_URL=http://host.docker.internal:8009`. On a network that intercepts TLS, mount the root certificate
and pass `-e NODE_EXTRA_CA_CERTS=/certs/root.crt`.
