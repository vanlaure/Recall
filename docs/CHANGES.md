# Changes

Dated record of functionality added or changed, newest first. Everything here was built during the Nebius x NVIDIA
Global AI Hackathon submission period (26 August to 30 October 2026); the repository itself began on 2 October 2026.

## 2026-10-21: Tavily search in the Research Agent

- **Tavily finds where material lives, never what it says.** With `TAVILY_API_KEY` set, the Research Agent asks
  Tavily which Wikiquote page holds the quotation the learner wants (ranked by person, work and topic together), and
  which chapter and verse a passage described in words refers to. Wording is still fetched from Wikiquote or a
  public-domain translation; search snippets are never shown. The studio says when Tavily found the page and links
  where it named a passage. If Tavily is not configured or does not answer, the previous Wikiquote search is used.
  Tests in `test/features.test.mjs`, including that a snippet's paraphrase never reaches the result.

## 2026-10-21: judge verifiability

- **Public evaluation page (`/eval`).** No login and no scripts. Lists every live benchmark run; counts what code
  refused across all accounts (storyboards sent back by check, images redrawn, cues rewritten) without showing any
  wording; and shows the full refusal record for accounts named in `EVAL_PUBLIC_USERS` (`lib/evalpage.mjs`).
- **Live benchmark.** Studio, Tools: five tasks at random from the held-out test split run through `createKit`, scored
  by code for technique choice, contract compliance and attempts, beside the numbers in `docs/EVALUATION.md`. Not saved
  to the library; logged to `DATA_DIR/benchmarks.json` (last 50) and shown on `/eval` (`lib/benchmark.mjs`).
- **Export audit JSON.** Each kit can download a receipt built by the server from the kit's own trace, image reviews
  and repairs (`GET /api/kits/:id/audit`, `lib/audit.mjs`).
- The Docker image now carries `eval/technique-samples.json`. Tests in `test/verifiability.test.mjs`.

## 2026-10-03 — fixes from the end-to-end audit

Found by running the whole product against the live providers (`Recall-E2E-Test-Report-2026-10-03`, kept outside the
repository). Regression tests for each item are in `test/fixes.test.mjs`.

- **Link contract no longer fails on plurals.** The check that a cue mentions the next item required a four-letter word
  such as "eggs" verbatim, so the landing page's own example failed whenever Nemotron wrote "egg". Cue and item words
  are now compared by stem (`lib/validate.mjs`).
- **Rules Agent brief narrowed and a last-attempt fallback added.** The reviewer was rejecting code-compliant
  storyboards for reasons outside its brief (the last link item "must link onward", verb tense differences between cue
  and prompt) and spending the three attempts. It is now told what code has already verified, that the last link scene
  has no next item, and what a reference scene is for; A separate **Word check** call asks
  whether each Major-system encoding word is a real dictionary word; a coinage such as "forkin" (which decodes to 8472
  but cannot be pictured) is sent back as a violation. Asked as one focused question the model answered this 3/3 in
  testing where the same rule buried in the review brief was ignored. If it still objects on the third attempt to a storyboard that passed every code check, the kit is
  kept and its reservations are shown with the kit (`kit.notes`).
- **Major-system word candidates.** Code now computes real, picturable words whose consonant sounds spell each
  unit's digits (`lib/major-words.mjs`, about 300 nouns read by the same decoder that checks storyboards) and
  passes them to the Storyboard Agent as `contract.word_candidates`, so it has no reason to coin a word. Every one-
  and two-digit chunk is covered.
- **Reference scene failures are visible.** A reference scene that could not be built is reported in the kit instead
  of silently left out.
- **Model lifecycle.** NVIDIA's API retired `nvidia/nemotron-3-super-120b-a12b` on 2026-10-03 (HTTP 410). The NVIDIA
  default is now `nvidia/nemotron-3-ultra-550b-a55b`; `/api/config` reports whether the configured text model is still
  in its platform's catalogue and the studio header warns when it is not.
- **Provider errors.** Connection failures and timeouts are reported with the host and the cause instead of
  "fetch failed"; the per-call timeout is `PROVIDER_TIMEOUT_MS` (default 60 s, was a fixed 120 s); a dropped
  connection is retried once; a timeout is not.
- **Stop button.** A generation can be stopped from the studio; closing the stream also aborts the provider calls in
  flight, and the hourly slot is returned.
- **Hourly allowances are refunded** when a request never reached a model, was stopped, or failed at the provider.
- **Speech.** `<unk>` tokens are stripped from transcripts; silence now yields "No words were heard" instead of a line
  of placeholders.
- **Login limits** count failed attempts only, per address and per username; new accounts are limited per address.
- **Request log.** One JSON line per API request on stdout (method, path, status, duration, account id) and one for
  every provider failure or internal fault; `X-Request-Id` on every response. `LOG_REQUESTS=0` silences it.
- **Security headers.** Content-Security-Policy (the studio allows no inline code), `X-Frame-Options: DENY`,
  Permissions-Policy (microphone only), HSTS behind an https proxy.
- **Internal errors** are answered in plain words with the request id; unreadable bodies get a clear message.
- **Growth.** Expired sessions are pruned, quiet rate-limit keys are swept, cached libraries are evicted least recently
  used, and an account may keep at most `LIMIT_KITS_PER_ACCOUNT` kits (default 200).
- **Container.** Runs as the unprivileged `node` user; binds every interface even if an env file sets a loopback HOST.
- **Studio.** The browser's Back button steps back through studio pages; the status toast dismisses on click and after
  twelve seconds; the kit title is the page's `h1`; the landing page's top strip sits inside the header landmark.
- **Docs.** `.env.example` documents every variable the code reads; `LICENSE` is the plain MIT text (GitHub now detects
  it) with the artwork statement moved to `NOTICE.md`; `docs/SUBMISSION.md`, `docs/TOOL-FEEDBACK.md` and
  `docs/ASSET-LICENSES.md` added.

## 2026-10-02 — decision layer, training, research, deployment

Per-category authority for the Laya decision model with an audit trail and training export; training plans, cue
repair, studio pages and research (Wikiquote, bible-api); image inspection; accounts with per-account libraries; a
text platform switch; NVIDIA hosted speech and images; the landing page and gallery; Dockerfile and Railway
configuration. See the merged pull requests #1 to #13 for the detail.
