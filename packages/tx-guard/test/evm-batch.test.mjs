// The Base batch guard: built from the stored legs, any altered field refused. Vectors from the trade server's Calibur
// tests (the addresses are those of fixed test keys 0x11..11 and 0x22..22, never funded).
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBatch,assertBatchMatches,batchNonce,transferData,BatchRefusal,USDC_BASE,ROOT_KEY_HASH,TRANSFER_SELECTOR} from '../src/evm-batch.mjs';

const USER='0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A',GAS='0x1563915e194D8CfBA1943570603F7606A3115508';
const legs=[{to:'0x'+'a1'.repeat(20),amountRaw:10000n},{to:'0x'+'b2'.repeat(20),amountRaw:20000n}];
const spec={legs,nonce:batchNonce(7n,0n),executor:GAS,deadline:1_800_000_000n};
const pad=a=>a.toLowerCase().slice(2).padStart(64,'0');
const refused=(fn,pattern)=>assert.throws(fn,e=>e instanceof BatchRefusal&&pattern.test(e.message),String(pattern));

test('nonce = key << 64 | seq, out-of-range parts refused',()=>{
 assert.equal(batchNonce(7n,3n),(7n<<64n)|3n);
 assert.throws(()=>batchNonce(1n<<192n,0n),BatchRefusal);
 assert.throws(()=>batchNonce(0n,1n<<64n),BatchRefusal);
});
test('batch: USDC transfer calls, root key, revertOnFailure, executor and deadline pinned; refuses unsafe fields',()=>{
 const b=buildBatch(spec);
 assert.equal(b.batchedCall.calls.length,2);
 assert.equal(b.batchedCall.calls[0].to,USDC_BASE);
 assert.equal(b.batchedCall.calls[0].value,0n);
 assert.equal(b.batchedCall.calls[0].data,TRANSFER_SELECTOR+pad(legs[0].to)+(10000n).toString(16).padStart(64,'0'));
 assert.equal(b.batchedCall.revertOnFailure,true);
 assert.equal(b.keyHash,ROOT_KEY_HASH);
 assert.equal(b.executor,GAS.toLowerCase());
 refused(()=>buildBatch({...spec,executor:'0x'+'00'.repeat(20)}),/anyone/);
 refused(()=>buildBatch({...spec,deadline:0n}),/never expires/);
 refused(()=>buildBatch({...spec,legs:Array(9).fill(legs[0])}),/legs/);
 refused(()=>buildBatch({...spec,legs:[]}),/legs/);
 refused(()=>buildBatch({...spec,legs:[{...legs[0],amountRaw:0n}]}),/positive/);
 refused(()=>buildBatch({...spec,legs:[{...legs[0],to:'0x1234'}]}),/recipient/);
});
test('transfer calldata: 0xa9059cbb, padded recipient, padded amount; out-of-range amount refused',()=>{
 assert.equal(transferData(legs[1].to,1n),'0xa9059cbb'+pad(legs[1].to)+'0'.repeat(63)+'1');
 assert.throws(()=>transferData(legs[1].to,0n),BatchRefusal);
 assert.throws(()=>transferData(legs[1].to,2n**256n),BatchRefusal);
 assert.throws(()=>transferData(legs[1].to,5),BatchRefusal);
});
test('server batch validation: rebuilt from the stored legs, any altered field refused',()=>{
 const b=buildBatch(spec);
 assert.doesNotThrow(()=>assertBatchMatches(b,spec));
 // Case of an address does not matter (checksummed or not).
 assert.doesNotThrow(()=>assertBatchMatches({...b,executor:GAS},spec));
 const alt=structuredClone(b);alt.batchedCall.calls[1].data=buildBatch({...spec,legs:[legs[0],{...legs[1],amountRaw:20001n}]}).batchedCall.calls[1].data;
 refused(()=>assertBatchMatches(alt,spec),/leg 1/);
 const redirected=structuredClone(b);redirected.batchedCall.calls[0].data=transferData(USER,10000n);
 refused(()=>assertBatchMatches(redirected,spec),/leg 0/);
 const withValue=structuredClone(b);withValue.batchedCall.calls[0].value=1n;
 refused(()=>assertBatchMatches(withValue,spec),/leg 0/);
 const otherToken=structuredClone(b);otherToken.batchedCall.calls[0].to='0x'+'c3'.repeat(20);
 refused(()=>assertBatchMatches(otherToken,spec),/leg 0/);
 const extra=structuredClone(b);extra.batchedCall.calls.push(b.batchedCall.calls[0]);
 refused(()=>assertBatchMatches(extra,spec),/leg count/);
 refused(()=>assertBatchMatches({...b,executor:USER},spec),/executor/);
 refused(()=>assertBatchMatches({...b,keyHash:'0x'+'01'.repeat(32)},spec),/root key/);
 refused(()=>assertBatchMatches({...b,batchedCall:{...b.batchedCall,revertOnFailure:false}},spec),/revertOnFailure/);
 refused(()=>assertBatchMatches({...b,nonce:b.nonce+1n},spec),/nonce/);
 refused(()=>assertBatchMatches({...b,deadline:0n},spec),/nonce\/deadline/);
 refused(()=>assertBatchMatches({...b,deadline:'not a number'},spec),/nonce\/deadline/);
 refused(()=>assertBatchMatches(null,spec),/leg count/);
});
