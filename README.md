# Recall

Voice and text to visual memory storyboards, with agent workflows and recall practice. Built by Van Williams AI.

## Run locally

Requires Node.js 22 or newer. Clone this repository into `F:\NVIDIA Hackathon\Recall`, open it in VS Code, copy `.env.example` to `.env`, and run:

```sh
npm start
```

Visit http://localhost:3000 for the landing page and http://localhost:3000/app for the studio. No npm dependencies are required. Run `npm test` for source-preservation and recall tests.

## Configure real AI

`TEXT_PROVIDER` chooses the platform for the Nemotron text model: `nebius` (Nebius Token Factory, the default and the hackathon requirement) or `nvidia` (NVIDIA API with a free build.nvidia.com key, for development). Both use `nvidia/nemotron-3-super-120b-a12b` by default, so switching changes only where the call runs. Set `NEBIUS_API_KEY` and/or `NVIDIA_API_KEY`; the studio header and every saved kit record which platform and model were used. After editing `.env`, run `npm run check`: it makes one live call per configured provider, lists the NVIDIA models on your account, and reports pass, skip or fail without printing keys. Token Factory has no image or speech endpoints, so `.env.example` defaults both to NVIDIA's hosted API with a free `nvapi-` key from build.nvidia.com: images through the visual API (`black-forest-labs/flux.2-klein-4b`), speech through Riva gRPC (`nvidia/parakeet-tdt-0.6b-v2`) using a small built-in client in `lib/riva.mjs`. OpenAI-compatible `/images/generations` and `/audio/transcriptions` services also work. The studio converts every recording or upload to 16 kHz mono WAV in the browser before sending it. `IMAGE_STYLE` sets a fixed style prepended to every image prompt. Configure `.env` locally; never commit credentials.

Optional decision model, [Laya](https://github.com/NandhaKishorM/laya) (Apache-2.0): run `docker compose -f compose.laya.yaml up -d --build` and set `LAYA_BASE_URL=http://127.0.0.1:8009`. Laya answers typed questions about the material in one forward pass on CPU. It does not choose alone: on our labelled tasks it is right about three times in four, so code decides what it can determine exactly, Laya's answer is used only above `LAYA_MIN_CONFIDENCE` and never against those facts, and otherwise the Nemotron Memory Expert chooses. `npm run eval` reproduces the measurements in [docs/EVALUATION.md](docs/EVALUATION.md).

## Implemented workflows

- Responsive black landing page with supplied illustrative examples and motion controls.
- Microphone recording (localhost/HTTPS), audio upload, server-side transcription and editable source confirmation.
- Learning modules for everyday memory, school, college, medical study, Bible verses, older adults and speeches. Module choice informs prompts; this is not yet a distinct curriculum for each audience.
- Technique selection: the learner's own choice if workable, else exact facts read by code, else the decision model when confident, else the Nemotron Memory Expert. The studio shows the questions asked and the answers.
- A technique contract enforced by code: exact source wording, technique-specific evidence (Major-system words must decode to the digits, each memory-palace cue needs its own location, and so on) and image prompts free of numerals, words, labels and logos. Violations go back to the generating agent with the specific issue, at most three times.
- A Nemotron Rules agent reviews cue ambiguity after the contract passes.
- Image inspection: a vision model reports what each generated image shows, and code rejects visible text, numerals, logos, photographed people, the wrong style or a missing required object. Rejected images are regenerated with a targeted correction, at most three times, then kept and marked for the learner's review. Source coverage, verbatim wording and order checked deterministically.
- Live agent progress: the studio shows each step (technique selection, storyboard, rules review, revisions) as the server streams it.
- Scene prompts, image generation per scene or for the whole storyboard in one click, regeneration, source text and cues beneath images.
- Accounts with a username and password. Each account has its own library in `data/users/<id>/` (kits in `kits.json`, images as files), which other accounts cannot read, change or delete. Deletion, JSON export, visible agent trace.
- Exact recall of a passage uses normalized word edit distance; a list is scored by items recalled, with missed items named and order reported but not penalised. Meaning recall uses an AI estimate. Reviews schedule the next practice date, and due kits are identified.
- Technique catalog: loci, links, pegs, keyword, chunking, narrative, Major system, shape/rhyme, PAO, visual association.

## Scope and deployment

To host it, see [docs/DEPLOY.md](docs/DEPLOY.md): the repository includes a Dockerfile and Railway configuration for the app, and a second container for the Laya decision model.

This is a prototype, not a hardened production service. Provider keys stay server-side. Passwords are stored as salted scrypt hashes and sessions as SHA-256 hashes; the session cookie is HttpOnly and SameSite=Strict. The server binds to loopback by default: put it behind an HTTPS reverse proxy before remote access, and set `SIGNUP_CODE` so only invited people can create accounts and use your provider credits. There is no password reset or account deletion yet. Kit data is plain JSON on disk, not encrypted; back up the data directory. A library saved before accounts existed (`data/kits.json`) is moved into the first account created. Provider terms govern transmitted text/audio and generated images. Recording is limited to 60 seconds; uploaded audio is capped at 10 MB in the UI. Raw audio is not persisted by Recall.

Generated images are mnemonic symbols, not verified medical diagrams. Bible users supply text they have permission to use. Scored scene rubrics, practice adaptation from recall errors, clarifying questions to the learner, advanced accessibility preferences, password reset, queues, encrypted storage and robust spaced-repetition calibration remain future work.

## Reuse and licenses

Concepts were informed by the owner's Memory-App and Bible-Verse-Memory-Tool. This implementation is written afresh; no source files from those private repositories are copied. User-supplied demonstration illustrations are excluded from the MIT code license pending redistribution/provenance review. No expert endorsement or guaranteed memory outcome is claimed. Provider/model licenses are separate from our code license.

## Hackathon

Before submission: validate live NVIDIA/Nebius calls using the chosen model, publish licensed source, provide a hosted/test demo and required public video, and document development/reuse. Configuration adapters alone do not establish eligibility. Current code is locally tested; live paid/provider calls have not been tested without keys.

Official rules: https://nebiusglobalaihackathon.devpost.com/rules
Nebius API: https://docs.tokenfactory.nebius.com/api-reference/introduction
Laya: https://github.com/NandhaKishorM/laya
