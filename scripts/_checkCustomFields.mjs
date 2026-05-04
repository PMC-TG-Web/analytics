import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

try {
  // Check customFields on commitment contracts for Memory Care
  const contracts = await prisma.$queryRawUnsafe(`
    SELECT id, "procoreId", title, number, value, "originalValue", "customFields"
    FROM "CommitmentContract"
    WHERE "procoreProjectId" = $1
  `, '598134326371113');

  process.stdout.write('Contracts: ' + contracts.length + '\n');
  for (const c of contracts) {
    process.stdout.write('\n' + c.number + ' | ' + c.title + '\n');
    process.stdout.write('  value: ' + c.value + ', originalValue: ' + c.originalValue + '\n');
    const cf = c.customFields;
    if (cf && Object.keys(cf).length > 0) {
      process.stdout.write('  customFields: ' + JSON.stringify(cf, null, 2) + '\n');
    } else {
      process.stdout.write('  customFields: (empty)\n');
    }
  }

  // Print full customFields for MCMB-001 to see what's stored
  process.stdout.write('\nFull customFields on MCMB-001:\n');
  process.stdout.write(JSON.stringify(contracts[0]?.customFields, null, 2) + '\n');

  // Query unpacked fields using correct column names
  const unpacked = await prisma.$queryRawUnsafe(`
    SELECT u.field_path, u.value_type, u.value_text, u.value_number, u.value_json, c.number, c.title
    FROM commitment_contract_unpacked_fields u
    JOIN "CommitmentContract" c ON c.id = u.contract_id
    WHERE c."procoreProjectId" = $1
    ORDER BY c.number, u.field_path
  `, '598134326371113');

  process.stdout.write('\nUnpacked fields for Memory Care contracts (' + unpacked.length + '):\n');
  for (const u of unpacked) {
    const val = u.value_json ?? u.value_text ?? u.value_number;
    process.stdout.write('  ' + u.number + ' | ' + u.field_path + ' = ' + JSON.stringify(val) + '\n');
  }

} catch(e) {
  process.stdout.write('ERROR: ' + e.message + '\n');
}
await prisma.$disconnect();
