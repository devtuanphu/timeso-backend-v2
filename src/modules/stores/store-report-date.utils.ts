import { BadRequestException } from '@nestjs/common';
import moment from 'moment-timezone';

export const STORE_REPORT_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const STORE_REPORT_DATE_FORMAT = 'YYYY-MM-DD';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface StoreRevenueDateRange {
  startDate: string;
  endDate: string;
  startUtc: Date;
  endExclusiveUtc: Date;
}

export function validateStoreReportDate(
  value: string,
  fieldName = 'date',
): string {
  const parsed = DATE_ONLY_PATTERN.test(value || '')
    ? moment.tz(value, STORE_REPORT_DATE_FORMAT, true, STORE_REPORT_TIMEZONE)
    : null;

  if (!parsed?.isValid()) {
    throw new BadRequestException(
      `${fieldName} phải có định dạng YYYY-MM-DD hợp lệ`,
    );
  }

  return value;
}

export function resolveStoreRevenueDateRange(
  startDate?: string,
  endDate?: string,
  now = new Date(),
): StoreRevenueDateRange {
  const defaultEndDate = moment(now)
    .tz(STORE_REPORT_TIMEZONE)
    .format(STORE_REPORT_DATE_FORMAT);
  const resolvedEndDate = validateStoreReportDate(
    endDate || defaultEndDate,
    'endDate',
  );
  const resolvedStartDate = validateStoreReportDate(
    startDate ||
      moment
        .tz(
          resolvedEndDate,
          STORE_REPORT_DATE_FORMAT,
          true,
          STORE_REPORT_TIMEZONE,
        )
        .subtract(30, 'days')
        .format(STORE_REPORT_DATE_FORMAT),
    'startDate',
  );

  const startInHcm = moment.tz(
    resolvedStartDate,
    STORE_REPORT_DATE_FORMAT,
    true,
    STORE_REPORT_TIMEZONE,
  );
  const endInHcm = moment.tz(
    resolvedEndDate,
    STORE_REPORT_DATE_FORMAT,
    true,
    STORE_REPORT_TIMEZONE,
  );

  if (startInHcm.isAfter(endInHcm, 'day')) {
    throw new BadRequestException('startDate không được sau endDate');
  }

  return {
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
    startUtc: startInHcm.startOf('day').utc().toDate(),
    endExclusiveUtc: endInHcm.add(1, 'day').startOf('day').utc().toDate(),
  };
}
