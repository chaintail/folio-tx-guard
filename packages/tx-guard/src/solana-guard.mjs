// What a sponsored Solana trade leg may contain before the YEET fee payer co-signs it and before the signing page shows
// it to the person. Ported from the YEET trade server (which adapted Folio's sponsorship check).
//
// The rules: the program allowlist is ComputeBudget, Associated Token, Token and Token-2022 only; no System
// instruction; no lookup table; exactly two signers, the fee payer first and the person second; per leg at most one
// CreateIdempotent and it must create the token account of that leg's deposit address; per leg exactly one
// TransferChecked pinned to source, destination, authority, mint, amount and decimals; no other token instruction; a
// compute budget under fixed caps. A basket (several legs, one transaction, one signature by the person) is the same
// rules leg after leg, positionally (assertSponsorableBasket).
import {createHash} from 'node:crypto';
import {decodeTransaction,resolvedInstructions,associatedTokenAddress,COMPUTE_BUDGET_PROGRAM,ATA_PROGRAM,TOKEN_PROGRAM,TOKEN_2022_PROGRAM,
 SYSTEM_PROGRAM,MAX_TRANSACTION_BYTES,TOKEN_ACCOUNT_RENT_LAMPORTS} from './solana-wire.mjs';

// ---- where the fee payer (account 0) may appear ----
// The fee payer pays rent only for the token account of the leg's 1Click deposit address for the leg's mint: owner
// must be the deposit address, mint the leg's mint, and the fee payer may appear in no other position.

/** CreateIdempotent account positions: payer, ata, owner, mint, system program, token program. */
export const ATA_CREATE_POSITIONS=Object.freeze({payer:0,ata:1,owner:2,mint:3,system:4,tokenProgram:5});

/** True for the ATA program's CreateIdempotent (data exactly [1]). */
export const isCreateIdempotent=(program,data)=>program===ATA_PROGRAM&&data?.length===1&&data[0]===1;

/**
 * `accounts` are the instruction's resolved addresses. Allowed only when it is CreateIdempotent with 6 accounts, the fee
 * payer exactly at the payer position and nowhere else, owner == `depositOwner`, mint == `mint`, and the token program
 * one of the two SPL token programs.
 */
export function depositRentAllowed(program,data,accounts,{feePayer,depositOwner,mint}){
 if(!isCreateIdempotent(program,data)||accounts.length!==6)return false;
 const p=ATA_CREATE_POSITIONS;
 return accounts[p.payer]===feePayer&&accounts[p.owner]===depositOwner&&accounts[p.mint]===mint
  &&[TOKEN_PROGRAM,TOKEN_2022_PROGRAM].includes(accounts[p.tokenProgram])
  &&accounts.every((a,i)=>a!==feePayer||i===p.payer);
}

const MESSAGES={
 SPONSOR_TRANSACTION_UNREADABLE:'This transaction could not be read · nothing was signed',
 SPONSOR_INSTRUCTION_REFUSED:'This transaction asks the fee sponsor for more than a fee · nothing was signed',
 SPONSOR_CLOSE_ACCOUNT_REFUSED:'This transaction closes a token account · YEET does not sponsor that',
 SPONSOR_TRANSFER_MISMATCH:'This transaction is not the transfer this trade quoted · nothing was signed',
 SPONSOR_SIGNERS_MISMATCH:'This transaction is not signed by your wallet and the YEET fee payer',
 CLIENT_FEE_CAP_EXCEEDED:'This transaction exceeds the sponsored fee limit',
};
export class SponsorshipRefusal extends Error{
 constructor(reason,scope){super(MESSAGES[reason]??reason);this.name='SponsorshipRefusal';this.reason=reason;this.code=reason;if(scope)this.scope=scope}
}
const refuse=(reason,scope)=>{throw new SponsorshipRefusal(reason,scope)};

export const LAMPORTS_PER_SIGNATURE=5000;
export const SPONSORED_MAX_COMPUTE_LIMIT=1_400_000;
export const SPONSORED_MAX_PRIORITY_MICRO_LAMPORTS=50_000n;
export const SPONSORED_MAX_FEE_LAMPORTS=80_000;
const CLOSE_ACCOUNT=9,TRANSFER_CHECKED=12;
const REFUSED_TOKEN_TAGS=new Set([4/* Approve */,6/* SetAuthority */,13/* ApproveChecked */]);
const ALLOWED_PROGRAMS=new Set([COMPUTE_BUDGET_PROGRAM,ATA_PROGRAM,TOKEN_PROGRAM,TOKEN_2022_PROGRAM]);
const TOKEN_PROGRAMS=new Set([TOKEN_PROGRAM,TOKEN_2022_PROGRAM]);

