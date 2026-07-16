import { WeekDaySchedule } from './entities/shift-management.entity';

export enum ShiftRecurrenceFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

export enum ShiftMonthlyMode {
  DAY_OF_MONTH = 'DAY_OF_MONTH',
  NTH_WEEKDAY = 'NTH_WEEKDAY',
}

export enum ShiftRecurrenceEndType {
  NEVER = 'NEVER',
  UNTIL = 'UNTIL',
  COUNT = 'COUNT',
}

export interface ShiftRecurrenceRule {
  enabled: boolean;
  frequency: ShiftRecurrenceFrequency;
  interval: number;
  weekDays?: WeekDaySchedule[];
  monthlyMode?: ShiftMonthlyMode;
  dayOfMonth?: number;
  weekOfMonth?: number;
  weekday?: WeekDaySchedule;
  endType: ShiftRecurrenceEndType;
  endDate?: string;
  occurrenceCount?: number;
}
