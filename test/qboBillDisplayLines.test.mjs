import test from 'node:test';
import assert from 'node:assert/strict';
import {billDisplayLines} from '../src/lib/qboBillDisplayLines.ts';
test('host aggregation drives displayed quantities without discarding original source rows',()=>{
 const rows=[{lineKey:'a',quantity:'13',unitCost:'22.88724',amount:'297.53'},{lineKey:'b',quantity:'8',unitCost:'22.88724',amount:'183.10'}];
 const grouped=billDisplayLines(rows,[{sourceKeys:['a','b'],quantity:'21',unitCost:'22.88724',amount:'480.63'}]);
 assert.equal(grouped.length,1);assert.equal(grouped[0].quantity,'21');assert.deepEqual(grouped[0].sourceKeys,['a','b']);assert.equal(rows.length,2);assert.equal(rows[0].quantity,'13');
 assert.equal(billDisplayLines(rows,[{sourceKeys:['a'],quantity:'13',unitCost:'22.88724',amount:'297.53'}]).length,2);
});
