export type BillItemGroup = {sourceKeys: string[]; quantity: string; unitCost: string; amount: string};

/** Render the exact host groups while retaining source rows for setup and audit. */
export function billDisplayLines<T extends {lineKey:string;quantity:string;unitCost:string;amount:string}>(lines:T[], groups?:BillItemGroup[]|null, preservedKeys: string[] = []): (T & {sourceKeys:string[]})[] {
 const fallback=()=>lines.map(line=>({...line,sourceKeys:[line.lineKey]}));
 if(!groups)return fallback();
 const byKey=new Map(lines.map(line=>[line.lineKey,line]));
 const keys=groups.flatMap(group=>group.sourceKeys);
 const preserved=new Set(preservedKeys.filter(key=>byKey.has(key)));
 if(keys.length+preserved.size!==lines.length || new Set(keys).size!==keys.length || keys.some(key=>!byKey.has(key) || preserved.has(key)))return fallback();
 return groups.map(group=>({...byKey.get(group.sourceKeys[0])!,...group}));
}
