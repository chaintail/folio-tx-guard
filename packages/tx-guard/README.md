# folio-tx-guard

The checks a prepared trade passes before anything is signed. The YEET server runs them before the YEET fee payer
co-signs a Solana transaction and before the signing page shows a transaction to the person. Every check compares the
prepared bytes with what was stored when the trade was quoted. When anything differs, the check throws and nothing is
signed.

Plain JavaScript on Node 24, no dependencies, no network calls, no keys read from disk. Ported from the YEET trade
server together with its tests.

## Run it

```sh
npm test -w folio-tx-guard        # 32 tests
npm run example -w folio-tx-guard
```

The example builds one sponsored Solana leg (5 USDC to a 1Click deposit address), checks it, then checks the same leg
with the amount raised by one unit:

```
accepted: fee 11600 lamports, creates deposit account true
refused: SPONSOR_TRANSFER_MISMATCH (This transaction is not the transfer this trade quoted · nothing was signed)
```

Using it from code:

```js
import {assertSponsorableBasket, SponsorshipRefusal} from 'folio-tx-guard';

// pins: the stored legs, in order. Each is
// {feePayer, wallet, depositOwner, mint, tokenProgram, amount, decimals}
try {
  const r = assertSponsorableBasket(transactionBytes, pins, {maxFeeLamports: 80_000});
  // r.feeLamports, r.creates, r.rentLamports, r.legs[i].source / .destination
} catch (e) {
  if (e instanceof SponsorshipRefusal) console.log(e.reason);
  else throw e;
}
```

## Solana: the sponsored leg (`src/solana-guard.mjs`)

YEET pays the network fee of a Solana trade, so the person needs no SOL. The fee payer is account 0 of the
transaction and co-signs it. The rules below keep that signature from paying for anything except the quoted transfer.

| Refusal | What it refuses | Why |
|---|---|---|
| `SPONSOR_TRANSACTION_UNREADABLE` | Bytes the strict reader cannot read back to the same bytes: trailing bytes, non-canonical lengths, an index out of range, more than 1232 bytes | Every other check must look at exactly what the wallet will sign. Two readings of the same bytes must not exist |
| `SPONSOR_SIGNERS_MISMATCH` | A signer count other than 2, a fee payer other than the stored one in slot 0, a wallet other than the person's in slot 1, or legs that disagree on either | One signature by the person, one by the fee payer, nobody else |
| `SPONSOR_INSTRUCTION_REFUSED` | A program outside ComputeBudget, Associated Token, Token and Token-2022; any System instruction; an address lookup table; the fee payer named anywhere except the payer slot of an allowed account creation; an Associated Token instruction other than CreateIdempotent, or a CreateIdempotent paid by the fee payer for an owner other than a leg's deposit address or a mint other than that leg's; an account that no instruction names | The fee payer's lamports must not leave through a System transfer, rent for an account of the attacker's choosing, or an account hidden behind a lookup table |
| `SPONSOR_CLOSE_ACCOUNT_REFUSED` | A token CloseAccount | Closing an account sends its rent somewhere else |
| `SPONSOR_INSTRUCTION_REFUSED` (token) | Approve, ApproveChecked, SetAuthority, Transfer, or any token instruction except TransferChecked | A delegate or a new authority outlives the trade. TransferChecked also pins the mint and decimals |
| `SPONSOR_TRANSFER_MISMATCH` | Per leg, in order: anything but an optional create of that leg's deposit token account followed by exactly one TransferChecked from the person's token account to that deposit token account, with the stored mint, amount, decimals, token program and the person as authority. Also refused: a reordered leg, a missing or second transfer, a second create, two legs with the same destination, an instruction after the last leg | The person signs the transfer that was quoted, to the deposit address 1Click gave for that quote, and nothing else |
| `CLIENT_FEE_CAP_EXCEEDED` | Compute-budget instructions that are not exactly SetComputeUnitLimit then SetComputeUnitPrice at the start; a limit of 0 or over 1,400,000 units; a price over 50,000 micro-lamports; a total fee over `maxFeeLamports` (at most 80,000 lamports) | The sponsored fee has a fixed ceiling per transaction |

`sponsoredFee` returns the fee the transaction will cost; `sponsoredSendKey` is the SHA-256 of the exact bytes, so the
same transaction retried is the same send.

## Solana: signatures (`src/solana-signatures.mjs`)

| Check | Refuses | Why |
|---|---|---|
| `verifySolanaPartialTransaction(original, partial, wallet)` | A partial transaction whose message differs from the stored one, that does not have exactly two signers with the person in slot 1, whose fee-payer slot is already filled, whose stored original was not unsigned, or whose person signature is not a valid Ed25519 signature over the message | The person's wallet signs first. The server checks that this signature is over the bytes it prepared before the fee payer adds its own |
| `verifySolanaSignedTransaction(original, signed, wallet)` | A changed message, `wallet` missing from the signers, any signature already present in the original replaced, or any signature slot invalid. Returns null and reports the reason (`message_changed`, `signer_missing`, `preserved_signature_changed`, `signature_invalid`, `wire_encoding`) | The fully signed transaction is the one that was checked, with the person's signature unchanged |

## Base: the 7702 batch (`src/evm-batch.mjs`)

On Base the person signs one EIP-7702 batch (Uniswap Calibur `SignedBatchedCall`) that holds every leg's USDC transfer.
`assertBatchMatches(batch, {legs, nonce, executor, deadline})` rebuilds the batch from the stored legs and refuses
(`BatchRefusal`, reason `BATCH_MISMATCH`) a batch with:

- a different number of calls, or a call to a contract other than USDC on Base
- a call that carries ETH value, or calldata other than `transfer(depositAddress, amount)` for that leg
- `revertOnFailure` false, so that some legs could pay while others fail
- a key other than the root key, an executor other than the YEET gas wallet, another nonce or another deadline

`buildBatch` itself refuses (`BATCH_INVALID`) executor 0 (anyone could execute the batch), deadline 0 (it would never
expire), fewer than 1 or more than 8 legs, and an amount that is not positive.

## NEAR Intents: the deposit request (`src/intent-request.mjs`)

| Check | Refuses | Why |
|---|---|---|
| `requestIsOurs(account, request)` | A 1Click deposit set request whose recipient or refund is not `account`, whose recipient, refund or deposit type is not `INTENTS`, with another swap type, other asset ids, another deadline, or any app fee | A deposit address the person funds must credit their own intents account and refund to it. No third party takes a cut on the way |
| `setFor(account, set)` | A listed set with another recipient or refund account, other asset ids, no chain deposit addresses or more than 200, or an internal address that is missing or longer than 128 characters | A set is shown only when it belongs to the person |
| `slippageBps(value)` | Anything but a whole number from 50 to 300 basis points (unset is 100) | A trade cannot accept a fill more than 3% below its quote |

## Not in this package

These checks run on the YEET server but are not here, because they depend on code outside this package:

- signer recovery for the Base batch (EIP-712) and for the 7702 authorization, and the signed type-2 transfer check
  (low-s, canonical re-encoding), all of which need a secp256k1 library
- the fee-payer wallet policy, the daily sponsorship budgets and the tier caps, which are server configuration
- the NEAR Intents simulation before settlement, which calls the verifier contract over RPC

## Licence

All rights reserved, Chaintail Labs Inc. Hackathon judges may read, build and run it to evaluate it. See
[LICENSE](LICENSE).
