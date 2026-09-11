import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';

import { AccountStatus } from '../accounts/entities/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import {
  NotificationPriority,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  JobApplication,
  JobApplicationStatus,
} from './entities/job-application.entity';
import {
  EmployeeProfile,
  EmploymentStatus,
} from './entities/employee-profile.entity';
import { Store, StoreStatus } from './entities/store.entity';
import { StoresService } from './stores.service';
import { sanitizeDisplayName } from './job-application.text';
import {
  AcceptJobApplicationDto,
  CreateJobApplicationDto,
  JobApplicationItemDto,
  ListJobApplicationsQueryDto,
  MyJobApplicationDto,
  RejectJobApplicationDto,
} from './dto/job-application.dto';

/**
 * Staff-initiated job applications.
 *
 * Kept out of `StoresService` deliberately: that class is already ~16k lines,
 * and the newer request/workflow subsystems in this module
 * (`ShiftEndWorkflowService`, `ShiftAggregationService`) are separate services
 * that own their repositories and take the caller's account id on every
 * mutation. This follows that precedent.
 *
 * Invariant carried over from `docs/staff-self-signup.md`: an application never
 * creates an `EmployeeProfile`. Only the owner accepting one does, and that
 * delegates to the existing attach flow rather than reimplementing hiring.
 */
@Injectable()
export class JobApplicationService {
  private readonly logger = new Logger(JobApplicationService.name);

  constructor(
    @InjectRepository(JobApplication)
    private readonly applicationRepository: Repository<JobApplication>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(EmployeeProfile)
    private readonly profileRepository: Repository<EmployeeProfile>,
    private readonly accountsService: AccountsService,
    private readonly notificationsService: NotificationsService,
    private readonly storesService: StoresService,
  ) {}

  // ─── shared guards ────────────────────────────────────────────────────────