/** Base fee for both signatures plus compute_limit x price / 1e6, rounded up. */
export function estimateSponsoredFeeLamports({compute_limit,priority_micro_lamports},signatures=2){
 const priority=(BigInt(compute_limit)*BigInt(priority_micro_lamports)+999_999n)/1_000_000n;
 return signatures*LAMPORTS_PER_SIGNATURE+Number(priority);
}
/** SHA-256 of the exact bytes (hex): the same transaction retried is the same send. */
export const sponsoredSendKey=bytes=>createHash('sha256').update(bytes).digest('hex');

const u64le=d=>Buffer.from(d.subarray(1,9)).readBigUInt64LE(0);

/**
 * The compute budget: instruction 0 SetComputeUnitLimit, instruction 1
 * SetComputeUnitPrice, no other compute-budget instruction, neither with accounts; limit in (0, 1.4M], price at most
 * 50,000 micro-lamports, total fee at most `maxFeeLamports`. Returns the fee in lamports.
 */
export function sponsoredFee(message,{maxFeeLamports=SPONSORED_MAX_FEE_LAMPORTS}={}){
 const ixs=resolvedInstructions(message);
 const cb=ixs.filter(ix=>ix.program===COMPUTE_BUDGET_PROGRAM).length;
 const [lim,price]=ixs;
 if(cb!==2||lim?.program!==COMPUTE_BUDGET_PROGRAM||price?.program!==COMPUTE_BUDGET_PROGRAM||lim.accounts.length||price.accounts.length
  ||lim.data.length!==5||lim.data[0]!==2||price.data.length!==9||price.data[0]!==3)refuse('CLIENT_FEE_CAP_EXCEEDED');
 const limit=Buffer.from(lim.data.subarray(1)).readUInt32LE(0),micro=u64le(price.data);
 if(limit<=0||limit>SPONSORED_MAX_COMPUTE_LIMIT||micro>SPONSORED_MAX_PRIORITY_MICRO_LAMPORTS)refuse('CLIENT_FEE_CAP_EXCEEDED');
 const lamports=estimateSponsoredFeeLamports({compute_limit:limit,priority_micro_lamports:micro});
 if(lamports>maxFeeLamports)refuse('CLIENT_FEE_CAP_EXCEEDED');
 return {lamports,computeLimit:limit,priorityMicroLamports:micro};
}

/**
 * Refuses a transaction the fee payer will not co-sign. `pin` is what the stored leg allows:
 * {feePayer, wallet, depositOwner, mint, tokenProgram, amount (bigint|string), decimals, maxFeeLamports?}.
 * Returns {feeLamports, createsDepositAccount, rentLamports, source, destination}.
 */
export function assertSponsorable(bytes,pin){
 const r=assertSponsorableBasket(bytes,[pin],{maxFeeLamports:pin.maxFeeLamports});
 return {feeLamports:r.feeLamports,createsDepositAccount:r.creates[0],rentLamports:r.rentLamports,source:r.legs[0].source,destination:r.legs[0].destination};
}

/**
 * The basket form (one transaction paying several legs, the person signs once). `pins` are the stored legs in the
 * attempt's order, all with the same fee payer and wallet. The instruction list must be EXACTLY: SetComputeUnitLimit,
 * SetComputeUnitPrice, then for each pin in order an optional CreateIdempotent of that pin's deposit token account and
 * exactly one TransferChecked of that pin. The walk is positional: a reordered leg, a missing transfer, a second
 * create, a create without its transfer or any extra instruction is refused. Destinations are pairwise distinct; every
 * account of the message is referenced by an instruction (no stray account); account 0 only at a create's payer slot.
 * Returns {feeLamports, creates:[bool], rentAccounts, rentLamports, legs:[{source, destination}]}.
 */
