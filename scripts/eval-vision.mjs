// Measures the image inspection on the labelled images in eval/vision-samples.json.
// Run with `npm run eval:vision` for the configured vision model, or pass models to compare:
//   npm run eval:vision -- nvidia:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning nebius:Qwen/Qwen3.8-27B
import { readFileSync } from 'node:fs';
import { inspect, verdict, visionModel } from '../lib/vision.mjs';

const { samples } = JSON.parse(readFileSync(new URL('../eval/vision-samples.json', import.meta.url), 'utf8'));
const PLATFORMS = {
  nvidia: { base: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1', key: process.env.NVIDIA_API_KEY },
  nebius: { base: process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1', key: process.env.NEBIUS_API_KEY },
};
const chosen = process.argv.slice(2).map(a => { const [platform, ...model] = a.split(':'); return { ...PLATFORMS[platform], model: model.join(':'), label: a }; });
const models = chosen.length ? chosen : [visionModel()].filter(Boolean).map(v => ({ ...v, label: v.name + ':' + v.model }));
if (!models.length) { console.log('No vision model is configured.'); process.exit(1); }

for (const m of models) {
  let right = 0, falseAccepts = [], falseRejects = [], errors = 0, ms = [];
  for (const s of samples) {
    const image = 'data:image/jpeg;base64,' + readFileSync(new URL('../eval/images/' + s.image, import.meta.url)).toString('base64'), t = Date.now();
    try {
      const v = verdict(await inspect(image, { objects: s.required, cue: s.cue }, m));
      ms.push(Date.now() - t);
      const accepted = v.action === 'accept';
      if (accepted === s.accept) right++;
      else (accepted ? falseAccepts : falseRejects).push(s.image + ' [' + s.required.join(', ') + ']' + (accepted ? ' (should fail: ' + s.because + ')' : ' (rejected for: ' + v.issues.join('; ') + ')'));
    } catch (e) { errors++; ms.push(Date.now() - t); console.log('   error on ' + s.image + ': ' + e.message); }
  }
  ms.sort((a, b) => a - b);
  console.log('\n== ' + m.label);
  console.log('   correct verdicts: ' + right + '/' + samples.length + '   errors: ' + errors + '   median ' + ms[ms.length >> 1] + ' ms, slowest ' + ms.at(-1) + ' ms');
  console.log('   rule-breaking images accepted (' + falseAccepts.length + '):' + (falseAccepts.length ? '\n     ' + falseAccepts.join('\n     ') : ' none'));
  console.log('   good images rejected (' + falseRejects.length + '):' + (falseRejects.length ? '\n     ' + falseRejects.join('\n     ') : ' none'));
}
