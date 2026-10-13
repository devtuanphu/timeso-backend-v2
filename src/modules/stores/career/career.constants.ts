/**
 * Hằng số của lộ trình v2 (Bộ phận · Vị trí · Kỹ năng). Plan:
 * docs/plans/2026-10-13-career-ladder-v2-impl.md (workspace).
 */

export type CareerSubject = 'department' | 'position' | 'skill';

/**
 * Mã điều kiện. Điều kiện luôn là điều kiện để VÀO chủ thể mang nó; cửa sổ
 * đo suy từ mã (không có cột riêng) — xem career-evaluation.service.ts.
 */
export enum CareerRequirementCode {
  /** Bộ phận: số ca hoàn thành trong tháng VN gần nhất đã kết thúc. */
  MONTHLY_SHIFTS = 'monthly_shifts',
  /** Bộ phận: số giờ làm trong tháng VN gần nhất đã kết thúc. */
  MONTHLY_HOURS = 'monthly_hours',
  /** Vị trí: giờ làm cộng dồn từ lúc nhận vị trí hiện tại. */
  WORK_HOURS = 'work_hours',
  /** Vị trí: số ca hoàn thành cộng dồn từ lúc nhận vị trí hiện tại. */
  COMPLETED_SHIFTS = 'completed_shifts',
  /** Vị trí: đã đạt một kỹ năng cụ thể (ref_skill_id). */
  SKILL_ACHIEVED = 'skill_achieved',
  /** Vị trí: đã đạt mọi kỹ năng bắt buộc của bộ phận hiện tại. */
  ALL_REQUIRED_SKILLS = 'all_required_skills',
  /** Kỹ năng: giờ làm ca từ lúc kỹ năng mở khoá, khi đang ở bộ phận đó. */
  PRACTICE_HOURS = 'practice_hours',
  /** Kỹ năng: số lần đánh giá Đạt từ lúc mở khoá. */
  SUCCESSFUL_REPS = 'successful_reps',
  /** Kỹ năng: có ít nhất một lần quản lý đánh giá Đạt từ lúc mở khoá. */
  MANAGER_REVIEW = 'manager_review',
}

export const REQUIREMENT_CODES_BY_SUBJECT: Record<
  CareerSubject,
  CareerRequirementCode[]
> = {
  department: [
    CareerRequirementCode.MONTHLY_SHIFTS,
    CareerRequirementCode.MONTHLY_HOURS,
  ],
  position: [
    CareerRequirementCode.WORK_HOURS,
    CareerRequirementCode.COMPLETED_SHIFTS,
    CareerRequirementCode.SKILL_ACHIEVED,
    CareerRequirementCode.ALL_REQUIRED_SKILLS,
  ],
  skill: [
    CareerRequirementCode.PRACTICE_HOURS,
    CareerRequirementCode.SUCCESSFUL_REPS,
    CareerRequirementCode.MANAGER_REVIEW,
  ],
};

/** Mã không cần giá trị số (đạt / chưa đạt). */
export const BOOLEAN_REQUIREMENT_CODES = new Set<CareerRequirementCode>([
  CareerRequirementCode.SKILL_ACHIEVED,
  CareerRequirementCode.ALL_REQUIRED_SKILLS,
  CareerRequirementCode.MANAGER_REVIEW,
]);

export const REQUIREMENT_LABELS: Record<CareerRequirementCode, string> = {
  [CareerRequirementCode.MONTHLY_SHIFTS]: 'Số ca mỗi tháng',
  [CareerRequirementCode.MONTHLY_HOURS]: 'Giờ làm mỗi tháng',
  [CareerRequirementCode.WORK_HOURS]: 'Thời gian làm việc',
  [CareerRequirementCode.COMPLETED_SHIFTS]: 'Số ca làm việc',
  [CareerRequirementCode.SKILL_ACHIEVED]: 'Kỹ năng',
  [CareerRequirementCode.ALL_REQUIRED_SKILLS]: 'Đạt đủ kỹ năng bắt buộc',
  [CareerRequirementCode.PRACTICE_HOURS]: 'Thời gian thực hành tối thiểu',
  [CareerRequirementCode.SUCCESSFUL_REPS]: 'Số lần thực hiện đạt',
  [CareerRequirementCode.MANAGER_REVIEW]: 'Quản lý đánh giá',
};

export const REQUIREMENT_UNITS: Partial<Record<CareerRequirementCode, string>> = {
  [CareerRequirementCode.MONTHLY_SHIFTS]: 'ca',
  [CareerRequirementCode.MONTHLY_HOURS]: 'giờ',
  [CareerRequirementCode.WORK_HOURS]: 'giờ',
  [CareerRequirementCode.COMPLETED_SHIFTS]: 'ca',
  [CareerRequirementCode.PRACTICE_HOURS]: 'giờ',
  [CareerRequirementCode.SUCCESSFUL_REPS]: 'lần',
};

/** Giới hạn mỗi cửa hàng (SaaS-9): giữ chi phí xét điều kiện có trần. */
export const CAREER_LIMITS = {
  departmentsPerStore: 50,
  positionsPerDepartment: 30,
  skillsPerDepartment: 30,
  requirementsPerSubject: 10,
  /** Tối đa nhân viên trả về trong danh sách "tuỳ chọn" của màn vị trí. */
  optionalCandidates: 200,
  maxRequirementValue: 100000,
} as const;

export const CAREER_NAME_MAX = 80;
export const CAREER_DESCRIPTION_MAX = 200;
export const CAREER_NOTE_MAX = 500;
/** Ghi chú bắt buộc cho quyết định ngoại lệ (chưa đủ điều kiện). */
export const CAREER_FORCE_NOTE_MIN = 3;

/** Mã lỗi ổn định để app hiện đúng thông báo. */
export const CAREER_ERRORS = {
  TIER_INVALID: 'CAREER_TIER_INVALID',
  PARENT_INVALID: 'CAREER_PARENT_INVALID',
  NAME_TAKEN: 'CAREER_NAME_TAKEN',
  SYSTEM_DEPARTMENT: 'CAREER_SYSTEM_DEPARTMENT',
  DEPARTMENT_IN_USE: 'DEPARTMENT_IN_USE',
  POSITION_IN_USE: 'POSITION_IN_USE',
  SKILL_HAS_ACHIEVERS: 'SKILL_HAS_ACHIEVERS',
  LIMIT_REACHED: 'CAREER_LIMIT_REACHED',
  REQUIREMENT_INVALID: 'CAREER_REQUIREMENT_INVALID',
  CRITERIA_NOT_MET: 'CAREER_CRITERIA_NOT_MET',
  NOTE_REQUIRED: 'CAREER_NOTE_REQUIRED',
  ALREADY_IN_POSITION: 'CAREER_ALREADY_IN_POSITION',
  SKILL_LOCKED: 'CAREER_SKILL_LOCKED',
  SKILL_ALREADY_ACHIEVED: 'CAREER_SKILL_ALREADY_ACHIEVED',
  EMPLOYEE_NOT_ACTIVE: 'CAREER_EMPLOYEE_NOT_ACTIVE',
  V2_DISABLED: 'CAREER_V2_DISABLED',
  APP_UPDATE_REQUIRED: 'APP_UPDATE_REQUIRED',
  REQUEST_REUSED: 'CAREER_REQUEST_REUSED',
} as const;
