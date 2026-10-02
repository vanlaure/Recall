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

Optional technique selection with [Laya](https://github.com/NandhaKishorM/laya) (Apache-2.0): run `docker compose -f compose.laya.yaml up -d --build` and set `LAYA_BASE_URL=http://127.0.0.1:8009`. Laya reads the material and chooses one of the ten techniques in a single forward pass on CPU; the Nemotron agents then build and check the storyboard with that technique. If Laya is unset, unreachable, or less confident than `LAYA_MIN_CONFIDENCE`, the Nemotron Memory Expert chooses instead. The kit's agent trace records which one chose and Laya's probabilities. Laya's choices have not been evaluated for accuracy on memory material.

## Implemented workflows

- Responsive black landing page with supplied illustrative examples and motion controls.
- Microphone recording (localhost/HTTPS), audio upload, server-side transcription and editable source confirmation.
- Learning modules for everyday memory, school, college, medical study, Bible verses, older adults and speeches. Module choice informs prompts; this is not yet a distinct curriculum for each audience.
- Technique selection by Laya (or the Nemotron Memory Expert as fallback), then Association/Storyboard and Rules agent calls orchestrated on the server, with up to three storyboard revisions when the Rules agent rejects. Source coverage, verbatim wording and order checked deterministically.
- Scene prompts, individual actual image generation/regeneration, source text and cues beneath images.
- Persistent single-user kit library in `data/kits.json`, deletion, JSON export, visible agent trace.
- Exact recall of a passage uses normalized word edit distance; a list is scored by items recalled, with missed items named and order reported but not penalised. Meaning recall uses an AI estimate. Reviews schedule the next practice date, and due kits are identified.
- Technique catalog: loci, links, pegs, keyword, chunking, narrative, Major system, shape/rhyme, PAO, visual association.

## Scope and deployment

This is a single-user prototype, not a multi-tenant production service. Keys stay server-side. Bind to loopback by default. Set `APP_TOKEN` and use HTTPS with an authenticated reverse proxy before remote access; all authorized users share the same library. Data is plain JSON on disk, not encrypted. Back up the data directory. Provider terms govern transmitted text/audio and generated images. Recording is limited to 60 seconds; uploaded audio is capped at 10 MB in the UI. Raw audio is not persisted by Recall.

Generated images are mnemonic symbols, not verified medical diagrams. Bible users supply text they have permission to use. Generated scene review currently checks text; automatic vision review, verification of number encodings, advanced accessibility preferences, authentication/accounts, queues, encrypted storage and robust spaced-repetition calibration remain future work.

## Reuse and licenses

Concepts were informed by the owner's Memory-App and Bible-Verse-Memory-Tool. This implementation is written afresh; no source files from those private repositories are copied. User-supplied demonstration illustrations are excluded from the MIT code license pending redistribution/provenance review. No expert endorsement or guaranteed memory outcome is claimed. Provider/model licenses are separate from our code license.

## Hackathon

Before submission: validate live NVIDIA/Nebius calls using the chosen model, publish licensed source, provide a hosted/test demo and required public video, and document development/reuse. Configuration adapters alone do not establish eligibility. Current code is locally tested; live paid/provider calls have not been tested without keys.

Official rules: https://nebiusglobalaihackathon.devpost.com/rules
Nebius API: https://docs.tokenfactory.nebius.com/api-reference/introduction
Laya: https://github.com/NandhaKishorM/laya
