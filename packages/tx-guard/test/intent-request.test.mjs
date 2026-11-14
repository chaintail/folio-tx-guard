// The deposit set request and the slippage bounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setRequest,requestIsOurs,setFor,slippageBps,IntentRefusal,ANY_ASSET,SAME_ASSET} from '../src/intent-request.mjs';

const ME='a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9',OTHER='attacker.near';

test('the request a set is made with is ours; recipient or refund elsewhere is not',()=>{
 const r=setRequest(ME);
 assert.equal(requestIsOurs(ME,r),true);
 assert.equal(requestIsOurs(ME,{...r,recipient:OTHER}),false);
 assert.equal(requestIsOurs(ME,{...r,refundTo:OTHER}),false);
 assert.equal(requestIsOurs(OTHER,r),false);
 for(const k of ['recipientType','refundType','depositType'])assert.equal(requestIsOurs(ME,{...r,[k]:'ORIGIN_CHAIN'}),false,k);
 assert.equal(requestIsOurs(ME,{...r,swapType:'EXACT_INPUT'}),false);
 assert.equal(requestIsOurs(ME,{...r,destinationAsset:'nep141:wrap.near'}),false);
 assert.equal(requestIsOurs(ME,{...r,deadline:'2030-01-01T00:00:00.000Z'}),false);
 assert.equal(requestIsOurs(ME,{...r,appFees:[{recipient:OTHER,fee:100}]}),false);
 assert.equal(requestIsOurs(ME,{...r,appFees:[]}),true);
 assert.equal(requestIsOurs(ME,null),false);
 // No account: nothing matches, not even a request without recipient and refund.
 const {recipient:_r,refundTo:_f,...bare}=r;
 assert.equal(requestIsOurs(undefined,bare),false);
});
test('a listed set is kept only when it pays and refunds to the account',()=>{
 const set={recipient:ME,refundTo:ME,originAsset:ANY_ASSET,destinationAsset:SAME_ASSET,chainDepositAddresses:[{chain:'sol',address:'x'}],depositAddress:'d'.repeat(64),correlationId:'c'.repeat(100)};
 const s=setFor(ME,set);
 assert.equal(s.internal,'d'.repeat(64));assert.equal(s.correlationId.length,80);assert.equal(s.createdAt,null);
 assert.equal(setFor(ME,{...set,recipient:OTHER}),null);
 assert.equal(setFor(ME,{...set,refundTo:OTHER}),null);
 assert.equal(setFor(ME,{...set,originAsset:'nep141:usdc'}),null);
 assert.equal(setFor(ME,{...set,chainDepositAddresses:[]}),null);
 assert.equal(setFor(ME,{...set,chainDepositAddresses:Array(201).fill({})}),null);
 assert.equal(setFor(ME,{...set,depositAddress:'d'.repeat(129)}),null);
 assert.equal(setFor('',{...set,recipient:'',refundTo:''}),null);
});
test('slippage: default 100, whole numbers in 50..300 only',()=>{
 assert.equal(slippageBps(undefined),100);assert.equal(slippageBps(null),100);
 assert.equal(slippageBps(50),50);assert.equal(slippageBps(300),300);
 for(const bad of [49,301,1000,0,-1,100.5,'100',NaN])assert.throws(()=>slippageBps(bad),e=>e instanceof IntentRefusal&&e.reason==='SLIPPAGE_OUT_OF_BOUNDS',String(bad));
});
