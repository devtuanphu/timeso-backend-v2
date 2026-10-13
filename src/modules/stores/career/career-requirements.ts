import { BadRequestException } from '@nestjs/common';

import {
  BOOLEAN_REQUIREMENT_CODES,
  CAREER_ERRORS,
  CAREER_LIMITS,
  CareerRequirementCode,
  CareerSubject,
  REQUIREMENT_CODES_BY_SUBJECT,
  REQUIREMENT_LABELS,
  REQUIREMENT_UNITS,
} from './career.constants';
import type { CareerRequirement } from '../entities/career-requirement.entity';

export interface RequirementInput {
  code: CareerRequirementCode;
  value?: number | null;
  refSkillId?: string | null;
}

export interface NormalizedRequirement {
  code: CareerRequirementCode;
  value: number | null;
  refSkillId: string | null;
}

/** Điều kiện trả cho app (cấu hình, chưa đo). */
export interface RequirementView {
  id: string;
  code: CareerRequirementCode;
  label: string;
  unit: string | null;
  value: number | null;
  refSkillId: string | null;
  isRequired: boolean;
  sortOrder: number;
}

const invalid = (message: string) =>
  new BadRequestException({ code: CAREER_ERRORS.REQUIREMENT_INVALID, message });

/**
 * Kiểm và chuẩn hoá danh sách điều kiện của một chủ thể. Không đụng cơ sở dữ
 * liệu: kỹ năng tham chiếu (`refSkillId`) được kiểm cùng cửa hàng ở service.
 *
 * - mã phải hợp với chủ thể (vd. "giờ thực hành" chỉ có ở kỹ năng);
 * - mỗi mã một lần, trừ `skill_achieved` (mỗi kỹ năng một lần);
 * - mã có ngưỡng phải có số > 0; mã đạt / chưa đạt bỏ qua số.
 */
export function normalizeRequirements(
  subject: CareerSubject,
  inputs: RequirementInput[] | null | undefined,
): NormalizedRequirement[] {
  const list = inputs ?? [];
  if (list.length > CAREER_LIMITS.requirementsPerSubject) {
    throw invalid(
      `Tối đa ${CAREER_LIMITS.requirementsPerSubject} điều kiện cho mỗi mục`,
    );
  }
  const allowed = REQUIREMENT_CODES_BY_SUBJECT[subject];
  const seen = new Set<string>();
  return list.map((input) => {
    if (!allowed.includes(input.code)) {
      throw invalid(`Điều kiện "${input.code}" không áp dụng cho mục này`);
    }
    const isSkillRef = input.code === CareerRequirementCode.SKILL_ACHIEVED;
    if (isSkillRef && !input.refSkillId) {
      throw invalid('Chọn kỹ năng cần đạt');
    }
    const key = isSkillRef ? `${input.code}:${input.refSkillId}` : input.code;
    if (seen.has(key)) {
      throw invalid(`Điều kiện "${REQUIREMENT_LABELS[input.code]}" bị trùng`);
    }
    seen.add(key);

    if (BOOLEAN_REQUIREMENT_CODES.has(input.code)) {
      return {
        code: input.code,
        value: null,
        refSkillId: isSkillRef ? (input.refSkillId as string) : null,
      };
    }
    const value = Number(input.value);
    if (input.value === null || input.value === undefined || !(value > 0)) {
      throw invalid(`Nhập số cho "${REQUIREMENT_LABELS[input.code]}"`);
    }
    return { code: input.code, value, refSkillId: null };
  });
}

export function toRequirementView(row: CareerRequirement): RequirementView {
  return {
    id: row.id,
    code: row.code,
    label: REQUIREMENT_LABELS[row.code] ?? row.code,
    unit: REQUIREMENT_UNITS[row.code] ?? null,
    value: row.value === null || row.value === undefined ? null : Number(row.value),
    refSkillId: row.refSkillId,
    isRequired: row.isRequired,
    sortOrder: row.sortOrder,
  };
}
