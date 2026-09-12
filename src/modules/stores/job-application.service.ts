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

import { Account, AccountStatus } from '../accounts/entities/account.entity';
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

    // Any prior profile at this store — including a soft-deleted or terminated
    // one — blocks the attach flow with EMPLOYEE_REHIRE_REQUIRES_RESTORE. Left
    // unchecked here, a former employee could apply, wait, and have the owner
    // fill in the entire three-step hiring form before the backend refused it,
    // losing the form on every retry. Refuse at submission time instead, with
    // an error the applicant can act on.
    const priorProfile = await this.profileRepository
      .createQueryBuilder('profile')
      .withDeleted()
      .where('profile.accountId = :accountId', { accountId })
      .andWhere('profile.storeId = :storeId', { storeId })
      .getOne();
    if (priorProfile) {
      throw new ConflictException({
        code: 'JOB_APPLICATION_REHIRE_REQUIRES_RESTORE',
        message:
          'Bạn đã từng làm việc tại cửa hàng này. Vui lòng liên hệ chủ cửa hàng để được khôi phục hồ sơ.',
      });
    }

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
          gender: dto.gender ?? null,
          birthday: dto.birthday ?? null,
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

    await this.openPendingProfile(saved);
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
      // A throw here does NOT prove the hire did not happen.
      // `attachExistingEmployee` commits its transaction and only then runs a
      // large read to build the response; a failure in that read leaves the
      // employee, contract, salary row and asset assignments durably created.
      //
      // Blindly releasing the claim in that case put the row back to PENDING
      // while the applicant was already employed, so every retry then failed
      // with EMPLOYEE_REHIRE_REQUIRES_RESTORE and the application could never
      // be accepted again. Check first.
      const hired = await this.profileRepository.findOne({
        where: { accountId: application.accountId, storeId },
        select: ['id'],
      });

      if (!hired) {
        await this.releaseClaim(application.id, error);
        throw error;
      }

      this.logger.warn(
        `[JobApplication] ${application.id}: hire committed but the follow-up read failed; completing the acceptance. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      employee = { profile: { id: hired.id } };
    }

    // `addEmployee` resolves to `{ profile, monthlySummary, recentActivities }`,
    // so the id lives under `profile`, not at the top level.
    const employeeProfileId: string | undefined = employee?.profile?.id;

    await this.backfillAccountIdentity(application);

    // The durable outcome — employee hired, application ACCEPTED — is already
    // achieved. Recording the link and notifying are bookkeeping: a failure in
    // either must not surface as a failed hire, because the owner would retry
    // and be told the application was already reviewed.
    if (employeeProfileId) {
      try {
        await this.applicationRepository.update(
          { id: application.id },
          { employeeProfileId },
        );
      } catch (linkError) {
        this.logger.error(
          `[JobApplication] ${application.id}: hired ${employeeProfileId} but could not record the link: ${
            linkError instanceof Error ? linkError.message : String(linkError)
          }`,
        );
      }
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

  /**
   * Puts a claimed application back to PENDING after a hire that never
   * committed. Never throws: the caller is already propagating the real
   * failure, and losing that in favour of a secondary error would hide the
   * cause. A release can legitimately fail — for instance if the applicant
   * submitted a fresh application to the same store in the meantime, which the
   * partial unique index rejects — so it is logged with the row id instead.
   */
  private async releaseClaim(
    applicationId: string,
    cause: unknown,
  ): Promise<void> {
    try {
      await this.applicationRepository.update(
        { id: applicationId, status: JobApplicationStatus.ACCEPTED },
        {
          status: JobApplicationStatus.PENDING,
          reviewedById: null,
          reviewedAt: null,
        },
      );
    } catch (releaseError) {
      this.logger.error(
        `[JobApplication] ${applicationId}: could not release the claim after a failed hire (${
          cause instanceof Error ? cause.message : String(cause)
        }); release failed with: ${
          releaseError instanceof Error
            ? releaseError.message
            : String(releaseError)
        }`,
      );
    }
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
        ...redactedContact(),
      },
    );
    if (!claimed.affected) {
      throw new ConflictException({
        code: 'JOB_APPLICATION_ALREADY_REVIEWED',
        message: 'Đơn ứng tuyển đã được xử lý.',
      });
    }

    await this.closePendingProfile(application);

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
        ...redactedContact(),
      },
    );
    if (!claimed.affected) {
      throw new ConflictException({
        code: 'JOB_APPLICATION_ALREADY_REVIEWED',
        message: 'Đơn ứng tuyển đã được xử lý.',
      });
    }
    await this.closePendingProfile(application);
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

    // Reviewed applications: keyed on when the decision was made.
    const reviewed = await this.applicationRepository.update(
      {
        status: Not(JobApplicationStatus.PENDING),
        reviewedAt: LessThan(cutoff),
        contactRedactedAt: IsNull(),
      },
      redactedContact(),
    );

    // Applications nobody ever acted on. These matched neither condition above
    // — a PENDING row has a null `reviewed_at` — so a store that went quiet
    // kept every applicant's phone, email and free-text introduction forever,
    // contradicting the retention policy this job exists to enforce.
    //
    // They are expired rather than only redacted: without contact details the
    // owner cannot act on them anyway, and leaving them PENDING would keep the
    // slot occupied against the one-open-application-per-store index and stop
    // the applicant reapplying. The applicant sees the store become available
    // again in discovery.
    const abandoned = await this.applicationRepository.update(
      {
        status: JobApplicationStatus.PENDING,
        createdAt: LessThan(cutoff),
      },
      {
        status: JobApplicationStatus.CANCELLED,
        ...redactedContact(),
      },
    );

    const affected = (reviewed.affected ?? 0) + (abandoned.affected ?? 0);
    if (affected) {
      this.logger.log(
        `[JobApplication] redacted ${reviewed.affected ?? 0} reviewed and expired ${
          abandoned.affected ?? 0
        } abandoned application(s)`,
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

  /**
   * Opens the store-side profile the moment the application is sent.
   *
   * The owner's employee list is driven by EmployeeProfile rows, so an
   * applicant had no record at the store until the hire completed. Creating it
   * up front — as PENDING, which is deliberately not an employed status — gives
   * the application a real profile that acceptance then promotes in place.
   *
   * Best effort: the application is the durable record, and acceptance still
   * creates a profile from scratch when this row is missing, so a failure here
   * must not cost the applicant their submission.
   */
  private async openPendingProfile(application: JobApplication) {
    // Identity first: every employee list reads account.fullName, and this is
    // the point at which the applicant has told us who they are.
    await this.backfillAccountIdentity(application);
    try {
      await this.profileRepository.save(
        this.profileRepository.create({
          storeId: application.storeId,
          accountId: application.accountId,
          employmentStatus: EmploymentStatus.PENDING,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `[JobApplication] ${application.id}: could not open the pending profile: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Removes the placeholder profile when an application ends without a hire.
   *
   * Hard delete, not soft: `apply` refuses a new application whenever *any*
   * profile for this (store, account) exists, deleted ones included, so a
   * tombstone here would lock a rejected applicant out of ever re-applying.
   */
  private async closePendingProfile(application: JobApplication) {
    try {
      await this.profileRepository.delete({
        storeId: application.storeId,
        accountId: application.accountId,
        employmentStatus: EmploymentStatus.PENDING,
      });
    } catch (error) {
      this.logger.warn(
        `[JobApplication] ${application.id}: could not close the pending profile: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Copies the identity the applicant typed onto their own account, but only
   * into fields that are still empty.
   *
   * `EmployeeProfile` stores no name of its own — every screen that lists
   * employees reads `account.fullName`. An account created by phone-only
   * signup has none, so a hire made through this flow showed up nameless in
   * the owner's employee list. The application form is the one place the
   * person has actually told us who they are.
   *
   * Never overwrites: a value already on the account was set by its owner and
   * outranks anything typed into an application form.
   */
  private async backfillAccountIdentity(application: JobApplication) {
    try {
      const account = await this.accountsService.findById(application.accountId);
      if (!account) return;

      const patch: Partial<Account> = {};
      if (!account.fullName?.trim() && application.fullName?.trim()) {
        patch.fullName = application.fullName.trim();
      }
      if (!account.gender && application.gender) {
        patch.gender = application.gender;
      }
      if (!account.birthday && application.birthday) {
        patch.birthday = application.birthday as unknown as Date;
      }
      if (Object.keys(patch).length === 0) return;

      await this.accountsService.update(application.accountId, patch);
    } catch (error) {
      // Bookkeeping, exactly like the link and the notification below: the
      // hire has already committed and must not be reported as failed.
      this.logger.warn(
        `[JobApplication] ${application.id}: hired but could not backfill account identity: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
      gender: row.gender,
      birthday: row.birthday,
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

/**
 * The contact fields cleared by a withdrawal, a rejection, or the sweep.
 *
 * This must be a function. As an object literal the `new Date()` was evaluated
 * once when the module was first imported, so every redacted row recorded the
 * process start time instead of the moment of redaction — producing rows whose
 * `contact_redacted_at` predated their own `created_at`, and making the column
 * useless as evidence that the retention policy ran.
 */
const redactedContact = () => ({
  phone: null,
  email: null,
  introduction: null,
  // Gender and birthday are personal data the store no longer needs once the
  // decision is final, so they are cleared on the same schedule as the rest.
  gender: null,
  birthday: null,
  contactRedactedAt: new Date(),
});

/**
 * Owner app route showing the applications inbox.
 *
 * The tab matters: the recruitment screen defaults to the job-postings tab, so
 * without it the owner lands somewhere the candidate list is not even mounted.
 */
const OWNER_APPLICATIONS_ROUTE = '/(home)/recruitment?tab=candidates';
/** Staff app root; a newly hired staff lands on their store home. */
const STAFF_HOME_ROUTE = '/';
