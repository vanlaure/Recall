# Recall

Visual memorization by Van Williams AI.

## Landing-page preview
Open `index.html` directly in a browser, or run `python -m http.server 3000` in this directory and visit http://localhost:3000. No dependencies or API keys are required for this preview.

The responsive landing page uses the supplied black-and-white layout and colorful mnemonic illustrations. Motion can be paused and respects reduced-motion preferences. Text drafts are stored only in browser localStorage and can be cleared.

## Implementation status
Implemented: landing page, illustrated examples, real how-it-works section, local draft save/clear.
Planned: microphone/audio transcription, orchestration and memory agents, Laya decisions, NVIDIA Nemotron on Nebius, actual image generation, saved storyboards and recall scheduling. No live AI functionality is claimed by this preview.

## Assets and attribution
Illustrations were supplied by the repository owner as design references and demonstration assets. Their provenance and redistribution permission must be verified before public release. They are excluded from the code license until that review is complete. No endorsement by any memory expert is claimed. Example captions describe the actual supplied illustrations; unsupported number encodings and guaranteed-memory claims have been omitted.

## Hackathon preparation
Before submission: implement real NVIDIA/Nebius runtime integration, publish licensed source, provide setup instructions, working demo and required video. Track component licenses separately; never commit secrets.
