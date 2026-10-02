// Live check of every configured AI provider. Run with `npm run check` after editing .env.
// Never prints key values. Exits non-zero if a configured provider fails or text is unconfigured.
import {agent,decide,image} from '../lib/providers.mjs';
const env=process.env,base=u=>u.replace(/\/$/,'');let failed=false;
const ok=(name,msg)=>console.log('PASS  '+name+' — '+msg),skip=(name,msg)=>console.log('SKIP  '+name+' — '+msg),fail=(name,msg)=>{failed=true;console.log('FAIL  '+name+' — '+msg)};
const set=k=>env[k]?'set':'missing';
async function models(url,key){const r=await fetch(base(url)+'/models',{headers:key?{Authorization:'Bearer '+key}:{},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('model list returned '+r.status);return ((await r.json()).data||[]).map(m=>m.id);}

// Text: the hackathon requires a runtime Token Factory call to an NVIDIA open model.
const textBase=env.NEBIUS_BASE_URL||'https://api.tokenfactory.nebius.com/v1';
if(!env.NEBIUS_API_KEY||!env.NEBIUS_MODEL)fail('text','NEBIUS_API_KEY is '+set('NEBIUS_API_KEY')+', NEBIUS_MODEL is '+set('NEBIUS_MODEL')+'. Nothing in the studio can generate until both are set.');
else try{
  const ids=await models(textBase,env.NEBIUS_API_KEY),nvidia=ids.filter(i=>i.startsWith('nvidia/'));
  console.log('      NVIDIA models on this account: '+(nvidia.join(', ')||'none'));
  if(!ids.includes(env.NEBIUS_MODEL))fail('text','NEBIUS_MODEL "'+env.NEBIUS_MODEL+'" is not in the account model list.');
  else{if(!env.NEBIUS_MODEL.startsWith('nvidia/'))console.log('      WARNING: NEBIUS_MODEL is not an nvidia/ model; the hackathon requires an NVIDIA open model.');
    const t=Date.now(),r=await agent('Check Agent: return {ok:boolean,word:string} where word is the supplied word reversed.',{word:'recall'});
    if(r.ok===true&&r.word==='llacer')ok('text',env.NEBIUS_MODEL+' returned valid JSON in '+(Date.now()-t)+' ms');else fail('text','model answered but not as asked: '+JSON.stringify(r).slice(0,200));}
}catch(e){fail('text',e.message)}

// Images: optional. Scenes still get prompts and cues without it.
if(!env.IMAGE_BASE_URL||!env.IMAGE_MODEL)skip('images','IMAGE_BASE_URL is '+set('IMAGE_BASE_URL')+', IMAGE_MODEL is '+set('IMAGE_MODEL')+'. Storyboards will have no pictures.');
else try{const t=Date.now(),src=await image('A red apple wearing sunglasses, ink illustration on a white background.');ok('images',env.IMAGE_MODEL+' returned '+(src.startsWith('data:')?Math.round(src.length*.75/1024)+' KB inline':'an https URL')+' in '+(Date.now()-t)+' ms')}catch(e){fail('images',e.message)}

// Speech: optional. Typed input works without it. Sends one second of silence to prove the endpoint accepts audio.
if(!env.SPEECH_BASE_URL||!env.SPEECH_MODEL)skip('speech','SPEECH_BASE_URL is '+set('SPEECH_BASE_URL')+', SPEECH_MODEL is '+set('SPEECH_MODEL')+'. Recording and audio upload are disabled; typing still works.');
else try{
  const rate=16000,wav=Buffer.alloc(44+rate*2);wav.write('RIFF',0);wav.writeUInt32LE(36+rate*2,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(rate*2,40);
  const form=new FormData();form.append('model',env.SPEECH_MODEL);form.append('file',new Blob([wav],{type:'audio/wav'}),'silence.wav');
  const t=Date.now(),r=await fetch(base(env.SPEECH_BASE_URL)+'/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+env.SPEECH_API_KEY},body:form,signal:AbortSignal.timeout(120000)});
  if(!r.ok)fail('speech','transcription endpoint returned '+r.status);else if(typeof (await r.json()).text!=='string')fail('speech','response has no text field');else ok('speech',env.SPEECH_MODEL+' accepted audio in '+(Date.now()-t)+' ms');
}catch(e){fail('speech',e.message)}

// Laya: optional advisory service.
if(!env.LAYA_BASE_URL)skip('laya','LAYA_BASE_URL is missing. The Memory Expert selection is used on its own.');
else try{await decide({units:['milk'],selection:{technique:'link'}});ok('laya','decision service answered')}catch(e){fail('laya',e.message)}

console.log('APP_TOKEN is '+set('APP_TOKEN')+(env.APP_TOKEN?'':' — fine on 127.0.0.1, required before hosting the demo publicly.'));
process.exitCode=failed?1:0;
