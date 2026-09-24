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
  EMPLOYED_STATUSES,
  EmployeeProfile,
  EmploymentStatus,
} from './entities/employee-profile.entity';
import { EmployeeMonthlySummary } from './entities/employee-monthly-summary.entity';
import { Store, StoreStatus } from './entities/store.entity';
import { StoresService } from './stores.service';
import { sanitizeDisplayName } from './job-application.text';
import {
  JobApplicationSelfieStorage,
  UploadedSelfie,
  jobApplicationSelfieUrl,
  selfieContentType,
  selfieInvalid,
} from './job-application-selfie.storage';
import {
  FormerEmployment,
  FormerEmploymentRecord,
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
    private readonly selfieStorage: JobApplicationSelfieStorage,
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

  /**
   * Submits an application, optionally with a selfie multer has already
   * written to the private selfie directory.
   *
   * File lifecycle: until the row is saved, every failure (bad content,
   * eligibility, rate limit, duplicate) deletes the uploaded file. The
   * filename is persisted in the same INSERT as the application, so a saved
   * row and its file appear together. Nothing after the save throws — the
   * remaining steps are best-effort — which is what lets
   * `JobApplicationSelfieCleanupInterceptor` treat any error as "file
   * unreferenced".
   */
  async apply(
    accountId: string,
    storeId: string,
    dto: CreateJobApplicationDto,
    selfie?: UploadedSelfie,
  ): Promise<JobApplicationItemDto> {
    let saved: JobApplication;
    let storeName: string;
    let ownerAccountId: string;
    try {
      if (selfie && !(await this.selfieStorage.verify(selfie))) {
        throw selfieInvalid();
      }
      ({ saved, storeName, ownerAccountId } = await this.insertApplication(
        accountId,
        storeId,
        dto,
        selfie?.filename ?? null,
      ));
    } catch (error) {
      if (selfie) await this.selfieStorage.remove(selfie.filename);
      throw error;
    }

    try {
      await this.openPendingProfile(saved);
      await this.notifyOwnerOfApplication(ownerAccountId, storeName, saved);
    } catch (error) {
      // Both steps already contain their own failures; this only guarantees
      // the documented "no throw after save" contract.
      this.logger.warn(
        `[JobApplication] ${saved.id}: post-submit bookkeeping failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return this.toItem(saved, null);
  }

  /** Every business rule of `apply`, ending in the INSERT. */
  private async insertApplication(
    accountId: string,
    storeId: string,
    dto: CreateJobApplicationDto,
    selfiePath: string | null,
  ): Promise<{ saved: JobApplication; storeName: string; ownerAccountId: string }> {
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
    // Only a live job blocks a new application.
    //
    // This used to reject on *any* prior profile, soft-deleted ones included,
    // so anyone who had ever worked at the store was locked out of applying
    // again for good — every attempt came back 409 while the message told them
    // to ask the owner for a restore that no flow provided. Acceptance now
    // revives the old profile instead, which is what that message promised.
    const priorProfile = await this.profileRepository
      .createQueryBuilder('profile')
      .where('profile.accountId = :accountId', { accountId })
      .andWhere('profile.storeId = :storeId', { storeId })
      .andWhere('profile.employmentStatus IN (:...employed)', {
        employed: [...EMPLOYED_STATUSES],
      })
      .getOne();
    if (priorProfile) {
      throw new ConflictException({
        code: 'JOB_APPLICATION_ALREADY_EMPLOYED',
        message: 'Bạn đang làm việc tại cửa hàng này.',
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
          address: dto.address ?? null,
          selfiePath,
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

    return { saved, storeName: store.name, ownerAccountId: store.ownerAccountId };
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
      // `store` is joined for its name: the applicant's history is unreadable
      // as a list of uuids.
      relations: ['store'],
      select: {
        id: true,
        storeId: true,
        status: true,
        createdAt: true,
        store: { id: true, name: true, addressLine: true },
      },
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
        // A store deleted since the application still leaves a readable row.
        storeName: row.store?.name || 'Cửa hàng không còn tồn tại',
        storeAddress: row.store?.addressLine ?? null,
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

    const page = rows.slice(0, query.limit);
    const history = await this.loadFormerEmployment(
      storeId,
      [...new Set(page.map((row) => row.accountId))],
    );

    return {
      items: page.map((row) =>
        this.toItem(
          row,
          row.account?.avatar ?? null,
          history.get(row.accountId) ?? null,
        ),
      ),
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
      // Additive: `{ revived, currentMonthPayslipLocked }` when the hire
      // revived a former employee's profile; null otherwise or when the
      // follow-up read failed (the fallback object carries no rehire info).
      rehire: employee?.rehire ?? null,
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
        // further purpose for this store. The selfie is kept until the
        // retention sweep (policy unchanged), which deletes it with the file.
        ...redactedContact({ keepSelfie: true }),
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
    // After the DB no longer references it; best-effort, never throws.
    if (application.selfiePath) {
      await this.selfieStorage.remove(application.selfiePath);
    }
    await this.closePendingProfile(application);
    // Reached only after the conditional claim succeeded, so a repeated
    // withdraw (Conflict above) never notifies the owner twice.
    await this.notifyOwnerOfWithdrawal(application);
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

    // Selfies first, row by row, because each file must be deleted and the
    // bulk updates below cannot report which rows they touched. The bulk
    // updates keep `selfie_path`, so a row this pass has not reached yet
    // (batch cap) is picked up tomorrow instead of losing its file reference.
    const selfies = await this.purgeStaleSelfies(cutoff);

    // Reviewed applications: keyed on when the decision was made.
    const reviewed = await this.applicationRepository.update(
      {
        status: Not(JobApplicationStatus.PENDING),
        reviewedAt: LessThan(cutoff),
        contactRedactedAt: IsNull(),
      },
      redactedContact({ keepSelfie: true }),
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
        ...redactedContact({ keepSelfie: true }),
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
    if (selfies) {
      this.logger.log(`[JobApplication] deleted ${selfies} stale selfie(s)`);
    }
    return affected;
  }

  /**
   * Clears `selfie_path` and deletes the file for every application past the
   * retention window: reviewed before the cutoff, or never reviewed and
   * created before it (abandoned PENDING, and the CANCELLED rows the sweep
   * expired, which have no `reviewed_at`).
   *
   * Each row is cleared with a conditional UPDATE repeating the eligibility
   * test and the exact filename, so a row accepted or withdrawn between the
   * read and the write is left alone, and the file is deleted only after its
   * reference is gone. Returns the number of rows cleared.
   */
  private async purgeStaleSelfies(cutoff: Date): Promise<number> {
    let cleared = 0;
    for (let batch = 0; batch < SELFIE_PURGE_MAX_BATCHES; batch += 1) {
      const rows = await this.applicationRepository.find({
        where: [
          { selfiePath: Not(IsNull()), reviewedAt: LessThan(cutoff) },
          {
            selfiePath: Not(IsNull()),
            reviewedAt: IsNull(),
            createdAt: LessThan(cutoff),
          },
        ],
        select: ['id', 'selfiePath', 'reviewedAt'],
        order: { id: 'ASC' },
        take: SELFIE_PURGE_BATCH_SIZE,
      });
      if (!rows?.length) break;

      let progressed = 0;
      for (const row of rows) {
        const result = await this.applicationRepository.update(
          row.reviewedAt
            ? { id: row.id, selfiePath: row.selfiePath as string, reviewedAt: LessThan(cutoff) }
            : {
                id: row.id,
                selfiePath: row.selfiePath as string,
                reviewedAt: IsNull(),
                createdAt: LessThan(cutoff),
              },
          { selfiePath: null, address: null },
        );
        if (!result.affected) continue;
        progressed += 1;
        await this.selfieStorage.remove(row.selfiePath);
      }
      cleared += progressed;
      // A full batch that changed nothing would be re-read forever.
      if (!progressed || rows.length < SELFIE_PURGE_BATCH_SIZE) break;
    }
    return cleared;
  }

  // ─── selfie read ──────────────────────────────────────────────────────────

  /**
   * Resolves the selfie file of one application for `accountId`.
   *
   * Readers: the owner of the application's store, or the applicant. This is
   * authorized here and not by `StoreOwnerOnlyGuard` — the route is left
   * undecorated so the guard passes it through, because the applicant is not
   * an owner. Every refusal (unknown id, wrong store, not a reader, no selfie,
   * unsafe name, missing file) is the same 404, so a non-reader learns nothing
   * about whether the application or its selfie exists.
   */
  async getSelfie(
    storeId: string,
    applicationId: string,
    accountId: string,
  ): Promise<{ absolutePath: string; contentType: string }> {
    const notFound = () =>
      new NotFoundException({
        code: 'JOB_APPLICATION_SELFIE_NOT_FOUND',
        message: 'Không tìm thấy ảnh chân dung',
      });
    if (!accountId) throw notFound();

    const application = await this.applicationRepository.findOne({
      where: { id: applicationId },
      select: ['id', 'storeId', 'accountId', 'selfiePath'],
    });
    if (!application || application.storeId !== storeId) throw notFound();

    let allowed = application.accountId === accountId;
    if (!allowed) {
      const store = await this.storeRepository.findOne({
        where: { id: application.storeId },
        select: ['id', 'ownerAccountId'],
      });
      allowed = !!store && store.ownerAccountId === accountId;
    }
    if (!allowed) throw notFound();

    const absolutePath = this.selfieStorage.resolve(application.selfiePath);
    if (!absolutePath || !(await this.selfieStorage.exists(application.selfiePath))) {
      throw notFound();
    }
    return {
      absolutePath,
      contentType: selfieContentType(application.selfiePath as string),
    };
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

  /**
   * Tells the owner an applicant withdrew. The whole lookup runs inside
   * `notifySafely`, so a failed store read or push never fails the withdraw.
   * `application` is the in-memory row loaded before the redaction, and only
   * the (sanitised) display name is used — no phone or email in the payload.
   */
  private async notifyOwnerOfWithdrawal(application: JobApplication) {
    await this.notifySafely('owner-application-withdrawn', async () => {
      const store = await this.storeRepository.findOne({
        where: { id: application.storeId },
        select: ['id', 'name', 'ownerAccountId'],
      });
      if (!store?.ownerAccountId) return;
      await this.notificationsService.create({
        accountId: store.ownerAccountId,
        storeId: application.storeId,
        title: 'Ứng viên đã thu hồi đơn',
        content: `${sanitizeDisplayName(application.fullName) || 'Một ứng viên'} đã thu hồi thông tin ứng tuyển vào ${store.name}.`,
        type: NotificationType.SYSTEM,
        priority: NotificationPriority.NORMAL,
        actionUrl: OWNER_APPLICATIONS_ROUTE,
        metadata: {
          type: 'JOB_APPLICATION_WITHDRAWN',
          applicationId: application.id,
          storeId: application.storeId,
          screen: OWNER_APPLICATIONS_ROUTE,
        },
      });
    });
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

  /**
   * Past-employment context for a batch of applicants at one store.
   *
   * Looked up once for the whole page rather than per row, and `withDeleted`
   * on purpose: an owner who removed someone from the list soft-deletes the
   * profile, and that is exactly the history the card needs to surface.
   */
  private async loadFormerEmployment(
    storeId: string,
    accountIds: string[],
  ): Promise<Map<string, FormerEmployment>> {
    const found = new Map<string, FormerEmployment>();
    if (accountIds.length === 0) return found;

    const profiles = await this.profileRepository
      .createQueryBuilder('profile')
      .withDeleted()
      // Why they left is the single most decision-changing fact here:
      // "hết hạn hợp đồng" and "đuổi việc" point opposite ways on a rehire.
      .leftJoinAndSelect('profile.terminationReason', 'terminationReason')
      .where('profile.storeId = :storeId', { storeId })
      .andWhere('profile.accountId IN (:...accountIds)', { accountIds })
      .getMany();

    const ended = profiles.filter(
      // Only a finished stint counts. Someone still employed is refused at
      // apply time, so a live profile here would be a stale row, not history.
      (profile) =>
        !!profile.deletedAt ||
        profile.employmentStatus === EmploymentStatus.TERMINATED,
    );
    if (ended.length === 0) return found;

    const record = await this.loadPastRecord(ended.map((p) => p.id));

    for (const profile of ended) {
      found.set(profile.accountId, {
        joinedAt: profile.joinedAt ? profile.joinedAt.toISOString() : null,
        leftAt: (profile.leftAt ?? profile.deletedAt)?.toISOString() ?? null,
        terminationReason: profile.terminationReason?.name ?? null,
        record: record.get(profile.id) ?? null,
      });
    }
    return found;
  }

  /**
   * The attendance record of a past stint, summed across its monthly rows.
   *
   * One grouped query for the whole page. Resolved through the profile
   * repository's manager rather than a new constructor argument — this
   * service is wired positionally in several specs, and widening the
   * constructor has broken them before.
   */
  private async loadPastRecord(
    profileIds: string[],
  ): Promise<Map<string, FormerEmploymentRecord>> {
    const byProfile = new Map<string, FormerEmploymentRecord>();
    if (profileIds.length === 0) return byProfile;

    const rows = await this.profileRepository.manager
      .getRepository(EmployeeMonthlySummary)
      .createQueryBuilder('summary')
      .select('summary.employeeProfileId', 'profileId')
      .addSelect('COALESCE(SUM(summary.completedShifts), 0)', 'completedShifts')
      .addSelect('COALESCE(SUM(summary.lateArrivalsCount), 0)', 'lateArrivals')
      .addSelect(
        'COALESCE(SUM(summary.unauthorizedLeavesCount), 0)',
        'unauthorizedLeaves',
      )
      .where('summary.employeeProfileId IN (:...profileIds)', { profileIds })
      .groupBy('summary.employeeProfileId')
      .getRawMany<{
        profileId: string;
        completedShifts: string;
        lateArrivals: string;
        unauthorizedLeaves: string;
      }>();

    for (const row of rows) {
      byProfile.set(row.profileId, {
        // SUM comes back as a string from pg.
        completedShifts: Number(row.completedShifts) || 0,
        lateArrivals: Number(row.lateArrivals) || 0,
        unauthorizedLeaves: Number(row.unauthorizedLeaves) || 0,
      });
    }
    return byProfile;
  }

  private toItem(
    row: JobApplication,
    avatarUrl: string | null,
    formerEmployment: FormerEmployment | null = null,
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
      address: row.address ?? null,
      selfieUrl: row.selfiePath
        ? jobApplicationSelfieUrl(row.storeId, row.id)
        : null,
      formerEmployment,
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
const redactedContact = ({ keepSelfie = false }: { keepSelfie?: boolean } = {}) => ({
  phone: null,
  email: null,
  introduction: null,
  // Gender and birthday are personal data the store no longer needs once the
  // decision is final, so they are cleared on the same schedule as the rest.
  gender: null,
  birthday: null,
  address: null,
  // Clearing `selfie_path` orphans a file unless the caller deletes it after
  // the update. `withdraw` does; rejection keeps the selfie until retention,
  // and the retention sweep clears selfies itself in `purgeStaleSelfies`.
  ...(keepSelfie ? {} : { selfiePath: null }),
  contactRedactedAt: new Date(),
});

/** Rows cleared per selfie purge query, and the per-run cap on queries. */
const SELFIE_PURGE_BATCH_SIZE = 200;
const SELFIE_PURGE_MAX_BATCHES = 50;

/**
 * Owner app route showing the applications inbox.
 *
 * The tab matters: the recruitment screen defaults to the job-postings tab, so
 * without it the owner lands somewhere the candidate list is not even mounted.
 */
const OWNER_APPLICATIONS_ROUTE = '/(home)/recruitment?tab=candidates';
/** Staff app root; a newly hired staff lands on their store home. */
const STAFF_HOME_ROUTE = '/';
