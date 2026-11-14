// The NEAR Intents side, before any deposit address is shown: a 1Click deposit set must pay into the person's own
// intents account and refund to that same account, and the slippage a trade asks for must sit inside fixed bounds.
// Ported from the YEET trade server (ledger deposit sets and trade proposals). Pure: no 1Click call.

/** 1Click asset ids of a reusable deposit set: any input asset in, the same asset credited. */
export const ANY_ASSET='1cs_v1:any',SAME_ASSET='1cs_v1:original';
/** The fixed deadline a reusable set is created with. */
export const SET_DEADLINE='2038-01-01T00:00:00.000Z';
export const MIN_SLIPPAGE_BPS=50,MAX_SLIPPAGE_BPS=300,DEFAULT_SLIPPAGE_BPS=100;

export class IntentRefusal extends Error{constructor(reason,detail){super(detail??reason);this.name='IntentRefusal';this.reason=reason}}

/** The one request a deposit set is made with. `account` is the person's own intents account, on both sides. */
export const setRequest=account=>({dry:false,swapType:'ANY_INPUT',originAsset:ANY_ASSET,depositType:'INTENTS',destinationAsset:SAME_ASSET,amount:'0',slippageTolerance:50,
 recipient:account,recipientType:'INTENTS',refundTo:account,refundType:'INTENTS',deadline:SET_DEADLINE});

/**
 * True only for the request this route makes, for `account`: ANY_INPUT, any asset in and the same asset out,
 * recipient and refund both `account` inside intents, the fixed deadline, and no app fee taken on the way.
 */
export const requestIsOurs=(account,r)=>!!r&&typeof account==='string'&&account.length>0&&r.swapType==='ANY_INPUT'&&r.originAsset===ANY_ASSET&&r.destinationAsset===SAME_ASSET
 &&r.recipient===account&&r.refundTo===account&&r.recipientType==='INTENTS'&&r.refundType==='INTENTS'&&r.depositType==='INTENTS'&&r.deadline===SET_DEADLINE
 &&(!Array.isArray(r.appFees)||!r.appFees.length);

/**
 * A listed or created set reduced to one shape when it is a reusable set for exactly `account`, else null: recipient
 * and refund `account`, the two set asset ids, 1..200 chain deposit addresses and one internal address.
 */
export function setFor(account,{recipient,refundTo,originAsset,destinationAsset,chainDepositAddresses,depositAddress,correlationId,createdAt}={}){
 if(typeof account!=='string'||!account||recipient!==account||refundTo!==account||originAsset!==ANY_ASSET||destinationAsset!==SAME_ASSET)return null;
 if(!Array.isArray(chainDepositAddresses)||!chainDepositAddresses.length||chainDepositAddresses.length>200||typeof depositAddress!=='string'||!depositAddress||depositAddress.length>128)return null;
 return {recipient,refundTo,addresses:chainDepositAddresses,internal:depositAddress,correlationId:typeof correlationId==='string'?correlationId.slice(0,80):null,createdAt:createdAt??null};
}

/** Slippage in basis points: unset is 100; anything but a whole number in 50..300 is refused. */
export function slippageBps(s){
 if(s===undefined||s===null)return DEFAULT_SLIPPAGE_BPS;
 if(!Number.isInteger(s)||s<MIN_SLIPPAGE_BPS||s>MAX_SLIPPAGE_BPS)throw new IntentRefusal('SLIPPAGE_OUT_OF_BOUNDS',`slippage must be a whole number of basis points in ${MIN_SLIPPAGE_BPS}..${MAX_SLIPPAGE_BPS}`);
 return s;
}
