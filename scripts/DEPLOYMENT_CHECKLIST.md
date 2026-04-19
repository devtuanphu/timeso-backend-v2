# Deployment Checklist - TimeSO Backend

**Date:** 2026-04-19
**Status:** Ready for Deployment (after running migration)

---

## Pre-Deployment Checklist

### 1. Database Migration (REQUIRED)
- [ ] Run migration script on production database
  ```bash
  psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME \
    -f scripts/migration_add_requests_tables.sql
  ```
- [ ] Verify tables created:
  ```sql
  SELECT table_name FROM information_schema.tables
  WHERE table_name IN ('shift_change_requests', 'bonus_work_requests');
  ```
- [ ] Verify indexes created:
  ```sql
  SELECT indexname FROM pg_indexes
  WHERE tablename IN ('shift_change_requests', 'bonus_work_requests');
  ```

### 2. Code Review Sign-off
- [x] TypeScript compilation: **PASS** (0 errors)
- [x] Critical bugs fixed: **7 fixes applied**
- [x] New features added: **16 API endpoints**
- [x] Unit tests written: **16 test cases**

### 3. Security Review
- [x] `otp_debug` removed from all responses
- [x] Input validation in place
- [x] Authorization guards on all new endpoints
- [ ] Review CORS settings for production

### 4. Configuration
- [ ] Set `NODE_ENV=production`
- [ ] Verify `synchronize: false` in production (or use migrations)
- [ ] Set strong `JWT_SECRET` and `JWT_REFRESH_SECRET`
- [ ] Verify database credentials

---

## Post-Deployment Checklist

### 1. Smoke Tests
- [ ] Health check: `GET /api/health`
- [ ] Login test
- [ ] Test shift-change-request creation
- [ ] Test bonus-work-request creation
- [ ] Test payroll calculation

### 2. Mobile App
- [ ] Build new staff app with fix
- [ ] Build new owner app with fix
- [ ] Test shift change flow
- [ ] Test bonus work registration

### 3. Monitoring
- [ ] Check application logs for errors
- [ ] Monitor database query performance
- [ ] Monitor cron job execution times

---

## Files Changed Summary

### New Files
```
scripts/migration_add_requests_tables.sql     (Database migration)
src/modules/stores/entities/shift-change-request.entity.ts
src/modules/stores/entities/bonus-work-request.entity.ts
src/modules/stores/stores-requests.spec.ts   (Unit tests)
```

### Modified Files
```
src/modules/auth/auth.service.ts              (-3 lines otp_debug)
src/modules/stores/stores.service.ts          (Payroll fix + transactions + new methods)
src/modules/stores/stores.controller.ts       (+16 new endpoints)
src/modules/stores/stores.module.ts          (+2 entities)
src/modules/stores/entities/employee-asset-assignment.entity.ts (nullable fix)
timeso-staff/src/features/workshift/screens/ShiftChangeScreen.tsx
timeso-staff/src/features/workshift/screens/BonusWorkScreen.tsx
timeso-staff/src/services/api/workshift.ts
```

---

## Rollback Plan

If issues occur, rollback migration:
```sql
DROP TABLE IF EXISTS shift_change_requests;
DROP TABLE IF EXISTS bonus_work_requests;
```

---

## Contact
**Review:** Claude AI - 2026-04-19
