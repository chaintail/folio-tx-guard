// The Base side: one EIP-7702 batch of USDC transfers the person signs (Uniswap Calibur v1.1.0 SignedBatchedCall).
// Before the signing page shows the batch, it is rebuilt from the stored legs and compared field by field, so a
// batch with another recipient, another amount, an extra call, a call with value, another key, an open executor or no
// deadline is refused. Ported from the YEET trade server. Pure: no RPC, no key material. Addresses are compared
// lower-case; checksum (EIP-55) validation is left to the caller's EVM library.

export const BASE_CHAIN_ID=8453;
export const USDC_BASE='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
/** ERC-20 transfer(address,uint256). */
export const TRANSFER_SELECTOR='0xa9059cbb';
export const ROOT_KEY_HASH='0x'+'00'.repeat(32);
export const ZERO_ADDRESS='0x'+'00'.repeat(20);
export const MAX_LEGS_7702=8;

export class BatchRefusal extends Error{constructor(reason,detail){super(detail??reason);this.name='BatchRefusal';this.reason=reason}}
const refuse=(reason,detail)=>{throw new BatchRefusal(reason,detail)};

const ADDR=/^0x[0-9a-fA-F]{40}$/;
const U256=2n**256n;
const lc=a=>String(a).toLowerCase();
const addr=(a,what)=>{if(!ADDR.test(String(a)))refuse('BATCH_INVALID',`${what}: not an address`);return lc(a)};

/** Calldata of USDC.transfer(to, amount). */
export function transferData(to,amount){
 const a=addr(to,'recipient');
 if(typeof amount!=='bigint'||amount<=0n||amount>=U256)refuse('BATCH_INVALID','transfer amount');
 return TRANSFER_SELECTOR+a.slice(2).padStart(64,'0')+amount.toString(16).padStart(64,'0');
}

/** Calibur nonce: (uint192 key << 64) | uint64 seq. */
export function batchNonce(key,seq=0n){
 const k=BigInt(key),s=BigInt(seq);
 if(k<0n||k>=1n<<192n||s<0n||s>=1n<<64n)refuse('BATCH_INVALID','nonce key/seq out of range');
 return (k<<64n)|s;
}

/**
 * The SignedBatchedCall for N USDC transfers: root key, revertOnFailure true, executor = the YEET gas wallet (never
 * 0, which would let anyone execute it), deadline set (0 never expires), 1..8 legs, every amount positive.
 * `legs` are [{to, amountRaw}], `to` being each leg's 1Click deposit address.
 */
export function buildBatch({legs,nonce,executor,deadline}){
 if(!Array.isArray(legs)||legs.length<1||legs.length>MAX_LEGS_7702)refuse('BATCH_INVALID','legs: 1..'+MAX_LEGS_7702);
 const ex=addr(executor,'executor');
 if(ex===ZERO_ADDRESS)refuse('BATCH_INVALID','executor 0 lets anyone execute');
 const d=BigInt(deadline);
 if(d<=0n)refuse('BATCH_INVALID','deadline 0 never expires');
 return {
  batchedCall:{calls:legs.map(({to,amountRaw})=>{
   const a=BigInt(amountRaw);if(a<=0n)refuse('BATCH_INVALID','amount must be positive');
   return {to:USDC_BASE,value:0n,data:transferData(to,a)}}),revertOnFailure:true},
  nonce:BigInt(nonce),keyHash:ROOT_KEY_HASH,executor:ex,deadline:d,
 };
}

/**
 * Refuses a batch that is not exactly the one `expected` ({legs, nonce, executor, deadline}) builds. Returns the
 * rebuilt batch. Signer recovery over the EIP-712 digest is the caller's (it needs secp256k1).
 */
export function assertBatchMatches(batch,expected){
 const e=buildBatch(expected);
 const c=batch?.batchedCall?.calls;
 if(!Array.isArray(c)||c.length!==e.batchedCall.calls.length)refuse('BATCH_MISMATCH','batch leg count');
 c.forEach((x,i)=>{const y=e.batchedCall.calls[i];
  let value;try{value=BigInt(x?.value)}catch{value=-1n}
  if(lc(x?.to)!==lc(y.to)||value!==0n||lc(x?.data)!==lc(y.data))refuse('BATCH_MISMATCH',`batch leg ${i} differs`)});
 if(batch.batchedCall.revertOnFailure!==true)refuse('BATCH_MISMATCH','revertOnFailure must be true');
 if(lc(batch.keyHash)!==ROOT_KEY_HASH)refuse('BATCH_MISMATCH','keyHash must be the root key');
 if(lc(batch.executor)!==e.executor)refuse('BATCH_MISMATCH','executor must be the YEET gas wallet');
 let nonce,deadline;try{nonce=BigInt(batch.nonce);deadline=BigInt(batch.deadline)}catch{refuse('BATCH_MISMATCH','nonce/deadline')}
 if(nonce!==e.nonce||deadline!==e.deadline)refuse('BATCH_MISMATCH','nonce/deadline');
 return e;
}
