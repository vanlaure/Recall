import test from 'node:test';import assert from 'node:assert/strict';import http2 from 'node:http2';import {recognize} from '../lib/riva.mjs';
// Hand-built protobuf helpers, independent of the client's encoder.
const ld=(num,body)=>Buffer.concat([Buffer.from([num*8+2,body.length]),body]);
const grpcFrame=m=>{const f=Buffer.alloc(5+m.length);f.writeUInt32BE(m.length,1);m.copy(f,5);return f};
// Stand-in for the Riva gRPC service over plaintext HTTP/2.
async function mock(reply){let seen;const server=http2.createServer();server.on('stream',(stream,headers)=>{const chunks=[];stream.on('data',c=>chunks.push(c));stream.on('end',()=>{seen={headers,body:Buffer.concat(chunks)};reply(stream)})});await new Promise(r=>server.listen(0,'127.0.0.1',r));return{url:'http://127.0.0.1:'+server.address().port,seen:()=>seen,close:()=>server.close()};}
const wav=Buffer.alloc(44+8);wav.write('RIFF',0);wav.write('WAVEfmt ',8);wav.writeUInt32LE(22050,24);
test('Riva client sends a framed Recognize request and reads the transcript',async()=>{
  const response=ld(1,ld(1,ld(1,Buffer.from('milk and eggs '))));// results[0].alternatives[0].transcript
  const m=await mock(s=>{s.respond({':status':200,'content-type':'application/grpc'},{waitForTrailers:true});s.on('wantTrailers',()=>s.sendTrailers({'grpc-status':'0'}));s.end(grpcFrame(response))});
  try{const text=await recognize({url:m.url,functionId:'fn-1',key:' k ',wav});const {headers,body}=m.seen();
    assert.equal(text,'milk and eggs');assert.equal(headers[':path'],'/nvidia.riva.asr.RivaSpeechRecognition/Recognize');assert.equal(headers['function-id'],'fn-1');assert.equal(headers.authorization,'Bearer k');assert.equal(headers['content-type'],'application/grpc');
    assert.equal(body[0],0);assert.equal(body.readUInt32BE(1),body.length-5);assert.ok(body.includes(wav),'audio bytes are sent unchanged');assert.ok(body.includes(Buffer.from([0x10,0xa2,0xac,0x01])),'sample rate 22050 is read from the WAV header');assert.ok(body.includes(Buffer.from('en-US')));
  }finally{m.close()}});
test('Riva client reports a gRPC error status',async()=>{
  const m=await mock(s=>{s.respond({':status':200,'content-type':'application/grpc','grpc-status':'16','grpc-message':'bad%20key'},{endStream:true})});
  try{await assert.rejects(recognize({url:m.url,functionId:'fn-1',key:'k',wav}),/gRPC status 16: bad key/)}finally{m.close()}});
