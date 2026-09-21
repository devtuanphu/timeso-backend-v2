import { LeaveType } from './entities/employee-leave-request.entity';

/**
 * Loại đơn nghỉ được tính là "nghỉ có phép" cho một ca: chỉ các loại nghỉ
 * cả ngày. Xin đi trễ / về sớm / tăng ca (LATE/EARLY/OVERTIME) đã duyệt mà
 * không check-in thì vẫn là nghỉ không phép.
 */
export const AUTHORIZED_ABSENCE_LEAVE_TYPES: readonly LeaveType[] = [
  LeaveType.SICK,
  LeaveType.PERSONAL,
  LeaveType.VACATION,
  LeaveType.UNPAID,
  LeaveType.OTHER,
];

const typeList = AUTHORIZED_ABSENCE_LEAVE_TYPES.map((type) => `'${type}'`).join(
  ', ',
);

/**
 * SQL `EXISTS (...)`: có đơn nghỉ đã duyệt thuộc loại nghỉ cả ngày phủ ngày
 * làm của ca. Đơn nghỉ theo giờ chỉ tính khi gắn đúng ca đó.
 *
 * Tham số là biểu thức SQL (tên cột hoặc placeholder) do code gọi truyền vào,
 * không bao giờ là dữ liệu người dùng.
 */
export const approvedLeaveCoversShiftSql = (refs: {
  employeeProfileId: string;
  workDate: string;
  assignmentId: string;
}): string =>
  `EXISTS (SELECT 1 FROM employee_leave_requests elr
     WHERE elr.employee_profile_id = ${refs.employeeProfileId}
       AND elr.status = 'APPROVED'
       AND elr.deleted_at IS NULL
       AND elr.type::text IN (${typeList})
       AND elr.start_date <= ${refs.workDate}
       AND elr.end_date >= ${refs.workDate}
       AND (elr.start_time IS NULL
            OR elr.end_time IS NULL
            OR elr.shift_assignment_id = ${refs.assignmentId}))`;

interface QueryExecutor {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

/** Ca `assignmentId` (ngày `workDate`, YYYY-MM-DD giờ VN) có nghỉ có phép không. */
export async function isShiftCoveredByApprovedLeave(
  executor: QueryExecutor,
  employeeProfileId: string,
  workDate: string,
  assignmentId: string,
): Promise<boolean> {
  const rows = await executor.query(
    `SELECT ${approvedLeaveCoversShiftSql({
      employeeProfileId: '$1',
      workDate: '$2::date',
      assignmentId: '$3::uuid',
    })} AS covered`,
    [employeeProfileId, workDate, assignmentId],
  );
  return (
    Array.isArray(rows) &&
    rows.length > 0 &&
    (rows[0] as { covered?: unknown })?.covered === true
  );
}

/** Same rule as approvedLeaveCoversShiftSql, for rows already loaded. */
export function leaveCoversShift(
  leave: {
    type: LeaveType | string;
    status?: string;
    startDate: string;
    endDate: string;
    startTime?: string | null;
    endTime?: string | null;
    shiftAssignmentId?: string | null;
  },
  workDate: string,
  assignmentId: string,
): boolean {
  if (leave.status !== undefined && leave.status !== 'APPROVED') return false;
  if (!(AUTHORIZED_ABSENCE_LEAVE_TYPES as readonly string[]).includes(leave.type))
    return false;
  const date = workDate.slice(0, 10);
  if (String(leave.startDate).slice(0, 10) > date) return false;
  if (String(leave.endDate).slice(0, 10) < date) return false;
  return (
    !leave.startTime || !leave.endTime || leave.shiftAssignmentId === assignmentId
  );
}
