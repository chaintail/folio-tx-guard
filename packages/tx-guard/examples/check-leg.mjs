// Run: npm run example -w folio-tx-guard
// Builds one sponsored Solana leg (5 USDC to a deposit address), checks it, then changes the amount by one unit.
import {createHash} from 'node:crypto';
import {base58Encode,buildMessage,associatedTokenAddress,createAssociatedTokenIdempotent,transferChecked,assertSponsorable,
 SponsorshipRefusal,USDC_SOLANA,TOKEN_PROGRAM} from '../src/index.mjs';

const address=label=>base58Encode(createHash('sha256').update(label).digest());
const leg={feePayer:address('fee payer'),wallet:address('person'),depositOwner:address('deposit'),mint:USDC_SOLANA,tokenProgram:TOKEN_PROGRAM,amount:5_000_000n,decimals:6};

function legTransaction(amount){
 const ata=associatedTokenAddress(leg.depositOwner,leg.mint);
 return buildMessage({feePayer:leg.feePayer,owner:leg.wallet,blockhash:address('blockhash'),computeUnitLimit:80_000,priorityMicroLamports:20_000n,instructions:[
  createAssociatedTokenIdempotent({payer:leg.feePayer,ata,owner:leg.depositOwner,mint:leg.mint,tokenProgram:TOKEN_PROGRAM}),
  transferChecked({source:associatedTokenAddress(leg.wallet,leg.mint),mint:leg.mint,destination:ata,authority:leg.wallet,amount,decimals:6,tokenProgram:TOKEN_PROGRAM})]}).bytes;
}

const ok=assertSponsorable(legTransaction(5_000_000n),leg);
console.log(`accepted: fee ${ok.feeLamports} lamports, creates deposit account ${ok.createsDepositAccount}`);
try{assertSponsorable(legTransaction(5_000_001n),leg)}
catch(e){if(!(e instanceof SponsorshipRefusal))throw e;console.log(`refused: ${e.reason} (${e.message})`)}
