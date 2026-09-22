-- =============================================
-- One-off data repair: deactivate the default bonus/fine payroll rules that
-- were seeded at store creation and never edited by the owner.
--
-- Context: createDefaultPayrollSetting used to seed, for every new store,
-- active BONUS/FINE rules the owner never configured. The most visible one,
-- "Thưởng chuyên cần" (BONUS / ATTENDANCE / 200.000đ), was added to every
-- employee's estimate — even for a month with no completed shift. New stores
-- no longer get these rules (backend change in the same release); this
-- script retires the copies already seeded for existing stores.
--
-- A rule is touched ONLY when ALL of these hold (identifies the seed exactly):
--   * is_custom = false, is_active = true, deleted_at IS NULL
--   * (name, category, rule_type, calc_type, value) is exactly one of the six
--     seeded tuples below
--   * updated_at is within 2 seconds of created_at (never edited since insert)
--   * created_at is within 10 minutes after the store's created_at (inserted by
--     store creation, not added later by the owner with the same values)
-- Benefit rules (category 'benefit') are not touched: payroll never reads them.
-- Owner-configured or edited rules are not touched and keep working.
--
-- Effect: the rule disappears from the owner's payroll settings (which list
-- active rules only) and from the live estimate of the current month.
-- Stored payslips are NOT rewritten: APPROVED/PAID payslips stay untouched;
-- the current month's PENDING payslip is re-priced live on read and on the
-- next check-out/recalculation; past-month PENDING payslips keep their stored
-- figures until the owner recalculates them.
--
-- Idempotent: a second run matches 0 rows (is_active is already false).
-- Reversible: the UPDATE only flips is_active; the preflight output lists ids.
-- Do not run without verifying the target database.
-- =============================================

-- 0) Preflight (read-only): what would be deactivated, per store and rule.
WITH seeded(name, category, rule_type, calc_type, value) AS (
  VALUES
    ('Thưởng chuyên cần',       'bonus', 'ATTENDANCE',    'amount', 200000::numeric),
    ('Thưởng hiệu suất',        'bonus', 'KPI',           'amount', 200000::numeric),
    ('Vi phạm nội quy',         'fine',  'DISCIPLINE',    'amount', 200000::numeric),
    ('Vi phạm đi trễ - về sớm', 'fine',  'LATE_EARLY',    'amount',  50000::numeric),
    ('Không check in-out',      'fine',  'MISSING_CHECK', 'amount', 200000::numeric),
    ('Vắng mặt không phép',     'fine',  'ABSENT',        'shift',       1::numeric)
)
SELECT r.store_id, r.id, r.name, r.category::text AS category, r.rule_type,
       r.calc_type::text AS calc_type, r.value, r.created_at, r.updated_at
FROM store_payroll_rules r
JOIN stores s ON s.id = r.store_id
JOIN seeded d
  ON d.name = r.name
 AND d.category = r.category::text
 AND d.rule_type = r.rule_type
 AND d.calc_type = r.calc_type::text
 AND d.value = r.value
WHERE r.is_custom = false
  AND r.is_active = true
  AND r.deleted_at IS NULL
  AND r.updated_at BETWEEN r.created_at AND r.created_at + interval '2 seconds'
  AND r.created_at BETWEEN s.created_at AND s.created_at + interval '10 minutes'
ORDER BY r.store_id, r.category, r.rule_type;

-- 0b) Preflight (read-only): seeded-looking rules that will be KEPT because
--     they were edited or added later (for information only).
WITH seeded(name, category, rule_type, calc_type, value) AS (
  VALUES
    ('Thưởng chuyên cần',       'bonus', 'ATTENDANCE',    'amount', 200000::numeric),
    ('Thưởng hiệu suất',        'bonus', 'KPI',           'amount', 200000::numeric),
    ('Vi phạm nội quy',         'fine',  'DISCIPLINE',    'amount', 200000::numeric),
    ('Vi phạm đi trễ - về sớm', 'fine',  'LATE_EARLY',    'amount',  50000::numeric),
    ('Không check in-out',      'fine',  'MISSING_CHECK', 'amount', 200000::numeric),
    ('Vắng mặt không phép',     'fine',  'ABSENT',        'shift',       1::numeric)
)
SELECT r.store_id, r.id, r.name, r.is_custom, r.created_at, r.updated_at
FROM store_payroll_rules r
JOIN stores s ON s.id = r.store_id
JOIN seeded d
  ON d.name = r.name
 AND d.category = r.category::text
 AND d.rule_type = r.rule_type
