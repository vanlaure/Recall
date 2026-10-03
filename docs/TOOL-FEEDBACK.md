# Feedback on Nebius Token Factory and NVIDIA tools

Observed while building and testing Recall between 2 and 3 October 2026. Every number below was measured in this
project; nothing is quoted from documentation.

## Nebius Token Factory

**What worked well**

- `nvidia/nemotron-3-super-120b-a12b` answered a strict "return only JSON" system prompt reliably across six different
  agent roles (expert, storyboard, rules, repair, research, language). Median first-token-to-complete time for a
  storyboard of three to four scenes was 4 to 8 seconds; a full kit with contract checks and a Rules review took 12 to
  20 seconds, 64 seconds when a reference scene needed three attempts.
- The `/v1/models` endpoint made it possible to detect a retired model before a user hits it; we now call it from the
  studio.
- Invalid key and unknown model return clean 401 and 404 responses that map straight to user-facing errors.
- `zai-org/GLM-5.3-Flash` is a very good image inspector: 18 of 18 on our labelled set, and the typed JSON report it
  returns was always parseable.

**Friction**

- No image generation and no speech endpoints on Token Factory (`/v1/images/generations` and
  `/v1/audio/transcriptions` return 404). We had to run those on NVIDIA's hosted API with a second key, which is the
  single biggest reason the hosted demo needs two providers.
- Latency variance on the vision model: the same inspection took 3.9 s and 40.0 s on consecutive runs. A documented
  per-model latency target or a queue-depth header would let an app decide when to skip inspection.
- Model ids differ in casing and spelling between the catalogue and NVIDIA's (`Nemotron-3_5-Lightning` here,
  `nemotron-3.5-lightning-30b-a3b` there). Matching ids across the two platforms would make a platform switch a
  one-line change.
- No lifecycle information in the catalogue (deprecation date, replacement model). See the NVIDIA note below for why
  that matters.
- No usage or cost fields beyond token counts in the response; a running credit balance endpoint would help a demo
  stay inside a budget.

## NVIDIA API (build.nvidia.com) and NVIDIA models

**What worked well**

- `black-forest-labs/flux.2-klein-4b` through the visual API returns a 1024 px image in about 2 seconds.
- Riva `parakeet-tdt-0.6b-v2` over gRPC transcribes a 6 s clip in 0.4 s; a dependency-free HTTP/2 client was enough.
- Nemotron 3 Ultra answered the same JSON contract in 2.7 s on the free tier.

**Friction**

- `nvidia/nemotron-3-super-120b-a12b` reached end of life on the NVIDIA API on 2026-10-03 at 09:00 UTC. The only
  signal was HTTP 410 on every call; the model had answered the day before and the catalogue gave no notice. Any app
  with a default model id baked in broke overnight. A deprecation header or a dated field in `/v1/models` would have
  avoided it. The same model is still served on Token Factory, so the two platforms now disagree on which Nemotron
  models exist.
- `nvidia/nemotron-3.5-lightning-30b-a3b` returns `reasoning_content` and can spend 24 seconds reasoning before a
  five-token answer; a way to cap reasoning effort per request would make it usable for small structured calls.
- Parakeet returns a run of `<unk>` tokens for silence rather than an empty transcript.
- Free-tier rate limits are not surfaced in headers, so an app cannot show a learner how much headroom is left.

## Laya (self-hosted decision model)

- The `english` checkpoint answered typed questions in one forward pass on CPU in about 1 to 3 seconds, which is what
  makes a cheap pre-decision step viable. Accuracy on our material was 15/20, option-order stability about half; the
  numbers are in `docs/EVALUATION.md`.

## Suggestions, in order of impact for us

1. Image and speech endpoints on Token Factory, or a documented bundle with NVIDIA's hosted API under one key.
2. Deprecation dates and replacement ids in `/v1/models` on both platforms.
3. Aligned model ids across Token Factory and build.nvidia.com.
4. A per-request reasoning cap for the reasoning models.
5. Rate-limit and credit headers.
