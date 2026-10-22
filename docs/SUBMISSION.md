# Submission checklist and text

Nebius x NVIDIA Global AI Hackathon, Best Apps and Agents track. Deadline: **30 October 2026, 10:00 am Pacific**
(1:00 pm Eastern). Judging 1 to 15 December 2026; judges must be able to use the app free of charge until then.
Official rules: https://nebiusglobalaihackathon.devpost.com/rules

## Status of each requirement

| Requirement | State on 2026-10-03 | What remains |
|---|---|---|
| Runtime call to Nebius Token Factory | Done: every agent runs on `nvidia/nemotron-3-super-120b-a12b` through Token Factory when `TEXT_PROVIDER=nebius`; each kit records the platform and model | Keep `TEXT_PROVIDER=nebius` on the hosted demo; confirm the model is still listed before recording the video (`npm run check`) |
| At least one NVIDIA open model | Done: Nemotron 3 Super for all six agents; NVIDIA Parakeet for speech | — |
| Track fit | Done: an agent workflow with typed decisions, a code-enforced contract and a repair loop | Pick "Best Apps and Agents" on the form |
| Public repository on GitHub with a detectable open-source licence | `LICENSE` is now plain MIT (GitHub detects it). **The repository is still private.** | Make `vanlaure/Recall` public: `gh repo edit vanlaure/Recall --visibility public --accept-visibility-change-consequences`, then check the About panel shows "MIT license" |
| README with setup and a clear statement of where Nemotron and Token Factory are used | Done (README "How Nemotron and Token Factory are used") | — |
| Working demo URL | Not started (deployment deliberately deferred to save credits) | Deploy per `docs/DEPLOY.md`; set `SIGNUP_CODE`; create a judge account |
| Text description | Draft below | Paste into Devpost; adjust length to the form |
| Demo video, under 3 minutes, public on YouTube, no third-party trademarks or music | Not started | Record after the demo is deployed; script below |
| Best Use of Tavily bonus ($3,000; stacks with a track award) | Done in code: the Research Agent makes a runtime Tavily search call to find the Wikiquote page for a quotation and to name a described Bible passage; wording still comes from the source (README "How Tavily is used") | Set `TAVILY_API_KEY` on the hosted demo; show "Find it" with a described verse in the video; tick the Tavily bonus on the form |
| Feedback on Token Factory and NVIDIA tools | Draft in `docs/TOOL-FEEDBACK.md` | Paste into the feedback section of the form |
| Testing instructions with credentials if login is required | Template below | Fill in the URL and the sign-up code or judge account |
| Explanation of what was built during the period | `docs/CHANGES.md` | — |
| Rights to all content | Code is original; the gallery artwork is the owner's own GPT-generated work, recorded in `docs/ASSET-LICENSES.md` | — |

## Testing instructions (template)

```
URL: https://<your-domain>/app
Create an account with the sign-up code: <code>   (or log in as judge / <password>)
1. Create: type "milk, eggs, bread", choose "Word list", press Create storyboard. Watch the agent steps stream in:
   decision model, technique, storyboard, contract check, rules review.
2. Press "Generate all images". Each image is inspected by a vision model and regenerated if it breaks a rule.
3. Practise tab: "Practise all 3 items", answer from memory, use a hint if needed, then "Finish and check".
4. Miss the same item in two sessions and press "Rewrite this cue" to see the repair agent diagnose and rewrite it.
5. Tools: save a memory palace, then create a list kit with it selected; every scene lands on your own route.
6. Create: "Find it" with "John 3:16" retrieves the verse from a public-domain translation with a citation.
7. Create: "Find it" with "the verse about God loving the world". Tavily web search names the passage (the card says
   so and links where), and the wording is fetched from the public-domain translation, never from the search result.
Text generation runs on Nebius Token Factory (nvidia/nemotron-3-super-120b-a12b); images and speech on NVIDIA's
hosted API; image inspection on Nebius (zai-org/GLM-5.3-Flash). Images and speech use a free developer key with
rate limits; if an image fails, text and practice keep working.
```

Judge verifiability (add to the testing instructions once deployed):

```
8. Tools, Live benchmark: runs 5 held-out tasks through the full workflow and scores them in code beside the
   published numbers (a few minutes). Every run, including failures, is listed at https://<your-domain>/eval.
9. Any kit: "Export audit JSON" downloads a receipt of every decision and every refusal, with reasons.
10. https://<your-domain>/eval needs no login: what the code refused, and why.
```

## Project description (draft)

**Recall** turns words you need to remember into illustrated memory storyboards, then trains you on them.

Paste or dictate a list, a passage, a verse or a quotation. Code reads the facts of the material (digits, counts,
numbered items, word-and-meaning pairs); a small self-hosted decision model answers typed questions about what has to
be recalled; and when neither can settle it, a Nemotron Memory Expert chooses a technique from the catalogue: link,
loci, pegs, keyword, chunking, narrative, Major system, number shapes, person-action-object or visual association.

A Nemotron Storyboard Agent then writes one scene per item against a **contract that code enforces**: the source
wording must be exact, the technique must leave checkable evidence (Major-system words must decode to the digits,
every palace cue needs its own place in route order, every peg must be distinct), and image prompts may contain no
numerals, text or logos. Violations go back to the agent with the specific failure, at most three times. A Nemotron
Rules Agent then reviews cue ambiguity. Images are generated per scene and inspected by a vision model whose typed
report code checks; rule-breaking images are regenerated with a targeted correction.

Practice is guided, one item at a time, with hints that count against the score; cues missed twice running are
diagnosed and rewritten by a Repair Agent under the same contract. A training plan schedules sessions back from the
date you need the material by, and exports to your calendar. Verses come from public-domain translations and
quotations from Wikiquote with their status and a link, so the model never supplies wording.

Every agent call runs on NVIDIA Nemotron 3 Super through Nebius Token Factory; the kit records the platform, the
model, the decision model's answers and confidence, and every contract check, so a judge can see what the models
decided and what code refused.

## Video script (2:40 target)

1. 0:00 Landing page, the examples. "Recall turns words into pictures you can walk back through."
2. 0:15 Studio: type "milk, eggs, bread", Create. Point at the streamed steps: decision model 99 % "ordered items",
   Link system, Storyboard Agent, Contract check, Rules Agent.
3. 0:50 Open "How this technique was chosen": facts read by code, the typed questions, the contract enforced.
4. 1:05 Generate all images; show the "Image checked" line and one regeneration if it happens.
5. 1:30 Practise: answer two from memory, take a picture hint for one, Finish. Show the results and the Progress tab.
6. 1:55 Type "8472": code picks the Major system without a model call; the words decode to the digits; the drill on
   the Tools page checks the same way.
7. 2:15 "Find it" with "John 3:16": verse retrieved with a citation; phrase beats; the reference scene.
8. 2:35 The kit header: "Built with nvidia/nemotron-3-super-120b-a12b on Nebius Token Factory." End.

Record with the studio at 1280 px wide, no music, no third-party logos on screen.
