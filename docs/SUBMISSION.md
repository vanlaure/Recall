# Submission checklist and text

Nebius x NVIDIA Global AI Hackathon, Best Apps and Agents track. Deadline: **30 October 2026, 10:00 am Pacific**
(1:00 pm Eastern). Judging 1 to 15 December 2026; judges must be able to use the app free of charge until then.
Official rules: https://nebiusglobalaihackathon.devpost.com/rules

## Status of each requirement

| Requirement | State on 2026-10-22 | What remains |
|---|---|---|
| Runtime call to Nebius Token Factory | Done: every agent runs on `nvidia/nemotron-3-super-120b-a12b` through Token Factory when `TEXT_PROVIDER=nebius`; each kit records the platform and model | Keep `TEXT_PROVIDER=nebius` on the hosted demo; confirm the model is still listed before recording the video (`npm run check`) |
| At least one NVIDIA open model | Done: Nemotron 3 Super for all six agents; NVIDIA Parakeet for speech | — |
| Track fit | Done: an agent workflow with typed decisions, a code-enforced contract and a repair loop | Pick "Best Apps and Agents" on the form |
| Public repository on GitHub with a detectable open-source licence | `LICENSE` is now plain MIT (GitHub detects it). The repository is public and GitHub reports the MIT licence (checked 2026-10-22). | — |
| README with setup and a clear statement of where Nemotron and Token Factory are used | Done (README "How Nemotron and Token Factory are used") | — |
| Working demo URL | Deployed on Railway: https://recall-production-c60d.up.railway.app/app (project hearty-adventure, volume at `/data`, `SIGNUP_CODE` set). On 2026-10-22 it was exercised through its API: sign-up, verse retrieval, kit creation on Token Factory, an inspected image, the library, a mixed kit split into parts, and speech-to-text on a generated clip. | Give judges the sign-up code, or create a judge account; click through the studio in a browser once; try the Speak button with a real microphone |
| Text description | Draft below | Paste into Devpost; adjust length to the form |
| Demo video, under 3 minutes, public on YouTube, no third-party trademarks or music | Not started | Record after the demo is deployed; script below |
| Best Use of Tavily bonus ($3,000; stacks with a track award) | Done in code: the Research Agent makes a runtime Tavily search call to find the Wikiquote page for a quotation and to name a described Bible passage; wording still comes from the source (README "How Tavily is used") | The hosted demo's config reports Tavily as configured (2026-10-22). Show a described verse in the video; tick the Tavily bonus on the form |
| Feedback on Token Factory and NVIDIA tools | Draft in `docs/TOOL-FEEDBACK.md` | Paste into the feedback section of the form |
| Optional decision model (Laya) | Built, measured (`docs/EVALUATION.md`) and, on 2026-10-22, deployed on Railway: it read plain word lists as ordered items (86 to 96 percent) and the peg system was chosen. Then removed from the live demo for its cost (roughly 20 to 30 dollars a month). The hosted demo runs without it: code facts decide what they can and the Nemotron Memory Expert chooses the rest | Decide whether to redeploy it for judging (`docs/DEPLOY.md` section 2) or describe it as optional |
| Testing instructions with credentials if login is required | Template below | Fill in the URL and the sign-up code or judge account |
| Explanation of what was built during the period | `docs/CHANGES.md` | — |
| Rights to all content | Code is original; the gallery artwork is the owner's own GPT-generated work, recorded in `docs/ASSET-LICENSES.md` | — |

## Testing instructions (template)

```
URL: https://<your-domain>/app
Create an account with the sign-up code: <code>   (or log in as judge / <password>)
1. Create: type "milk, eggs, bread" in the one box and press Create storyboard. Recall works out it is a list. Watch
   the agent steps stream in: technique selection (the Memory Expert, since the hosted demo runs without the decision
   model), storyboard, contract check, rules review. Open the Recall sheet tab for the technique, each cue and picture.
2. Press "Generate all images". Each image is inspected by a vision model and regenerated if it breaks a rule.
3. Practise tab: "Practise all 3 items", answer from memory, use a hint if needed, then "Finish and check".
4. Miss the same item in two sessions and press "Rewrite this cue" to see the repair agent diagnose and rewrite it.
5. Tools: save a memory palace, then create a list kit with it chosen under More options; every scene lands on your own route.
6. Create: type "John 3:16" and press Create. The verse is retrieved from a public-domain translation with a citation
   and the kit is built straight away.
7. Create: type "a famous quote by Jim Croce" and press Create. Matching quotations are shown with where each comes from
   and a link to check it; choose one to build the kit.
8. Create: type "the verse about God loving the world". Tavily web search names the passage (the card says so and links
   where), and the wording is fetched from the public-domain translation, never from the search result.
9. Create: type "milk, eggs, bread, 8472" (mixed material). Recall splits it into parts, each with its own technique:
   the words on one method and the number on the Major system, which code chooses without a model. The Storyboard tab
   labels each scene with its technique; the Recall sheet and "How the techniques were chosen" explain each part.
10. Create: press Speak and say a request or a list (needs a microphone, on HTTPS or localhost). The words appear in the
    box for you to correct before pressing Create.
Text generation runs on Nebius Token Factory (nvidia/nemotron-3-super-120b-a12b); images and speech on NVIDIA's
hosted API; image inspection on Nebius (zai-org/GLM-5.3-Flash). Images and speech use a free developer key with
rate limits; if an image fails, text and practice keep working.
```

