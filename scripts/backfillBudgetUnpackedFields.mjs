import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function walkPayload(value, path, output) {
  output.push({ field_path: path, raw_value: value });

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkPayload(item, `${path}[${index}]`, output));
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      walkPayload(child, `${path}.${key}`, output);
    }
  }
}

function classifyValue(value) {
  if (value === null) {
    return {
      value_type: 'null',
      value_text: null,
      value_number: null,
      value_boolean: null,
      value_json: null,
    };
  }

  if (typeof value === 'string') {
    return {
      value_type: 'string',
      value_text: value,
      value_number: null,
      value_boolean: null,
      value_json: value,
    };
  }

  if (typeof value === 'number') {
    return {
      value_type: 'number',
      value_text: String(value),
      value_number: Number.isFinite(value) ? value : null,
      value_boolean: null,
      value_json: value,
    };
  }

  if (typeof value === 'boolean') {
    return {
      value_type: 'boolean',
      value_text: value ? 'true' : 'false',
      value_number: null,
      value_boolean: value,
      value_json: value,
    };
  }

  return {
    value_type: Array.isArray(value) ? 'array' : 'object',
    value_text: JSON.stringify(value),
    value_number: null,
    value_boolean: null,
    value_json: value,
  };
}

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS budgetlineitem_unpacked_fields (
      id BIGSERIAL PRIMARY KEY,
      company_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      budget_line_item_id TEXT NOT NULL,
      field_path TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_text TEXT NULL,
      value_number DOUBLE PRECISION NULL,
      value_boolean BOOLEAN NULL,
      value_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, project_id, budget_line_item_id, field_path)
    )
  `);

  const rows = await prisma.$queryRawUnsafe(`
    SELECT company_id, project_id, budget_line_item_id, payload
    FROM budgetlineitems
    ORDER BY id ASC
  `);

  let processed = 0;
  for (const row of rows) {
    const companyId = String(row.company_id || '');
    const projectId = String(row.project_id || '');
    const budgetLineItemId = String(row.budget_line_item_id || '');
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};

    const flattened = [];
    walkPayload(payload, '$', flattened);

    const unpackedRows = flattened.map((item) => {
      const c = classifyValue(item.raw_value);
      return {
        field_path: item.field_path,
        value_type: c.value_type,
        value_text: c.value_text,
        value_number: c.value_number,
        value_boolean: c.value_boolean,
        value_json: c.value_json,
      };
    });

    await prisma.$executeRawUnsafe(
      `
        DELETE FROM budgetlineitem_unpacked_fields
        WHERE company_id = $1
          AND project_id = $2
          AND budget_line_item_id = $3
      `,
      companyId,
      projectId,
      budgetLineItemId
    );

    if (unpackedRows.length > 0) {
      await prisma.$executeRawUnsafe(
        `
          INSERT INTO budgetlineitem_unpacked_fields (
            company_id,
            project_id,
            budget_line_item_id,
            field_path,
            value_type,
            value_text,
            value_number,
            value_boolean,
            value_json,
            updated_at
          )
          SELECT
            $1,
            $2,
            $3,
            row_data.field_path,
            row_data.value_type,
            row_data.value_text,
            row_data.value_number,
            row_data.value_boolean,
            COALESCE(row_data.value_json, 'null'::jsonb),
            NOW()
          FROM jsonb_to_recordset($4::jsonb) AS row_data(
            field_path TEXT,
            value_type TEXT,
            value_text TEXT,
            value_number DOUBLE PRECISION,
            value_boolean BOOLEAN,
            value_json JSONB
          )
          ON CONFLICT (company_id, project_id, budget_line_item_id, field_path)
          DO UPDATE SET
            value_type = EXCLUDED.value_type,
            value_text = EXCLUDED.value_text,
            value_number = EXCLUDED.value_number,
            value_boolean = EXCLUDED.value_boolean,
            value_json = COALESCE(EXCLUDED.value_json, 'null'::jsonb),
            updated_at = NOW()
        `,
        companyId,
        projectId,
        budgetLineItemId,
        JSON.stringify(unpackedRows)
      );
    }

    processed += 1;
    if (processed % 100 === 0) {
      console.log(`Processed ${processed}/${rows.length}`);
    }
  }

  const unpackedCount = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM budgetlineitem_unpacked_fields');
  console.log(`Done. Processed ${processed} budget line items.`);
  console.log(`Unpacked field rows: ${unpackedCount?.[0]?.count ?? 0}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
