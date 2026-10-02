// Inspection of generated images. A vision model reports what it sees as typed fields; code then applies the
// image rules to that report. The model describes, the code decides: a confident-sounding description cannot
// approve an image that its own findings say breaks a rule.
import { request, textProvider } from './providers.mjs';

const INSPECT = 'You inspect one generated illustration for a memory app. Report only what is actually visible. Return only JSON with exactly these fields: '
  + '{"visible_objects":[up to 8 short names of the main things you can see],'
  + '"required":[{"object":string,"present":true|false} for each required object given below, in the same order],'
  + '"text":"detected"|"not_detected"|"uncertain" (any letters, words, numerals, captions, labels, signage or watermark anywhere, including garbled lettering on packaging),'
  + '"logo_or_brand":"detected"|"not_detected"|"uncertain",'
  + '"real_person":"detected"|"not_detected"|"uncertain" (a recognisable real individual or a photograph of a person; a generic cartoon person is not_detected),'
  + '"style":"consistent"|"minor_deviation"|"major_deviation" (the required style is a hand-drawn ink illustration with outlines on a plain white background; a photograph or a full-colour painted scene is major_deviation),'
  + '"interaction":"correct_action"|"wrong_action"|"no_action"|"not_applicable" (whether the intended action below is what the picture shows),'
  + '"clarity":"clear"|"partly_clear"|"unclear" (whether the main objects are recognisable at small size)}.';

const ENUMS = {
  text: ['detected', 'not_detected', 'uncertain'], logo_or_brand: ['detected', 'not_detected', 'uncertain'], real_person: ['detected', 'not_detected', 'uncertain'],
  style: ['consistent', 'minor_deviation', 'major_deviation'], interaction: ['correct_action', 'wrong_action', 'no_action', 'not_applicable'], clarity: ['clear', 'partly_clear', 'unclear'],
};

// The vision model, or null when none is configured. It runs on the text platform unless VISION_PROVIDER names the other one.
export function visionModel() {
  const p = textProvider(process.env.VISION_PROVIDER || process.env.TEXT_PROVIDER);
  const model = p.name === 'nvidia' ? process.env.NVIDIA_VISION_MODEL ?? 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning' : process.env.NEBIUS_VISION_MODEL ?? 'zai-org/GLM-5.3-Flash';
  return model && p.key ? { ...p, model } : null;
}

// Asks the vision model what the image shows. `image` is a data: URL; `scene` supplies the intended cue and required objects.
// Returns validated findings, or throws if the model's report is not in the required form (after one retry).
export async function inspect(image, scene, override) {
  const v = override || visionModel();
  if (!v) return null;
  try { return await report(v, image, scene); } catch (e) { if (e.status) throw e; return report(v, image, scene); }
}
async function report(v, image, scene) {
  const required = (scene.objects || []).slice(0, 6);
  const r = await request(v.base, '/chat/completions', v.key, {
    model: v.model, temperature: 0, max_tokens: 1500,
    messages: [{ role: 'user', content: [
      { type: 'text', text: INSPECT + '\nRequired objects: ' + JSON.stringify(required) + '\nIntended action: ' + (scene.cue || 'not stated') },
      { type: 'image_url', image_url: { url: image } },
    ] }],
  });
  const raw = (r.choices?.[0]?.message?.content || '').replace(/^[\s\S]*?(?=\{)/, '').replace(/\}[^}]*$/, '}');
  let f;
  try { f = JSON.parse(raw); } catch { throw Error('The vision model returned an unreadable report.'); }
  for (const [field, allowed] of Object.entries(ENUMS)) if (!allowed.includes(f[field])) throw Error('The vision model report has no valid "' + field + '".');
  const seen = Array.isArray(f.required) ? f.required : [];
  return {
    visible_objects: Array.isArray(f.visible_objects) ? f.visible_objects.slice(0, 8).map(String) : [],
    // Anything the model did not explicitly confirm counts as missing.
    required: required.map((object, i) => ({ object, present: seen[i]?.present === true })),
    text: f.text, logo_or_brand: f.logo_or_brand, real_person: f.real_person, style: f.style, interaction: f.interaction, clarity: f.clarity,
    model: v.model,
  };
}

// Names and faces: reads a learner's own photo for features a name can be hooked onto. It describes, never identifies.
// Returns up to three short feature names, or null when no vision model is configured.
const FACE = 'You help someone remember a name by noticing what is distinctive about a face in their own photo. Do not identify the person and do not guess their name, age, ethnicity, health or character. '
  + 'Return only JSON: {"features":[up to three short plain names of clearly visible, neutral features a memory hook could attach to, most distinctive first, such as "curly hair", "round glasses", "thick eyebrows", "beard", "wide smile"]}.';
export async function describeFace(photo, override) {
  const v = override || visionModel();
  if (!v) return null;
  const r = await request(v.base, '/chat/completions', v.key, {
    model: v.model, temperature: 0, max_tokens: 400,
    messages: [{ role: 'user', content: [{ type: 'text', text: FACE }, { type: 'image_url', image_url: { url: photo } }] }],
  });
  const raw = (r.choices?.[0]?.message?.content || '').replace(/^[\s\S]*?(?=\{)/, '').replace(/\}[^}]*$/, '}');
  let f;
  try { f = JSON.parse(raw); } catch { throw Error('The vision model could not describe the photo.'); }
  return (Array.isArray(f.features) ? f.features : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 40)).slice(0, 3);
}

// Applies the image rules to the findings. Returns {action, issues}: 'accept', or 'regenerate' with the reasons.
export function verdict(findings) {
  const issues = [];
  if (findings.text === 'detected') issues.push('text, letters or numerals are visible');
  if (findings.logo_or_brand === 'detected') issues.push('a logo or brand is visible');
  if (findings.real_person === 'detected') issues.push('a real person or photograph of a person is visible');
  if (findings.style === 'major_deviation') issues.push('the picture is not an ink illustration on a white background');
  const missing = findings.required.filter(r => !r.present).map(r => r.object);
  if (missing.length) issues.push('missing: ' + missing.join(', '));
  if (findings.interaction === 'wrong_action') issues.push('the picture shows a different action from the cue');
  if (findings.clarity === 'unclear') issues.push('the main objects are not recognisable');
  const notes = ['text', 'logo_or_brand', 'real_person'].filter(k => findings[k] === 'uncertain').map(k => k.replace(/_/g, ' ') + ' uncertain');
  return { action: issues.length ? 'regenerate' : 'accept', issues, notes };
}