WHERE r.is_active = true
  AND r.deleted_at IS NULL
  AND NOT (
        r.is_custom = false
    AND d.calc_type = r.calc_type::text
    AND d.value = r.value
    AND r.updated_at BETWEEN r.created_at AND r.created_at + interval '2 seconds'
    AND r.created_at BETWEEN s.created_at AND s.created_at + interval '10 minutes'
  )
ORDER BY r.store_id, r.name;

-- 1) Apply.
BEGIN;

WITH seeded(name, category, rule_type, calc_type, value) AS (
  VALUES
    ('Thưởng chuyên cần',       'bonus', 'ATTENDANCE',    'amount', 200000::numeric),
    ('Thưởng hiệu suất',        'bonus', 'KPI',           'amount', 200000::numeric),
    ('Vi phạm nội quy',         'fine',  'DISCIPLINE',    'amount', 200000::numeric),
    ('Vi phạm đi trễ - về sớm', 'fine',  'LATE_EARLY',    'amount',  50000::numeric),
    ('Không check in-out',      'fine',  'MISSING_CHECK', 'amount', 200000::numeric),
    ('Vắng mặt không phép',     'fine',  'ABSENT',        'shift',       1::numeric)
)
UPDATE store_payroll_rules r
SET is_active = false,
    updated_at = now()
FROM stores s, seeded d
WHERE s.id = r.store_id
  AND d.name = r.name
  AND d.category = r.category::text
  AND d.rule_type = r.rule_type
  AND d.calc_type = r.calc_type::text
  AND d.value = r.value
  AND r.is_custom = false
  AND r.is_active = true
  AND r.deleted_at IS NULL
  AND r.updated_at BETWEEN r.created_at AND r.created_at + interval '2 seconds'
  AND r.created_at BETWEEN s.created_at AND s.created_at + interval '10 minutes';

-- Check the reported row count equals the count from preflight (0), then:
COMMIT;
-- (or ROLLBACK; if the count differs)

-- 2) Verify (read-only): must return 0 rows after the apply.
WITH seeded(name, category, rule_type, calc_type, value) AS (
  VALUES
    ('Thưởng chuyên cần',       'bonus', 'ATTENDANCE',    'amount', 200000::numeric),
    ('Thưởng hiệu suất',        'bonus', 'KPI',           'amount', 200000::numeric),
    ('Vi phạm nội quy',         'fine',  'DISCIPLINE',    'amount', 200000::numeric),
    ('Vi phạm đi trễ - về sớm', 'fine',  'LATE_EARLY',    'amount',  50000::numeric),
    ('Không check in-out',      'fine',  'MISSING_CHECK', 'amount', 200000::numeric),
    ('Vắng mặt không phép',     'fine',  'ABSENT',        'shift',       1::numeric)
)
SELECT count(*) AS still_active_untouched_seeded_rules
FROM store_payroll_rules r
JOIN stores s ON s.id = r.store_id
JOIN seeded d
  ON d.name = r.name
 AND d.category = r.category::text
 AND d.rule_type = r.rule_type
 AND d.calc_type = r.calc_type::text
 AND d.value = r.value
WHERE r.is_custom = false
  AND r.is_active = true
  AND r.deleted_at IS NULL
  AND r.updated_at BETWEEN r.created_at AND r.created_at + interval '2 seconds'
  AND r.created_at BETWEEN s.created_at AND s.created_at + interval '10 minutes';

-- 2b) Verify (read-only): active bonus/fine rules left per store (owner-configured).
SELECT r.store_id, r.category::text AS category, count(*) AS active_rules
FROM store_payroll_rules r
WHERE r.is_active = true AND r.deleted_at IS NULL
  AND r.category::text IN ('bonus', 'fine')
GROUP BY 1, 2
ORDER BY 1, 2;
