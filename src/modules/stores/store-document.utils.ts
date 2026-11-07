import { StoreDocument } from './entities/store-document.entity';
import { StoreDocumentView } from './entities/store-document-view.entity';

export type StoreDocumentStatus = 'ACTIVE' | 'UPCOMING' | 'EXPIRED' | 'STOPPED';
export type StoreDocumentViewState = 'UNREAD' | 'PARTIAL' | 'DONE';

type DocumentDates = Pick<StoreDocument, 'validFrom' | 'validTo' | 'stoppedAt'>;

/** YYYY-MM-DD có thật trên lịch (2026-02-31 không qua được). */
export const isValidDateKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const documentStatus = (doc: DocumentDates, today: string): StoreDocumentStatus => {
  if (doc.stoppedAt) return 'STOPPED';
  if (doc.validTo && doc.validTo < today) return 'EXPIRED';
  if (doc.validFrom > today) return 'UPCOMING';
  return 'ACTIVE';
};

/**
 * Bài nhân viên thấy được: chưa ngừng, chưa hết hạn. Bài sắp áp dụng vẫn hiện
 * (kèm ngày áp dụng) để nhân viên đọc trước và thông báo mở được.
 */
export const isDocumentOpen = (doc: DocumentDates, today: string): boolean => {
  const status = documentStatus(doc, today);
  return status === 'ACTIVE' || status === 'UPCOMING';
};

/**
 * Rỗng = tất cả nhân viên. Bài riêng của một bộ phận không bao giờ nới thành bài
 * chung, kể cả khi bộ phận đó đã bị xoá: khi đó bài không áp dụng cho ai.
 */
export const documentAppliesTo = (
  departmentIds: string[] | null | undefined,
  employeeDepartmentId: string | null | undefined,
): boolean => {
  if (!departmentIds?.length) return true;
  return !!employeeDepartmentId && departmentIds.includes(employeeDepartmentId);
};

type ViewProgress = Pick<StoreDocumentView, 'revision' | 'viewedParts' | 'totalParts' | 'completedAt'>;

/** Tiến độ còn tính được với bản hiện tại của bài; bản cũ coi như chưa xem. */
export const currentViewProgress = (
  view: ViewProgress | null | undefined,
  contentRevision: number,
): { state: StoreDocumentViewState; viewedParts: number; totalParts: number } => {
  if (!view || view.revision !== contentRevision) {
    return { state: 'UNREAD', viewedParts: 0, totalParts: 0 };
  }
  return {
    state: view.completedAt ? 'DONE' : 'PARTIAL',
    viewedParts: view.viewedParts,
    totalParts: view.totalParts,
  };
};

/** "12/12 đã xem": ai đang thuộc phạm vi của bài, ai trong số đó đã xem hết bản hiện tại. */
export const documentViewStats = (
  doc: Pick<StoreDocument, 'id' | 'departmentIds' | 'contentRevision'>,
  audience: { id: string; departmentId: string | null }[],
  views: Pick<StoreDocumentView, 'documentId' | 'employeeProfileId' | 'revision' | 'completedAt'>[],
): { audienceCount: number; viewedCount: number } => {
  const members = audience.filter((person) => documentAppliesTo(doc.departmentIds, person.departmentId));
  const done = new Set(
    views
      .filter(
        (view) =>
          view.documentId === doc.id && view.revision === doc.contentRevision && !!view.completedAt,
      )
      .map((view) => view.employeeProfileId),
  );
  return {
    audienceCount: members.length,
    viewedCount: members.filter((person) => done.has(person.id)).length,
  };
};

/**
 * Multer đọc tên tệp theo latin1 nên tên tiếng Việt bị méo; đọc lại thành UTF-8.
 * Tên vốn đã đúng (không giải được) giữ nguyên.
 */
export const decodeUploadedFileName = (name: string): string => {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
};
