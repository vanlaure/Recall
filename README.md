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

Optional decision model, [Laya](https://github.com/NandhaKishorM/laya) (Apache-2.0): run `docker compose -f compose.laya.yaml up -d --build` and set `LAYA_BASE_URL=http://127.0.0.1:8009`. Laya answers typed questions about the material in one forward pass on CPU. It does not choose alone: on our labelled tasks it is right about three times in four, so code decides what it can determine exactly, Laya's answer is used only above `LAYA_MIN_CONFIDENCE` and never against those facts, and otherwise the Nemotron Memory Expert chooses. `npm run eval` reproduces the measurements in [docs/EVALUATION.md](docs/EVALUATION.md). Laya's authority is set per kind of decision (`LAYA_TECHNIQUE_MODE`, `LAYA_CUE_MODE`, `LAYA_REPAIR_MODE`: `enforced` or `advisory`), and every kit records the checkpoint, its revision, its device and the mode in force, so a checkpoint trained on Recall's own tasks can be evaluated and given more authority through configuration. A decision made on truncated material is discarded. `npm run export:training` writes labelled decisions in Laya's dataset format for training or calibrating a checkpoint, leaving out the held-out test tasks. A contract failure goes back to the generating agent as a record (check, scene, expected, observed, kind of repair). Under "What I already know" on the Tools page a learner records whether they know the Major system, a peg list or person-action-object; a kit that needs one they have not said they know says so, and the Memory Expert is not offered one they have said they do not know.

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
- Training plan: set the date you need a kit by and Recall plans practice sessions back from it (widening gaps, then a run-through and a final check). Without a date, the gap doubles after each good session. A "Today's practice" list and a month calendar show what is due and what was done; one link exports the coming sessions as a calendar file.
- Guided practice: one item at a time from memory, with optional hints (picture, cue, first word). Recall without a hint is tracked separately from hinted recall. Free recall of the whole text is still available; a list is scored by items recalled and a passage by word edit distance, and meaning recall uses an AI estimate.
- Cue repair: when an item is missed in two sessions running, Recall offers to rewrite its cue. Nemotron diagnoses the likely cause from the learner's wrong answers and writes a replacement, which code holds to the same technique contract.
- Progress per kit: every session's score, and each item's attempts, recalls and unaided recalls.
- Technique catalog: loci, links, pegs, keyword, chunking, narrative, Major system, shape/rhyme, PAO, visual association.
- Research Agent: ask for "John 3:16", "a famous quote by Jim Croce" or "a line from Casablanca". Nemotron works out what to look up and which found quotations fit; it never supplies wording. Quotations are read from Wikiquote and chosen by number, each shown with its work, its stated source, whether the page files it as unsourced, disputed or misattributed, and a link to check it. Verses are retrieved from bible-api.com in a public-domain translation (KJV, WEB or ASV) without a model call. Wikiquote is community-edited, so the link is there to be followed. The citation stays with the kit only while the wording is unchanged.
- Verse of the day and six study tracks: lists of references only; the wording is always retrieved.
- Phrase beats: "Verse or quote, phrase by phrase" splits each sentence at its clauses in code, so one verse becomes several short scenes that are practised, tracked and repaired separately. The beats always join back to the exact source.
- Reference scene: "Where it is from" gets a scene of its own under its own contract. Its numbers go through the Major system, which code decodes, and the cue must name the book, work or person. If no cue meets the contract in three attempts the kit is kept without one.
- Names and faces: add a face photo with one name. A vision model names up to three neutral visible features and is told not to identify anyone; the cue must attach a sound-alike of the name to the first feature. The photo is resized in the browser, stored in the account's private library, shown as the question in practice and deleted with the kit. Generated images still never depict a real person.
- Saved memory palaces: name a route and list its places once; a kit built on it must put scene 1 at the first place, scene 2 at the second, and so on, checked by code.
- Practice also runs in reverse order and from first letters (which counts as a hint).
- Major system drill: a number to put into words or a word to read as digits, checked by the same decoder that checks storyboards.
- Original-language words for a verse kit: up to four key words with the Hebrew or Greek behind them. These come from Nemotron's own knowledge, are stored and shown as unverified, and link to an interlinear when the verse was retrieved; code keeps only words that are in the verse.
- Print cards (the open kit's scenes) and import of a previously exported kit as a fresh kit without images or history.

## Scope and deployment

To host it, see [docs/DEPLOY.md](docs/DEPLOY.md): the repository includes a Dockerfile and Railway configuration for the app, and a second container for the Laya decision model.

This is a prototype, not a hardened production service. Provider keys stay server-side. Passwords are stored as salted scrypt hashes and sessions as SHA-256 hashes; the session cookie is HttpOnly and SameSite=Strict. The server binds to loopback by default: put it behind an HTTPS reverse proxy before remote access, and set `SIGNUP_CODE` so only invited people can create accounts and use your provider credits. There is no password reset or account deletion yet. Kit data is plain JSON on disk, not encrypted; back up the data directory. A library saved before accounts existed (`data/kits.json`) is moved into the first account created. Provider terms govern transmitted text/audio and generated images. Recording is limited to 60 seconds; uploaded audio is capped at 10 MB in the UI. Raw audio is not persisted by Recall.

Generated images are mnemonic symbols, not verified medical diagrams. Retrieved verses use public-domain translations only; Bible users who paste another translation supply text they have permission to use. Quotations may be in copyright (song lyrics, film lines): Recall retrieves them for the learner's own study and does not check rights. Scored scene rubrics, reminders and notifications, clarifying questions to the learner, advanced accessibility preferences, password reset, queues, encrypted storage and robust spaced-repetition calibration remain future work.

## Reuse and licenses

Concepts were informed by the owner's Memory-App and Bible-Verse-Memory-Tool. This implementation is written afresh; no source files from those private repositories are copied. User-supplied demonstration illustrations are excluded from the MIT code license pending redistribution/provenance review. No expert endorsement or guaranteed memory outcome is claimed. Provider/model licenses are separate from our code license.

## Hackathon

Before submission: validate live NVIDIA/Nebius calls using the chosen model, publish licensed source, provide a hosted/test demo and required public video, and document development/reuse. Configuration adapters alone do not establish eligibility. Current code is locally tested; live paid/provider calls have not been tested without keys.

Official rules: https://nebiusglobalaihackathon.devpost.com/rules
Nebius API: https://docs.tokenfactory.nebius.com/api-reference/introduction
Laya: https://github.com/NandhaKishorM/laya
