import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect, verdict, visionModel } from '../lib/vision.mjs';
import { illustrate } from '../lib/orchestrate.mjs';
import { withMocks, CLEAN } from './helpers.mjs';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
const scene = { cue: 'a duck wears a pot', prompt: 'a duck wearing a cooking pot', objects: ['duck', 'cooking pot'] };
const findings = extra => ({ ...CLEAN, required: [{ object: 'duck', present: true }], ...extra });

test('the image rules are applied by code to the inspector\'s findings', () => {
  assert.deepEqual(verdict(findings()), { action: 'accept', issues: [], notes: [] });
  const rejects = extra => verdict(findings(extra)).issues;
  assert.deepEqual(rejects({ text: 'detected' }), ['text, letters or numerals are visible']);
  assert.deepEqual(rejects({ logo_or_brand: 'detected' }), ['a logo or brand is visible']);
  assert.deepEqual(rejects({ real_person: 'detected' }), ['a real person or photograph of a person is visible']);
  assert.deepEqual(rejects({ style: 'major_deviation' }), ['the picture is not an ink illustration on a white background']);
  assert.deepEqual(rejects({ required: [{ object: 'duck', present: true }, { object: 'pot', present: false }] }), ['missing: pot']);
  assert.deepEqual(rejects({ interaction: 'wrong_action' }), ['the picture shows a different action from the cue']);
  assert.deepEqual(rejects({ clarity: 'unclear' }), ['the main objects are not recognisable']);
  // Lesser findings do not reject: a small style drift, no action to show, or an uncertain reading (which is noted).
  assert.equal(verdict(findings({ style: 'minor_deviation', interaction: 'no_action', clarity: 'partly_clear' })).action, 'accept');
  assert.deepEqual(verdict(findings({ text: 'uncertain' })), { action: 'accept', issues: [], notes: ['text uncertain'] });
});

test('the inspector is sent the image with the required objects, and its report is validated', () => withMocks({ jpeg: JPEG, vision: [{ visible_objects: ['duck', 'pot'] }] }, async m => {
  const f = await inspect('data:image/jpeg;base64,' + JPEG, scene);
  assert.deepEqual(m.calls.vision[0], { model: 'vision/test', required: ['duck', 'cooking pot'], image: 'data:image/jpeg;base64,' + JPEG });
  assert.deepEqual([f.visible_objects, f.required, f.text, f.model], [['duck', 'pot'], [{ object: 'duck', present: true }, { object: 'cooking pot', present: true }], 'not_detected', 'vision/test']);
}));

test('an object the inspector does not confirm counts as missing, and a malformed report is retried then refused', async () => {
  await withMocks({ jpeg: JPEG, vision: [{ required: [{ object: 'duck', present: true }] }] }, async () => {
    assert.deepEqual((await inspect('data:x', scene)).required, [{ object: 'duck', present: true }, { object: 'cooking pot', present: false }]);
  });
  await withMocks({ jpeg: JPEG, vision: ['The image shows a duck.', {}] }, async m => {
    assert.equal((await inspect('data:x', scene)).text, 'not_detected');
    assert.equal(m.calls.vision.length, 2, 'retried once');
  });
  await withMocks({ jpeg: JPEG, vision: [{ text: 'maybe' }] }, () => assert.rejects(inspect('data:x', scene), /no valid "text"/));
  await withMocks({ jpeg: JPEG, vision: ['```json\n' + JSON.stringify({ ...CLEAN, required: [] }) + '\n```'] }, async () => assert.equal((await inspect('data:x', { objects: [] })).style, 'consistent'));
});

test('the vision platform follows the text platform unless VISION_PROVIDER names the other one', () => withMocks({ jpeg: JPEG }, () => {
  assert.deepEqual([visionModel().name, visionModel().model], ['nebius', 'vision/test']);
  process.env.NVIDIA_API_KEY = 'nv'; process.env.VISION_PROVIDER = 'nvidia';
  try { assert.deepEqual([visionModel().name, visionModel().model], ['nvidia', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning']); }
  finally { delete process.env.NVIDIA_API_KEY; delete process.env.VISION_PROVIDER; }
  process.env.NEBIUS_VISION_MODEL = '';
  assert.equal(visionModel(), null, 'an empty model switches inspection off');
}));

test('a clean image is accepted on the first attempt', () => withMocks({ jpeg: JPEG }, async m => {
  const r = await illustrate(scene);
  assert.equal(r.image, 'data:image/jpeg;base64,' + JPEG);
  assert.deepEqual([r.review.status, r.review.attempts, r.review.model, m.calls.image.length], ['accepted', 1, 'vision/test', 1]);
  assert.match(m.calls.image[0].prompt, /a duck wearing a cooking pot No written words/);
}));

test('a rule-breaking image is regenerated with a correction aimed at what was wrong', () => withMocks({ jpeg: JPEG, vision: [{ text: 'detected', required: [{ object: 'duck', present: true }, { object: 'cooking pot', present: false }] }, {}] }, async m => {
  const r = await illustrate(scene);
  assert.deepEqual([r.review.status, r.review.attempts, m.calls.image.length], ['accepted', 2, 2]);
  assert.deepEqual(r.review.rejected, [['text, letters or numerals are visible', 'missing: cooking pot']]);
  assert.match(m.calls.image[1].prompt, /must contain no letters, numbers, labels, signs or logos anywhere.* It must clearly show: cooking pot\./);
  assert.doesNotMatch(m.calls.image[0].prompt, /must clearly show/);
}));

test('after three rule-breaking images the last one is kept and marked for review', () => withMocks({ jpeg: JPEG, vision: [{ style: 'major_deviation' }] }, async m => {
  const r = await illustrate(scene);
  assert.deepEqual([r.review.status, r.review.attempts, m.calls.image.length, m.calls.vision.length], ['needs_review', 3, 3, 3]);
  assert.deepEqual(r.review.issues, ['the picture is not an ink illustration on a white background']);
  assert.match(m.calls.image[2].prompt, /simple black ink line illustration on a plain white background, not a photograph/);
  assert.ok(r.image.startsWith('data:image/jpeg'));
}));

test('with no vision model, or an inspector that cannot be read, the image is kept and marked unchecked', async () => {
  await withMocks({ jpeg: JPEG, vision: null }, async m => {
    const r = await illustrate(scene);
    assert.deepEqual([r.review.status, r.review.reason, m.calls.vision.length], ['unchecked', 'No vision model is configured.', 0]);
  });
  await withMocks({ jpeg: JPEG, vision: ['not json at all'] }, async m => {
    const r = await illustrate(scene);
    assert.deepEqual([r.review.status, m.calls.image.length], ['unchecked', 1]);
    assert.match(r.review.reason, /unreadable report/);
  });
});
