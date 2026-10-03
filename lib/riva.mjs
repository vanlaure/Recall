// Minimal dependency-free client for NVIDIA Riva speech recognition over gRPC (HTTP/2 + protobuf),
// as served by NVIDIA's hosted API at grpc.nvcf.nvidia.com. Only the unary Recognize call is implemented.
import http2 from 'node:http2';
const varint=n=>{const out=[];while(n>127){out.push(n&127|128);n=Math.floor(n/128)}out.push(n);return Buffer.from(out)};
const field=(num,wire,body)=>Buffer.concat([varint(num*8+wire),body]);
const int=(num,v)=>field(num,0,varint(v)),bytes=(num,b)=>field(num,2,Buffer.concat([varint(b.length),b])),str=(num,s)=>bytes(num,Buffer.from(s,'utf8'));
// Returns [[fieldNumber,wireType,value]] where value is a number (varint) or Buffer (length-delimited).
function decode(buf){const out=[];let i=0;const read=()=>{let v=0,m=1,b;do{b=buf[i++];v+=(b&127)*m;m*=128}while(b&128);return v};while(i<buf.length){const tag=read(),num=Math.floor(tag/8),wire=tag&7;if(wire===0)out.push([num,wire,read()]);else if(wire===2){const len=read();out.push([num,wire,buf.subarray(i,i+len)]);i+=len}else if(wire===5)i+=4;else if(wire===1)i+=8;else throw Error('Unsupported protobuf wire type '+wire)}return out}
const sampleRate=wav=>wav.length>28&&wav.toString('ascii',0,4)==='RIFF'?wav.readUInt32LE(24):16000;
// wav: a 16-bit PCM WAV file. Returns the transcript text.
export function recognize({url,functionId,key,wav,language='en-US',timeoutMs=120000}){
  const config=Buffer.concat([int(1,1),int(2,sampleRate(wav)),str(3,language),int(4,1),int(7,1),int(11,1)]);// LINEAR_PCM, rate, language, 1 alternative, mono, punctuation
  const message=Buffer.concat([bytes(1,config),bytes(2,wav)]),frame=Buffer.concat([Buffer.from([0]),Buffer.alloc(4)]);frame.writeUInt32BE(message.length,1);
  return new Promise((resolve,reject)=>{const client=http2.connect(url),done=(fn,v)=>{clearTimeout(timer);client.close();fn(v)},timer=setTimeout(()=>{client.destroy();reject(Error('Speech provider timed out.'))},timeoutMs);
    client.on('error',e=>done(reject,Error('Speech provider connection failed: '+e.message)));
    const req=client.request({':method':'POST',':path':'/nvidia.riva.asr.RivaSpeechRecognition/Recognize','content-type':'application/grpc',te:'trailers','function-id':functionId,authorization:'Bearer '+key.trim()});
    const chunks=[];let status,detail,httpStatus;req.on('response',h=>{httpStatus=h[':status'];if(h['grpc-status']!==undefined){status=h['grpc-status'];detail=h['grpc-message']}});req.on('trailers',t=>{status=t['grpc-status'];detail=t['grpc-message']});req.on('data',c=>chunks.push(c));req.on('error',e=>done(reject,Error('Speech provider request failed: '+e.message)));
    req.on('end',()=>{if(String(status)!=='0')return done(reject,Error('Speech provider failed (gRPC status '+(status??'none, HTTP '+httpStatus)+(detail?': '+decodeURIComponent(detail):'')+').'));const body=Buffer.concat(chunks);let text='';
      try{for(let i=0;i+5<=body.length;){const len=body.readUInt32BE(i+1);for(const [n,w,v] of decode(body.subarray(i+5,i+5+len)))if(n===1&&w===2){const alt=decode(v).find(([an,aw])=>an===1&&aw===2);const transcript=alt&&decode(alt[2]).find(([tn,tw])=>tn===1&&tw===2);if(transcript)text+=transcript[2].toString('utf8')}i+=5+len}}catch(e){return done(reject,Error('Speech provider returned an unreadable response.'))}
      done(resolve,text.trim())});
    req.end(Buffer.concat([frame,message]))});
}