  /** Mirrors the store-discovery gate: active account, not already employed. */
  private async assertEligibleApplicant(accountId: string) {
    const account = await this.accountsService.findById(accountId);
    if (!account || account.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'JOB_APPLICATION_NOT_AVAILABLE',
        message: 'Tài khoản không thể ứng tuyển.',
      });
    }
    const employed = await this.profileRepository
      .createQueryBuilder('profile')
      .where('profile.accountId = :accountId', { accountId })
      .andWhere('profile.employmentStatus != :terminated', {
        terminated: EmploymentStatus.TERMINATED,
      })
      .getExists();
    if (employed) {
      throw new ForbiddenException({
        code: 'JOB_APPLICATION_NOT_AVAILABLE',
        message: 'Tài khoản đã trực thuộc cửa hàng.',
      });
    }
    return account;
  }

  /**
   * Local owner check rather than reaching into StoresService, so this service
   * owns its own authorization and stays independently testable.
   */
  private async assertStoreOwner(storeId: string, ownerAccountId: string) {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId', 'name', 'status'],
    });
    if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
    if (!ownerAccountId || store.ownerAccountId !== ownerAccountId) {
      throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
    }
    return store;
  }

  // ─── staff: submit ────────────────────────────────────────────────────────

  async apply(
    accountId: string,
    storeId: string,
    dto: CreateJobApplicationDto,
  ): Promise<JobApplicationItemDto> {
    await this.assertEligibleApplicant(accountId);

    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'name', 'status', 'ownerAccountId'],
    });
    if (!store || store.status !== StoreStatus.ACTIVE) {
      throw new NotFoundException('Cửa hàng không tồn tại');
    }

    await this.assertApplyRateLimit(accountId);

    if (store.ownerAccountId === accountId) {
      throw new ForbiddenException({
        code: 'JOB_APPLICATION_NOT_AVAILABLE',
        message: 'Bạn là chủ cửa hàng này.',
      });
    }

    const existing = await this.applicationRepository.findOne({
      where: { storeId, accountId, status: JobApplicationStatus.PENDING },
    });
    if (existing) {
      throw new ConflictException({
        code: 'JOB_APPLICATION_ALREADY_SENT',
        message: 'Bạn đã gửi thông tin ứng tuyển tới cửa hàng này.',
      });
    }

    let saved: JobApplication;
    try {
      saved = await this.applicationRepository.save(
        this.applicationRepository.create({
          storeId,
          accountId,
          fullName: dto.fullName,
          phone: dto.phone,
          email: dto.email ?? null,
          introduction: dto.introduction ?? null,
          status: JobApplicationStatus.PENDING,
        }),
      );
    } catch (error: any) {
      // The partial unique index is the real guard against a double submit.
      if (error?.code === '23505') {
        throw new ConflictException({
          code: 'JOB_APPLICATION_ALREADY_SENT',
          message: 'Bạn đã gửi thông tin ứng tuyển tới cửa hàng này.',
        });
      }
      throw error;
    }

    await this.notifyOwnerOfApplication(store.ownerAccountId, store.name, saved);
    return this.toItem(saved, null);
  }

  /** Bounds how many owners one account can reach in a window. */
  private async assertApplyRateLimit(accountId: string): Promise<void> {
    const recent = await this.applicationRepository.count({
      where: {
        accountId,
        createdAt: MoreThan(new Date(Date.now() - APPLY_WINDOW_MS)),
      },
    });
    if (recent >= APPLY_LIMIT) {
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Bạn đã gửi quá nhiều đơn ứng tuyển. Vui lòng thử lại sau.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Applications by the calling account, used by the staff discovery screen. */
  async listMine(accountId: string): Promise<MyJobApplicationDto[]> {
    const rows = await this.applicationRepository.find({
      where: { accountId },
      order: { createdAt: 'DESC', id: 'DESC' },
      select: ['id', 'storeId', 'status', 'createdAt'],
      // The row count grows with every store applied to; keep it bounded.
      take: MAX_MY_APPLICATIONS,
    });
    // Collapse to the newest row per store so the screen has one status each.
    const newestByStore = new Map<string, MyJobApplicationDto>();
    for (const row of rows) {
      if (newestByStore.has(row.storeId)) continue;
      newestByStore.set(row.storeId, {
        id: row.id,
        storeId: row.storeId,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      });
    }
    return [...newestByStore.values()];
  }

  // ─── owner: inbox ─────────────────────────────────────────────────────────

  async listForStore(
    storeId: string,
    ownerAccountId: string,
    query: ListJobApplicationsQueryDto,
  ): Promise<{ items: JobApplicationItemDto[]; page: number; limit: number; hasMore: boolean }> {
    await this.assertStoreOwner(storeId, ownerAccountId);

    const builder = this.applicationRepository
      .createQueryBuilder('application')
      .leftJoinAndSelect('application.account', 'account')
      .where('application.storeId = :storeId', { storeId });
    if (query.status) {
      builder.andWhere('application.status = :status', { status: query.status });
    }

    const rows = await builder
      // A tiebreaker keeps pagination stable when rows share a timestamp.
      .orderBy('application.createdAt', 'DESC')
      .addOrderBy('application.id', 'DESC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit + 1)
      .getMany();

    return {
      items: rows
        .slice(0, query.limit)
        .map((row) => this.toItem(row, row.account?.avatar ?? null)),
      page: query.page,
      limit: query.limit,
      hasMore: rows.length > query.limit,
    };
  }

  // ─── owner: decide ────────────────────────────────────────────────────────

  async accept(
    storeId: string,
    applicationId: string,
    ownerAccountId: string,
    dto: AcceptJobApplicationDto,
  ) {
    const store = await this.assertStoreOwner(storeId, ownerAccountId);
    const application = await this.loadPending(storeId, applicationId);

    // Claim the application before doing any work. A second tap finds zero
    // affected rows and is rejected rather than attaching the employee twice.
    const claimed = await this.applicationRepository.update(
      { id: application.id, status: JobApplicationStatus.PENDING },
      {
        status: JobApplicationStatus.ACCEPTED,
        reviewedById: ownerAccountId,
        reviewedAt: new Date(),
      },
    );
    if (!claimed.affected) {
      throw new ConflictException({
        code: 'JOB_APPLICATION_ALREADY_REVIEWED',
        message: 'Đơn ứng tuyển đã được xử lý.',
      });
    }

    let employee: any;
    try {
      // Hire the account that actually applied. The phone captured on the form
      // is applicant-supplied contact information and must never select which
      // account gets attached — otherwise an applicant could type someone
      // else's number and have that person enrolled when the owner accepts.
      employee = await this.storesService.addEmployee(
        storeId,
        application.accountId,
        dto,
        ownerAccountId,
      );
    } catch (error) {
      // Release the claim so the owner can correct the input and retry.
      await this.applicationRepository.update(
        { id: application.id, status: JobApplicationStatus.ACCEPTED },
        {
          status: JobApplicationStatus.PENDING,
          reviewedById: null,
          reviewedAt: null,
        },
      );
      throw error;
    }

    // `addEmployee` resolves to `{ profile, monthlySummary, recentActivities }`,
    // so the id lives under `profile`, not at the top level.
    const employeeProfileId: string | undefined = employee?.profile?.id;
    if (employeeProfileId) {
      await this.applicationRepository.update(
        { id: application.id },
        { employeeProfileId },
      );
    } else {
      this.logger.warn(
        `[JobApplication] accepted ${application.id} but could not resolve the created profile id`,
      );
    }

    await this.notifyApplicantAccepted(application, store.name);

    // F6: the full employee payload carries the applicant's identity document
    // and bank details. The owner can load those from the employee detail
    // endpoint; the hire response only needs to confirm what happened.
    return {
      applicationId: application.id,
      status: JobApplicationStatus.ACCEPTED,
      employeeProfileId: employeeProfileId ?? null,
    };
  }

  async reject(
    storeId: string,
    applicationId: string,
    ownerAccountId: string,
    dto: RejectJobApplicationDto,
  ): Promise<JobApplicationItemDto> {
    await this.assertStoreOwner(storeId, ownerAccountId);
    const application = await this.loadPending(storeId, applicationId);

    const claimed = await this.applicationRepository.update(
      { id: application.id, status: JobApplicationStatus.PENDING },
      {
        status: JobApplicationStatus.REJECTED,
        reviewedById: ownerAccountId,
        reviewedAt: new Date(),
        rejectionReason: dto.reason ?? null,
        // The decision is final, so the applicant's contact details serve no
        // further purpose for this store.
        ...REDACTED_CONTACT,
      },
    );
    if (!claimed.affected) {
      throw new ConflictException({
        code: 'JOB_APPLICATION_ALREADY_REVIEWED',
        message: 'Đơn ứng tuyển đã được xử lý.',
      });
    }

    const updated = await this.applicationRepository.findOne({
      where: { id: application.id },
    });
    return this.toItem(updated as JobApplication, null);
  }

  /**
   * The applicant withdraws their own pending application. Contact details are
   * cleared immediately: the applicant has asked to be removed from
   * consideration, so the store has no further need for them.
   */
  async withdraw(
    storeId: string,
    applicationId: string,
    accountId: string,
  ): Promise<{ storeId: string; status: JobApplicationStatus }> {
    const application = await this.applicationRepository.findOne({
      where: { id: applicationId },
    });
    if (!application || application.storeId !== storeId) {
      throw new NotFoundException('Không tìm thấy đơn ứng tuyển');
    }
    if (!accountId || application.accountId !== accountId) {
      throw new ForbiddenException('Bạn chỉ có thể thu hồi đơn của chính mình');
    }

    const claimed = await this.applicationRepository.update(
      { id: application.id, status: JobApplicationStatus.PENDING },
      {
        status: JobApplicationStatus.CANCELLED,
        reviewedAt: new Date(),
        ...REDACTED_CONTACT,
      },
    );
    if (!claimed.affected) {
      throw new ConflictException({
        code: 'JOB_APPLICATION_ALREADY_REVIEWED',
        message: 'Đơn ứng tuyển đã được xử lý.',
      });
    }
    return { storeId, status: JobApplicationStatus.CANCELLED };
  }

  /**
   * Clears the contact details of applications reviewed longer ago than the
   * retention window. The row and its decision survive; only the applicant's
   * phone, email and free-text introduction are removed.
   *
   * Driven by the daily cron in `StoresCronService`.
   */
  async redactStaleContactDetails(now = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - CONTACT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const result = await this.applicationRepository.update(
      {
        status: Not(JobApplicationStatus.PENDING),
        reviewedAt: LessThan(cutoff),
        contactRedactedAt: IsNull(),
      },
      { ...REDACTED_CONTACT },
    );
    const affected = result.affected ?? 0;
    if (affected) {
      this.logger.log(
        `[JobApplication] redacted contact details on ${affected} application(s)`,
      );
    }
    return affected;
  }

  private async loadPending(storeId: string, applicationId: string) {
    const application = await this.applicationRepository.findOne({
      where: { id: applicationId },
    });
    if (!application || application.storeId !== storeId) {
      throw new NotFoundException('Không tìm thấy đơn ứng tuyển');
    }
    if (application.status !== JobApplicationStatus.PENDING) {
      throw new BadRequestException({
        code: 'JOB_APPLICATION_ALREADY_REVIEWED',
        message: 'Đơn ứng tuyển đã được xử lý.',
      });
    }
    return application;
  }

  // ─── notifications ────────────────────────────────────────────────────────

  /**
   * Notification delivery must never decide whether an application succeeded.
   * `NotificationsService.create` awaits the Expo push and rejects if it fails,
   * so every call here is contained.
   */
  private async notifySafely(
    label: string,
    send: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.warn(
        `[JobApplication] ${label} notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async notifyOwnerOfApplication(
    ownerAccountId: string,
    storeName: string,
    application: JobApplication,
  ) {
    if (!ownerAccountId) return;
    await this.notifySafely('owner-new-application', () =>
      this.notificationsService.create({
        accountId: ownerAccountId,
        storeId: application.storeId,
        title: 'Có nhân viên ứng tuyển',
        // Sanitised again here so a row written by an older build cannot put
        // control characters into the owner's notification or push payload.
        content: `${sanitizeDisplayName(application.fullName) || 'Một ứng viên'} vừa gửi thông tin ứng tuyển vào ${storeName}.`,
        type: NotificationType.SYSTEM,
        priority: NotificationPriority.HIGH,
        actionUrl: OWNER_APPLICATIONS_ROUTE,
        metadata: {
          type: 'JOB_APPLICATION_SUBMITTED',
          applicationId: application.id,
          storeId: application.storeId,
          // `NotificationsService.create` spreads metadata into the push data
          // payload, and the owner app's push router reads `screen`, so the
          // deep link works with no client push change.
          screen: OWNER_APPLICATIONS_ROUTE,
        },
      }),
    );
  }

  private async notifyApplicantAccepted(
    application: JobApplication,
    storeName: string,
  ) {
    await this.notifySafely('applicant-accepted', () =>
      this.notificationsService.create({
        accountId: application.accountId,
        storeId: application.storeId,
        title: 'Chúc mừng bạn đã ứng tuyển thành công',
        content: `Chủ cửa hàng ${storeName} vừa đồng ý nhận bạn vào làm việc.`,
        type: NotificationType.SYSTEM,
        priority: NotificationPriority.HIGH,
        actionUrl: STAFF_HOME_ROUTE,
        metadata: {
          type: 'JOB_APPLICATION_ACCEPTED',
          storeId: application.storeId,
          screen: STAFF_HOME_ROUTE,
        },
      }),
    );
  }

  private toItem(
    row: JobApplication,
    avatarUrl: string | null,
  ): JobApplicationItemDto {
    return {
      id: row.id,
      storeId: row.storeId,
      accountId: row.accountId,
      fullName: row.fullName,
      phone: row.phone,
      email: row.email,
      introduction: row.introduction,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      rejectionReason: row.rejectionReason,
      avatarUrl,
    };
  }
}

/** Upper bound on the per-account application list. */
const MAX_MY_APPLICATIONS = 200;

/**
 * Applications one account may submit inside the window. Derived from
 * `created_at`, so the limit holds across processes and restarts — the same
 * approach `AuthService` uses for OTP sends. The per-(store, account) unique
 * index already prevents repeat applications to a single store; this bounds
 * fan-out across many stores, which is what reaches owners' notification trays.
 */
const APPLY_LIMIT = 10;
const APPLY_WINDOW_MS = 60 * 60 * 1000;

/**
 * How long a reviewed application keeps the applicant's contact details.
 * After this the contact fields are cleared by a daily job; the row itself is
 * kept so the decision history and the unique-index behaviour survive.
 */
const CONTACT_RETENTION_DAYS = 90;

/** The contact fields cleared by a withdrawal, a rejection, or the sweep. */
const REDACTED_CONTACT = {
  phone: null,
  email: null,
  introduction: null,
  contactRedactedAt: new Date(),
} as const;

/** Owner app route showing the applications inbox. */
const OWNER_APPLICATIONS_ROUTE = '/(home)/recruitment';
/** Staff app root; a newly hired staff lands on their store home. */
const STAFF_HOME_ROUTE = '/';