export function assertSponsorableBasket(bytes,pins,{maxFeeLamports}={}){
 if(!Array.isArray(pins)||!pins.length)refuse('SPONSOR_TRANSFER_MISMATCH');
 let tx;
 try{tx=decodeTransaction(bytes)}catch{refuse('SPONSOR_TRANSACTION_UNREADABLE')}
 if(bytes.length>MAX_TRANSACTION_BYTES)refuse('SPONSOR_TRANSACTION_UNREADABLE');
 const m=tx.message,[first]=pins;
 if(m.lookups.length)refuse('SPONSOR_INSTRUCTION_REFUSED');
 if(m.header.signers!==2||m.accounts[0]!==first.feePayer||m.accounts[1]!==first.wallet||first.feePayer===first.wallet
  ||pins.some(p=>p.feePayer!==first.feePayer||p.wallet!==first.wallet))refuse('SPONSOR_SIGNERS_MISMATCH');
 const fee=sponsoredFee(m,{maxFeeLamports});
 const legs=pins.map(p=>({source:associatedTokenAddress(p.wallet,p.mint,p.tokenProgram),destination:associatedTokenAddress(p.depositOwner,p.mint,p.tokenProgram)}));
 if(new Set(legs.map(l=>l.destination)).size!==legs.length)refuse('SPONSOR_TRANSFER_MISMATCH');
 const ixs=resolvedInstructions(m);
 // Pass 1, per instruction (today's rules): allowlisted static programs, no System instruction, account 0 only at a
 // verified rent position of one of the pins, CreateIdempotent only, TransferChecked as the only token instruction.
 for(const ix of ixs){
  if(ix.program===null||!ALLOWED_PROGRAMS.has(ix.program)||ix.program===SYSTEM_PROGRAM)refuse('SPONSOR_INSTRUCTION_REFUSED');
  if(ix.program===COMPUTE_BUDGET_PROGRAM)continue;
  // No instruction may name account 0 as its program or reference it outside a verified rent position.
  if(ix.indices.includes(0)&&!pins.some(p=>depositRentAllowed(ix.program,ix.data,ix.accounts,{feePayer:p.feePayer,depositOwner:p.depositOwner,mint:p.mint})))refuse('SPONSOR_INSTRUCTION_REFUSED');
  if(ix.program===ATA_PROGRAM){
   if(!isCreateIdempotent(ix.program,ix.data)||!ix.indices.includes(0))refuse('SPONSOR_INSTRUCTION_REFUSED');
   continue;
  }
  const tag=ix.data[0];
  if(tag===CLOSE_ACCOUNT)refuse('SPONSOR_CLOSE_ACCOUNT_REFUSED');
  if(REFUSED_TOKEN_TAGS.has(tag)||tag!==TRANSFER_CHECKED)refuse('SPONSOR_INSTRUCTION_REFUSED');
 }
 // Pass 2, positional: [limit, price] then, per pin in order, create? + transfer.
 const P=ATA_CREATE_POSITIONS,creates=[];
 let i=2;
 for(const [k,p] of pins.entries()){
  const {source,destination}=legs[k];
  let ix=ixs[i];
  creates[k]=false;
  if(ix?.program===ATA_PROGRAM){
   // Pass 1 proved it is a rent position of SOME pin; here it must be this leg's (else the legs are out of order).
   if(!depositRentAllowed(ix.program,ix.data,ix.accounts,{feePayer:p.feePayer,depositOwner:p.depositOwner,mint:p.mint}))refuse('SPONSOR_TRANSFER_MISMATCH');
   if(ix.accounts[P.ata]!==destination||ix.accounts[P.tokenProgram]!==p.tokenProgram)refuse('SPONSOR_TRANSFER_MISMATCH');
   creates[k]=true;ix=ixs[++i];
  }
  if(!ix||!TOKEN_PROGRAMS.has(ix.program))refuse('SPONSOR_TRANSFER_MISMATCH');
  if(ix.program!==p.tokenProgram||ix.data.length!==10||ix.accounts.length!==4)refuse('SPONSOR_TRANSFER_MISMATCH');
  const [src,mint,dst,authority]=ix.accounts;
  if(src!==source||mint!==p.mint||dst!==destination||authority!==p.wallet||u64le(ix.data)!==BigInt(p.amount)||ix.data[9]!==p.decimals)refuse('SPONSOR_TRANSFER_MISMATCH');
  i++;
 }
 if(i!==ixs.length)refuse('SPONSOR_TRANSFER_MISMATCH');
 // No stray account: every account but the fee payer is named by an instruction (as an account or its program).
 const named=new Set(m.instructions.flatMap(ix=>[ix.programIndex,...ix.accounts]));
 if(m.accounts.some((_,idx)=>idx!==0&&!named.has(idx)))refuse('SPONSOR_INSTRUCTION_REFUSED');
 const rentAccounts=creates.filter(Boolean).length;
 return {feeLamports:fee.lamports,creates,rentAccounts,rentLamports:rentAccounts*TOKEN_ACCOUNT_RENT_LAMPORTS,legs};
}

