import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMetadataArgsStorage } from 'typeorm';

import { RegisterDto } from '../auth/dto/register.dto';
import { AccountResponseDto } from './dto/account-response.dto';
import { UpdateFinanceDto, UpdateIdentityDto } from './dto/update-profile.dto';
import { Account } from './entities/account.entity';

describe('Account innovation pioneer contract', () => {
  const expectStatementsInOrder = (sql: string, statements: string[]) => {
    let cursor = 0;

    for (const statement of statements) {
      const index = sql.indexOf(statement, cursor);
      expect(index).toBeGreaterThanOrEqual(cursor);
      cursor = index + statement.length;
    }
  };

  it('maps the account field to a non-null database column with a true default', () => {
    const column = getMetadataArgsStorage().columns.find(
      (metadata) =>
        metadata.target === Account &&
        metadata.propertyName === 'isInnovationPioneer',
    );

    expect(column).toBeDefined();
    expect(column?.options.name).toBe('is_innovation_pioneer');
    expect(column?.options.default).toBe(true);
    expect(column?.options.nullable).not.toBe(true);
  });

  it('documents the field on AccountResponseDto', () => {
    const properties = Reflect.getMetadata(
      'swagger/apiModelPropertiesArray',
      AccountResponseDto.prototype,
    ) as string[];
    const metadata = Reflect.getMetadata(
      'swagger/apiModelProperties',
      AccountResponseDto.prototype,
      'isInnovationPioneer',
    );

    expect(properties).toContain(':isInnovationPioneer');
    expect(metadata).toMatchObject({ default: true, example: true });
  });

  it('runs fail-fast expand, backfill, proof, validation, and bounded contract phases in order', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'scripts/migration_add_account_innovation_pioneer.sql',
      ),
      'utf8',
    );

    expect(migration.startsWith('\\set ON_ERROR_STOP on\n')).toBe(true);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(5);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(5);
    expectStatementsInOrder(migration, [
      '-- Expand phase',
      'BEGIN;',
      'ADD COLUMN IF NOT EXISTS is_innovation_pioneer boolean',
      'ALTER COLUMN is_innovation_pioneer SET DEFAULT TRUE',
      'COMMIT;',
      '-- Backfill phase',
      'BEGIN;',
      'UPDATE accounts',
      'WHERE is_innovation_pioneer IS NULL;',
      'COMMIT;',
      '-- Constraint phase',
      'BEGIN;',
      'FROM pg_constraint',
      "conname = 'ck_accounts_innovation_pioneer_not_null'",
      "conrelid = 'accounts'::regclass",
      'ADD CONSTRAINT ck_accounts_innovation_pioneer_not_null',
      'CHECK (is_innovation_pioneer IS NOT NULL) NOT VALID;',
      'COMMIT;',
      '-- Validation phase',
      'BEGIN;',
      'VALIDATE CONSTRAINT ck_accounts_innovation_pioneer_not_null;',
      'COMMIT;',
      '-- Contract phase',
      'BEGIN;',
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '30s';",
      'ALTER COLUMN is_innovation_pioneer SET NOT NULL;',
      'DROP CONSTRAINT IF EXISTS ck_accounts_innovation_pioneer_not_null;',
      'COMMIT;',
      '-- Postconditions',
    ]);
    expect(migration).toMatch(
      /UPDATE accounts\s+SET is_innovation_pioneer = TRUE\s+WHERE is_innovation_pioneer IS NULL;/,
    );
    expect(migration).toContain('information_schema.columns');
    expect(migration).toContain('WHERE is_innovation_pioneer IS FALSE');
    expect(migration).toContain('temporary_innovation_pioneer_constraints');
  });

  it.each([
    [RegisterDto, { phone: '0901234567', password: 'secret1' }],
    [UpdateIdentityDto, { docType: 'CCCD', documentNumber: '012345678912' }],
    [UpdateFinanceDto, { bankName: 'Vietcombank', bankNumber: '1234567890' }],
  ])(
    'rejects isInnovationPioneer on writable %p input',
    async (Dto, validInput) => {
      const input = plainToInstance(Dto, {
        ...validInput,
        isInnovationPioneer: false,
      });

      const errors = await validate(input, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            property: 'isInnovationPioneer',
            constraints: expect.objectContaining({
              whitelistValidation: expect.any(String),
            }),
          }),
        ]),
      );
      expect(input).toHaveProperty('isInnovationPioneer', false);
    },
  );
});
