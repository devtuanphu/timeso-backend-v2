import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Put,
  UseInterceptors,
  UploadedFiles,
  UploadedFile,
  Param,
  Res,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import {
  multerConfig,
  identityMulterConfig,
  IDENTITY_UPLOAD_DIR,
  identityImageUrl,
} from '../../common/utils/multer-config';
import { AccountsService } from './accounts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountIdentityDocument } from './entities/account-identity-document.entity';
import { AccountFinance } from './entities/account-finance.entity';
import { Repository } from 'typeorm';
import { AccountResponseDto, IdentityResponseDto, FinanceResponseDto } from './dto/account-response.dto';
import { UpdateIdentityDto, UpdateFinanceDto } from './dto/update-profile.dto';

@ApiTags('Thông tin tài khoản (Accounts)')
@ApiBearerAuth()
@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(
    private readonly accountsService: AccountsService,
    @InjectRepository(AccountIdentityDocument)
    private readonly identityRepository: Repository<AccountIdentityDocument>,
    @InjectRepository(AccountFinance)
    private readonly financeRepository: Repository<AccountFinance>,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Lấy thông tin cá nhân', description: 'Trả về thông tin chi tiết của tài khoản đang đăng nhập' })
  @ApiResponse({ status: 200, description: 'Thành công', type: AccountResponseDto })
  async getProfile(@GetUser() user: any) {
    return this.accountsService.findById(user.userId);
  }

  @Get('employee-stores')
  @ApiOperation({ summary: 'Lấy danh sách cửa hàng đang làm việc', description: 'Trả về danh sách cửa hàng mà nhân viên được gán vào (không bao gồm đã nghỉ việc)' })
  @ApiResponse({ status: 200, description: 'Thành công' })
  async getEmployeeStores(@GetUser() user: any) {
    return this.accountsService.getEmployeeStores(user.userId);
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Cập nhật ảnh đại diện', description: 'Tải lên và cập nhật ảnh đại diện của người dùng' })
  @ApiResponse({ status: 200, description: 'Cập nhật ảnh đại diện thành công' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadAvatar(@GetUser() user: any, @UploadedFile() file: Express.Multer.File) {
    const avatarUrl = `/uploads/${file.filename}`;
    await this.accountsService.update(user.userId, { avatar: avatarUrl });
    return { avatar: avatarUrl };
  }

  private async isOwnerOfEmployingStore(
    ownerAccountId: string,
    employeeAccountId: string,
  ): Promise<boolean> {
    const rows = await this.identityRepository.manager.query(
      `SELECT 1
         FROM employee_profiles ep
         JOIN stores s ON s.id = ep.store_id
        WHERE ep.account_id = $1
          AND s.owner_account_id = $2
          AND ep.deleted_at IS NULL
          AND s.deleted_at IS NULL
        LIMIT 1`,
      [employeeAccountId, ownerAccountId],
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  @Get('identity/image/:filename')
  @ApiOperation({
    summary: 'Tải ảnh giấy tờ định danh',
    description:
      'Chỉ chủ tài khoản mới đọc được ảnh giấy tờ của chính mình. Ảnh không nằm trong thư mục tĩnh công khai.',
  })
  async getIdentityImage(
    @Param('filename') filename: string,
    @GetUser() user: any,
    @Res() res: Response,
  ) {
    // The filename is the only path input, so reject anything that is not a
    // bare name before it reaches the filesystem.
    if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename.includes('..')) {
      throw new NotFoundException('Không tìm thấy ảnh giấy tờ');
    }

    // Resolve the document that references exactly this private file.
    const imageUrl = identityImageUrl(filename);
    const document = await this.identityRepository.findOne({
      where: [{ frontImageUrl: imageUrl }, { backImageUrl: imageUrl }],
    });
    if (!document) throw new NotFoundException('Không tìm thấy ảnh giấy tờ');

    // Readers: the account holder, or the owner of a store that employs them.
    if (
      document.accountId !== user.userId &&
      !(await this.isOwnerOfEmployingStore(user.userId, document.accountId))
    ) {
      throw new ForbiddenException('Bạn không có quyền xem ảnh giấy tờ này');
    }

    const directory = resolvePath(IDENTITY_UPLOAD_DIR);
    const absolutePath = resolvePath(join(directory, filename));
    if (!absolutePath.startsWith(`${directory}/`) || !existsSync(absolutePath)) {
      throw new NotFoundException('Không tìm thấy ảnh giấy tờ');
    }

    res.setHeader(
      'Content-Type',
      absolutePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
    );
    res.setHeader('Cache-Control', 'private, no-store');
    createReadStream(absolutePath).pipe(res);
  }

  @Post('identity')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'frontImage', maxCount: 1 },
    { name: 'backImage', maxCount: 1 },
  ], identityMulterConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Cập nhật định danh (ID/CCCD)', description: 'Cập nhật thông tin và tải lên ảnh mặt trước/sau của giấy tờ định danh' })
  @ApiResponse({ status: 200, description: 'Cập nhật định danh thành công', type: IdentityResponseDto })
  async updateIdentity(
    @GetUser() user: any, 
    @Body() body: UpdateIdentityDto,
    @UploadedFiles() files: { frontImage?: Express.Multer.File[], backImage?: Express.Multer.File[] }
  ) {
    const data: any = { ...body, accountId: user.userId };
    // Sensitive scans are addressed through the authenticated route below, not
    // the public `/uploads` mount. Documents stored by earlier builds keep
    // their `/uploads/...` URL and continue to resolve.
    if (files.frontImage?.[0])
      data.frontImageUrl = `/api/accounts/identity/image/${files.frontImage[0].filename}`;
    if (files.backImage?.[0])
      data.backImageUrl = `/api/accounts/identity/image/${files.backImage[0].filename}`;

    // Remove file objects from data to avoid TypeORM errors
    delete data.frontImage;
    delete data.backImage;

    // Check if exists
    const existing = await this.identityRepository.findOne({ where: { accountId: user.userId } });
    if (existing) {
      await this.identityRepository.update(existing.id, data);
      return this.identityRepository.findOne({ where: { id: existing.id } });
    } else {
      const newIdentity = this.identityRepository.create(data);
      return this.identityRepository.save(newIdentity);
    }
  }

  @Post('finance')
  @ApiOperation({ summary: 'Cập nhật thông tin ngân hàng', description: 'Cập nhật số tài khoản và thông tin thụ hưởng' })
  @ApiResponse({ status: 200, description: 'Cập nhật thông tin tài chính thành công', type: FinanceResponseDto })
  async updateFinance(@GetUser() user: any, @Body() body: UpdateFinanceDto) {
    const existing = await this.financeRepository.findOne({ where: { accountId: user.userId } });
    if (existing) {
      await this.financeRepository.update({ accountId: user.userId }, body);
      return this.financeRepository.findOne({ where: { accountId: user.userId } });
    } else {
      const finance = this.financeRepository.create({
        ...body,
        accountId: user.userId,
      });
      return this.financeRepository.save(finance);
    }
  }
}
