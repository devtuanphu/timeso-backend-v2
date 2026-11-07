import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';

import { vnDateString } from '../../common/utils/vn-calendar';
import { Account } from '../accounts/entities/account.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import {
  ReportStoreDocumentViewDto,
  SaveStoreDocumentDto,
} from './dto/store-document.dto';
import { EMPLOYED_STATUSES, EmployeeProfile } from './entities/employee-profile.entity';
import { StoreDepartment } from './entities/store-department.entity';
import {
  StoreDocument,
  StoreDocumentFile,
  StoreDocumentKind,
} from './entities/store-document.entity';
import { StoreDocumentView } from './entities/store-document-view.entity';
import { Store } from './entities/store.entity';
import {
  currentViewProgress,
  decodeUploadedFileName,
  documentAppliesTo,
  documentStatus,
  documentViewStats,
  isDocumentOpen,
  isValidDateKey,
} from './store-document.utils';

const MAX_FILES = 10;
const KIND_LABEL: Record<StoreDocumentKind, string> = {
  [StoreDocumentKind.RULE]: 'Nội quy',
  [StoreDocumentKind.DOCUMENT]: 'Tài liệu',
};
/** Màn danh sách có ở cả bản app cũ, nên thông báo mở được trên mọi bản. */
const STAFF_DOCUMENTS_ROUTE = '/(personal)/internal-rules';

@Injectable()
export class StoreDocumentsService {
  private readonly logger = new Logger(StoreDocumentsService.name);

