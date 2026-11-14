// Base58 (Bitcoin alphabet), the same routine as packages/router/src/address.ts, kept here so this package has no
// dependency.
const ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX=new Map([...ALPHABET].map((c,i)=>[c,i]));

/** Bytes of a base58 string, or null on an empty string or any character outside the alphabet. */
export function base58Decode(input){
 if(typeof input!=='string'||input.length===0)return null;
 let value=0n;
 for(const ch of input){const d=INDEX.get(ch);if(d===undefined)return null;value=value*58n+BigInt(d)}
 const bytes=[];
 while(value>0n){bytes.push(Number(value&0xffn));value>>=8n}
 for(const ch of input){if(ch!=='1')break;bytes.push(0)}
 return Uint8Array.from(bytes.reverse());
}
export function base58Encode(bytes){
 let value=0n;
 for(const b of bytes)value=(value<<8n)|BigInt(b);
 let out='';
 while(value>0n){out=ALPHABET[Number(value%58n)]+out;value/=58n}
 for(const b of bytes){if(b!==0)break;out='1'+out}
 return out;
}
