import { Controller, Get, Post, Body, UseGuards, Put, UseInterceptors, UploadedFiles, UploadedFile } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '../../common/utils/multer-config';
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

  @Post('identity')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'frontImage', maxCount: 1 },
    { name: 'backImage', maxCount: 1 },
  ], multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Cập nhật định danh (ID/CCCD)', description: 'Cập nhật thông tin và tải lên ảnh mặt trước/sau của giấy tờ định danh' })
  @ApiResponse({ status: 200, description: 'Cập nhật định danh thành công', type: IdentityResponseDto })
  async updateIdentity(
    @GetUser() user: any, 
    @Body() body: UpdateIdentityDto,
    @UploadedFiles() files: { frontImage?: Express.Multer.File[], backImage?: Express.Multer.File[] }
  ) {
    const data: any = { ...body, accountId: user.userId };
    if (files.frontImage?.[0]) data.frontImageUrl = `/uploads/${files.frontImage[0].filename}`;
    if (files.backImage?.[0]) data.backImageUrl = `/uploads/${files.backImage[0].filename}`;

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