  constructor(
    @InjectRepository(StoreDocument)
    private readonly documentRepository: Repository<StoreDocument>,
    @InjectRepository(StoreDocumentView)
    private readonly viewRepository: Repository<StoreDocumentView>,
    @InjectRepository(EmployeeProfile)
    private readonly profileRepository: Repository<EmployeeProfile>,
    @InjectRepository(StoreDepartment)
    private readonly departmentRepository: Repository<StoreDepartment>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ---------- App chủ ----------

  async listForOwner(storeId: string) {
    const documents = await this.documentRepository.find({
      where: { storeId },
      order: { createdAt: 'DESC' },
    });
    const [audience, departments] = await Promise.all([
      this.loadAudience(storeId),
      this.loadDepartmentNames(storeId),
    ]);
    const views = documents.length
      ? await this.viewRepository.find({
          where: { documentId: In(documents.map((doc) => doc.id)), completedAt: Not(IsNull()) },
          select: ['documentId', 'employeeProfileId', 'revision', 'completedAt'],
        })
      : [];
    const today = vnDateString();
    return documents.map((doc) => ({
      ...this.summary(doc, departments, today),
      ...documentViewStats(doc, audience, views),
    }));
  }

  async getForOwner(storeId: string, documentId: string) {
    const doc = await this.findDocument(storeId, documentId);
    const [audience, departments] = await Promise.all([
      this.loadAudience(storeId),
      this.loadDepartmentNames(storeId),
    ]);
    const views = await this.viewRepository.find({
      where: { documentId: doc.id, completedAt: Not(IsNull()) },
      select: ['documentId', 'employeeProfileId', 'revision', 'completedAt'],
    });
    return {
      ...this.summary(doc, departments, vnDateString()),
      ...documentViewStats(doc, audience, views),
      content: doc.content,
      files: doc.files ?? [],
      revision: doc.contentRevision,
    };
  }

  async create(
    storeId: string,
    dto: SaveStoreDocumentDto,
    uploaded: Express.Multer.File[] | undefined,
    accountId: string,
  ) {
    const clientRequestId = dto.clientRequestId?.trim() || null;
    if (clientRequestId) {
      const previous = await this.documentRepository.findOne({
        where: { storeId, clientRequestId },
      });
      if (previous) return this.getForOwner(storeId, previous.id);
    }
    const source = dto.sourceDocumentId
      ? await this.findDocument(storeId, dto.sourceDocumentId)
      : null;
    const fields = await this.prepareFields(storeId, dto, source?.departmentIds ?? []);
    const files = this.mergeFiles(source?.files ?? [], dto.existingFileUrls ?? [], uploaded);
    this.assertHasBody(fields.content, files);
    const account = await this.documentRepository.manager.findOne(Account, {
      where: { id: accountId },
      select: ['id', 'fullName'],
    });
    let saved: StoreDocument;
    try {
      saved = await this.documentRepository.save(
        this.documentRepository.create({
          ...fields,
          storeId,
          files,
          contentRevision: 1,
          createdByAccountId: accountId,
          createdByName: account?.fullName ?? null,
          clientRequestId,
        }),
      );
    } catch (error) {
      // Hai lần gửi cùng lúc: lần thua trả về bài lần thắng đã tạo.
      if ((error as { code?: string })?.code === '23505' && clientRequestId) {
        const previous = await this.documentRepository.findOne({
          where: { storeId, clientRequestId },
        });
        if (previous) return this.getForOwner(storeId, previous.id);
      }
      throw error;
    }
    this.notifyAudience(saved, 'mới');
    return this.getForOwner(storeId, saved.id);
  }

  async update(
    storeId: string,
    documentId: string,
    dto: SaveStoreDocumentDto,
    uploaded: Express.Multer.File[] | undefined,
  ) {
    const doc = await this.findDocument(storeId, documentId);
    const fields = await this.prepareFields(storeId, dto, doc.departmentIds ?? [], doc.departmentIds ?? []);
    const keptUrls = dto.existingFileUrls ?? (doc.files ?? []).map((file) => file.url);
    const files = this.mergeFiles(doc.files ?? [], keptUrls, uploaded);
    this.assertHasBody(fields.content, files);

    const sameFiles =
      JSON.stringify((doc.files ?? []).map((file) => file.url)) ===
      JSON.stringify(files.map((file) => file.url));
    const changedBody = doc.content !== fields.content || !sameFiles;
    Object.assign(doc, fields, {
      files,
      contentRevision: changedBody ? doc.contentRevision + 1 : doc.contentRevision,
    });
    const saved = await this.documentRepository.save(doc);
    this.notifyAudience(saved, 'cập nhật');
    return this.getForOwner(storeId, saved.id);
  }

  async setStopped(storeId: string, documentId: string, stopped: boolean) {
    const doc = await this.findDocument(storeId, documentId);
    // Bấm lại không đổi mốc ngừng đầu tiên.
    if (stopped !== !!doc.stoppedAt) {
      doc.stoppedAt = stopped ? new Date() : null;
      await this.documentRepository.save(doc);
    }
    return this.getForOwner(storeId, doc.id);
  }

  /** Xoá mềm. Tệp không bị xoá: bản nhân bản có thể đang dùng chung. */
  async remove(storeId: string, documentId: string) {
    const doc = await this.findDocument(storeId, documentId);
    await this.documentRepository.softRemove(doc);
    return { deleted: true };
  }

  // ---------- App nhân viên ----------

  async listMine(storeId: string, accountId: string) {
    const profile = await this.findMyProfile(storeId, accountId);
    const today = vnDateString();
    const documents = (await this.documentRepository.find({ where: { storeId } })).filter(
      (doc) => isDocumentOpen(doc, today) && documentAppliesTo(doc.departmentIds, profile.departmentId),
    );
    const views = documents.length
      ? await this.viewRepository.find({
          where: { documentId: In(documents.map((doc) => doc.id)), employeeProfileId: profile.id },
        })
      : [];
    const viewOf = new Map(views.map((view) => [view.documentId, view]));
    return documents
      .sort(
        (a, b) =>
          b.validFrom.localeCompare(a.validFrom) || b.createdAt.getTime() - a.createdAt.getTime(),
      )
      .map((doc) => this.mineSummary(doc, profile, viewOf.get(doc.id)));
  }

  async getMine(storeId: string, documentId: string, accountId: string) {
    const profile = await this.findMyProfile(storeId, accountId);
    const doc = await this.findVisibleDocument(storeId, documentId, profile);
    const view = await this.viewRepository.findOne({
      where: { documentId: doc.id, employeeProfileId: profile.id },
    });
    return {
      ...this.mineSummary(doc, profile, view),
      content: doc.content,
      files: doc.files ?? [],
      revision: doc.contentRevision,
    };
  }

  /**
   * Ghi tiến độ xem. Chỉ tăng, không giảm: mở lại từ đầu hay xem trên máy khác
   * màn hình nhỏ hơn không kéo tiến độ lùi. So sánh theo tỉ lệ vì tổng số màn
   * hình khác nhau giữa các máy.
   */
  async reportView(
    storeId: string,
    documentId: string,
    accountId: string,
    dto: ReportStoreDocumentViewDto,
  ) {
    const profile = await this.findMyProfile(storeId, accountId);
    const doc = await this.findVisibleDocument(storeId, documentId, profile);
    if (dto.revision === doc.contentRevision) {
      const viewed = Math.min(dto.viewedParts, dto.totalParts);
      await this.viewRepository.query(
        `INSERT INTO store_document_views
           (document_id, employee_profile_id, revision, viewed_parts, total_parts, completed_at)
         VALUES ($1, $2, $3, $4::smallint, $5::smallint, CASE WHEN $4::int >= $5::int THEN now() END)
         ON CONFLICT (document_id, employee_profile_id) DO UPDATE SET
           revision = EXCLUDED.revision,
           viewed_parts = EXCLUDED.viewed_parts,
           total_parts = EXCLUDED.total_parts,
           completed_at = CASE
             WHEN store_document_views.revision < EXCLUDED.revision THEN EXCLUDED.completed_at
             ELSE COALESCE(store_document_views.completed_at, EXCLUDED.completed_at)
           END,
           updated_at = now()
         WHERE store_document_views.revision < EXCLUDED.revision
            OR (
              store_document_views.revision = EXCLUDED.revision
              AND EXCLUDED.viewed_parts::int * store_document_views.total_parts::int
                > store_document_views.viewed_parts::int * EXCLUDED.total_parts::int
            )`,
        [doc.id, profile.id, doc.contentRevision, viewed, dto.totalParts],
      );
    }
    const view = await this.viewRepository.findOne({
      where: { documentId: doc.id, employeeProfileId: profile.id },
    });
    return { ...currentViewProgress(view, doc.contentRevision), revision: doc.contentRevision };
  }

  // ---------- Dùng chung ----------

  private async findDocument(storeId: string, documentId: string) {
    const doc = await this.documentRepository.findOne({ where: { id: documentId, storeId } });
    if (!doc) throw new NotFoundException('Không tìm thấy nội quy / tài liệu');
    return doc;
  }

  private async findVisibleDocument(
    storeId: string,
    documentId: string,
    profile: Pick<EmployeeProfile, 'departmentId'>,
  ) {
    const doc = await this.documentRepository.findOne({ where: { id: documentId, storeId } });
    if (
      !doc ||
      !isDocumentOpen(doc, vnDateString()) ||
      !documentAppliesTo(doc.departmentIds, profile.departmentId)
    ) {
      throw new NotFoundException('Không tìm thấy nội quy / tài liệu');
    }
    return doc;
  }

  private async findMyProfile(storeId: string, accountId: string) {
    const profile = await this.profileRepository.findOne({
      where: { storeId, accountId, employmentStatus: In([...EMPLOYED_STATUSES]) },
      relations: ['department'],
      order: { createdAt: 'DESC' },
    });
    if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ nhân viên');
    return profile;
  }

  /** Nhân viên đang làm tại cửa hàng; chủ cửa hàng không tính dù có hồ sơ. */
  private async loadAudience(storeId: string) {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId'],
    });
    const profiles = await this.profileRepository.find({
      where: { storeId, employmentStatus: In([...EMPLOYED_STATUSES]) },
      select: ['id', 'departmentId', 'accountId'],
    });
    return profiles.filter((profile) => profile.accountId !== store?.ownerAccountId);
  }

  private async loadDepartmentNames(storeId: string) {
    const departments = await this.departmentRepository.find({
      where: { storeId },
      select: ['id', 'name'],
    });
    return new Map(departments.map((department) => [department.id, department.name]));
  }

  /**
   * `knownDepartmentIds`: bộ phận sẵn có trên bài gốc được gửi lại dù đã bị xoá,
   * vì form không bỏ chọn được bộ phận đã xoá — bắt buộc bỏ thì chủ phải qua
   * "Tất cả nhân viên", tức bài riêng bị nới thành bài chung.
   * `fallbackDepartmentIds`: bản sửa thiếu trường này thì giữ nguyên phạm vi.
   */
  private async prepareFields(
    storeId: string,
    dto: SaveStoreDocumentDto,
    knownDepartmentIds: string[] = [],
    fallbackDepartmentIds: string[] = [],
  ) {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Hãy nhập tên nội quy / tài liệu');
    const validTo = dto.validTo ?? null;
    if (!isValidDateKey(dto.validFrom)) throw new BadRequestException('Ngày áp dụng không hợp lệ');
    if (validTo !== null && !isValidDateKey(validTo)) {
      throw new BadRequestException('Ngày kết thúc không hợp lệ');
    }
    if (validTo && validTo < dto.validFrom) {
      throw new BadRequestException('Ngày kết thúc phải sau ngày áp dụng');
    }
    const departmentIds = [...new Set(dto.departmentIds ?? fallbackDepartmentIds)];
    const toCheck = departmentIds.filter((id) => !knownDepartmentIds.includes(id));
    if (toCheck.length) {
      const known = await this.departmentRepository.count({
        where: { storeId, id: In(toCheck) },
      });
      if (known !== toCheck.length) {
        throw new BadRequestException('Có bộ phận không thuộc cửa hàng');
      }
    }
    return {
      title,
      kind: dto.kind,
      // Multipart đổi xuống dòng thành CRLF; so sánh nội dung và ô soạn cần LF.
      content: (dto.content ?? '').replace(/\r\n?/g, '\n').trim(),
      validFrom: dto.validFrom,
      validTo,
      departmentIds,
    };
  }

  private assertHasBody(content: string, files: StoreDocumentFile[]) {
    if (!content && !files.length) {
      throw new BadRequestException('Hãy nhập nội dung hoặc đính kèm tệp');
    }
  }

  /** Tệp cũ chỉ lấy từ bài gốc theo URL: client không tự khai được đường dẫn tệp. */
  private mergeFiles(
    current: StoreDocumentFile[],
    keptUrls: string[],
    uploaded: Express.Multer.File[] | undefined,
  ): StoreDocumentFile[] {
    const kept = new Set(keptUrls);
    const files = [
      ...current.filter((file) => kept.has(file.url)),
      ...(uploaded ?? []).map((file) => ({
        name: decodeUploadedFileName(file.originalname),
        url: `/uploads/${file.filename}`,
        key: file.filename,
        type: file.mimetype,
        size: file.size,
      })),
    ];
    if (files.length > MAX_FILES) {
      throw new BadRequestException(`Tối đa ${MAX_FILES} tệp đính kèm`);
    }
    return files;
  }

  private summary(doc: StoreDocument, departments: Map<string, string>, today: string) {
    return {
      id: doc.id,
      kind: doc.kind,
      title: doc.title,
      validFrom: doc.validFrom,
      validTo: doc.validTo,
      status: documentStatus(doc, today),
      departmentIds: doc.departmentIds ?? [],
      departments: (doc.departmentIds ?? []).flatMap((id) => {
        const name = departments.get(id);
        return name ? [{ id, name }] : [];
      }),
      createdByName: doc.createdByName,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private mineSummary(
    doc: StoreDocument,
    profile: Pick<EmployeeProfile, 'department'>,
    view: StoreDocumentView | null | undefined,
  ) {
    return {
      id: doc.id,
      kind: doc.kind,
      title: doc.title,
      validFrom: doc.validFrom,
      validTo: doc.validTo,
      departmentLabel: profile.department?.name ?? 'Tất cả nhân viên',
      revision: doc.contentRevision,
      ...currentViewProgress(view, doc.contentRevision),
    };
  }

  /**
   * "Lưu & Thông báo": báo cho những người bài áp dụng. Chạy nền và không làm
   * hỏng lần lưu; bài đã ngừng hoặc hết hạn thì không báo.
   */
  private notifyAudience(doc: StoreDocument, action: 'mới' | 'cập nhật') {
    if (!isDocumentOpen(doc, vnDateString())) return;
    void (async () => {
      const audience = await this.loadAudience(doc.storeId);
      const members = audience.filter((person) =>
        documentAppliesTo(doc.departmentIds, person.departmentId),
      );
      for (const person of members) {
        if (!person.accountId) continue;
        try {
          await this.notificationsService.create({
            accountId: person.accountId,
            storeId: doc.storeId,
            title: `${KIND_LABEL[doc.kind]} ${action}`,
            content: doc.title,
            type: NotificationType.SYSTEM,
            actionUrl: STAFF_DOCUMENTS_ROUTE,
            metadata: { type: 'STORE_DOCUMENT', documentId: doc.id, storeId: doc.storeId },
          });
        } catch (error) {
          this.logger.warn(
            `[StoreDocumentNotify] send failed for ${person.id}: ${error instanceof Error ? error.message : 'unknown'}`,
          );
        }
      }
    })().catch((error: unknown) => {
      this.logger.warn(
        `[StoreDocumentNotify] failed for ${doc.id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    });
  }
}