Judge verifiability (add to the testing instructions once deployed):

```
11. Tools, Live benchmark: runs 5 held-out tasks through the full workflow and scores them in code beside the
   published numbers (a few minutes). Every run, including failures, is listed at https://<your-domain>/eval.
12. Any kit: "Export audit JSON" downloads a receipt of every decision and every refusal, with reasons.
13. https://<your-domain>/eval needs no login: what the code refused, and why.
```

## Project description (draft)

**Recall** turns words you need to remember into illustrated memory storyboards, then trains you on them.

Type, paste or speak anything into one box: a list, a passage, a verse reference or a request for a quotation. Recall
looks up verses and quotations and memorises everything else as typed. Code reads what kind each item is (digits, a
year, numbered items, word-and-meaning pairs, names, short items, sentences) and settles what it can without a model.
Material that mixes kinds is split into up to four parts, each with its own technique and its own contract: a shopping
list on one method and a locker code on the Major system. For text, an optional small self-hosted decision model
(Laya) answers typed questions about what has to be recalled, and when it is not there or not confident, a Nemotron
Memory Expert chooses from the catalogue: link, loci, pegs, keyword, chunking, narrative, Major system, number shapes,
person-action-object or visual association. The hosted demo runs without Laya.

A Nemotron Storyboard Agent then writes one scene per item against a **contract that code enforces**: the source
wording must be exact, the technique must leave checkable evidence (Major-system words must decode to the digits,
every palace cue needs its own place in route order, every peg must be distinct), and image prompts may contain no
numerals, text or logos. Violations go back to the agent with the specific failure, at most three times. A Nemotron
Rules Agent then reviews cue ambiguity. Images are generated per scene and inspected by a vision model whose typed
report code checks; rule-breaking images are regenerated with a targeted correction.

Every kit has a Recall sheet that lists its technique, why it was chosen, and each item with its cue and the picture to
imagine, so it can be recalled without the images. Practice is guided, one item at a time, with hints that count against the score; cues missed twice running are
diagnosed and rewritten by a Repair Agent under the same contract. A training plan schedules sessions back from the
date you need the material by, and exports to your calendar. Verses come from public-domain translations and
quotations from Wikiquote with their status and a link, so the model never supplies wording.

Every agent call runs on NVIDIA Nemotron 3 Super through Nebius Token Factory; the kit records the platform, the
model, who chose each technique (and the decision model's answers and confidence when it was used), and every contract check, so a judge can see what the models
decided and what code refused.

## Video script (2:40 target)

1. 0:00 Landing page, the examples. "Recall turns words into pictures you can walk back through."
2. 0:15 Studio: type "milk, eggs, bread" in the one box, Create. Point at the streamed steps: technique selection,
   Storyboard Agent, Contract check, Rules Agent.
3. 0:50 Open "How this technique was chosen": who decided, the facts read by code, the contract enforced. Open the
   Recall sheet tab.
4. 1:05 Generate all images; show the "Image checked" line and one regeneration if it happens.
5. 1:30 Practise: answer two from memory, take a picture hint for one, Finish. Show the results and the Progress tab.
6. 1:55 Type "milk, eggs, bread, 8472": Recall splits it into two parts; code picks the Major system for the number
   without a model call and the words decode to the digits; each scene is labelled with its technique.
7. 2:15 Type "John 3:16": verse retrieved with a citation; phrase beats; the reference scene.
8. 2:35 The kit header: "Built with nvidia/nemotron-3-super-120b-a12b on Nebius Token Factory." End.

Record with the studio at 1280 px wide, no music, no third-party logos on screen.
