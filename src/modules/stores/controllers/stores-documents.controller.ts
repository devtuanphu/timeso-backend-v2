import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { storeDocumentMulterConfig } from '../../../common/utils/multer-config';
import { GetUser } from '../../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  ReportStoreDocumentViewDto,
  SaveStoreDocumentDto,
  SetStoreDocumentStoppedDto,
} from '../dto/store-document.dto';
import { StoreAccessGuard } from '../guards/store-access.guard';
import { StoreOwnerOnly } from '../guards/store-owner-only.decorator';
import { StoreOwnerOnlyGuard } from '../guards/store-owner-only.guard';
import { StoreResourceAccessGuard } from '../guards/store-resource-access.guard';
import { StoreDocumentsService } from '../store-documents.service';

/**
 * Nội quy & Tài liệu. Chủ quản lý; nhân viên chỉ đọc những bài áp dụng cho mình
 * và ghi tiến độ xem của chính mình. Hồ sơ nhân viên luôn suy từ tài khoản đăng
 * nhập, không nhận từ client.
 */
@ApiTags('Cửa hàng & Vận hành (Stores)')
@ApiBearerAuth()
@Controller('stores')
@UseGuards(JwtAuthGuard, StoreAccessGuard, StoreResourceAccessGuard, StoreOwnerOnlyGuard)
export class StoresDocumentsController {
  constructor(private readonly documentsService: StoreDocumentsService) {}

  // Khai báo trước `:id/documents/:documentId` để "mine" không bị hiểu là id.
  @Get(':id/documents/mine')
  @ApiOperation({ summary: 'Nội quy & tài liệu áp dụng cho nhân viên đang đăng nhập' })
  listMine(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: any) {
    return this.documentsService.listMine(id, user.userId);
  }

  @Get(':id/documents/mine/:documentId')
  @ApiOperation({ summary: 'Chi tiết một bài, kèm tiến độ xem của nhân viên' })
  getMine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @GetUser() user: any,
  ) {
    return this.documentsService.getMine(id, documentId, user.userId);
  }

  @Post(':id/documents/:documentId/view')
  @ApiOperation({ summary: 'Ghi tiến độ xem (số màn hình đã xem / tổng)' })
  reportView(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: ReportStoreDocumentViewDto,
    @GetUser() user: any,
  ) {
    return this.documentsService.reportView(id, documentId, user.userId, body);
  }

  @StoreOwnerOnly()
  @Get(':id/documents')
  @ApiOperation({ summary: 'Danh sách quản lý, kèm số nhân viên đã xem' })
  listForOwner(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.listForOwner(id);
  }

  @StoreOwnerOnly()
  @Get(':id/documents/:documentId')
  @ApiOperation({ summary: 'Chi tiết một bài (app chủ)' })
  getForOwner(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documentsService.getForOwner(id, documentId);
  }

  @StoreOwnerOnly()
  @Post(':id/documents')
  @UseInterceptors(FilesInterceptor('files', 10, storeDocumentMulterConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Tạo nội quy / tài liệu và thông báo cho nhân viên' })
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SaveStoreDocumentDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @GetUser() user: any,
  ) {
    return this.documentsService.create(id, body, files, user.userId);
  }

  @StoreOwnerOnly()
  @Put(':id/documents/:documentId')
  @UseInterceptors(FilesInterceptor('files', 10, storeDocumentMulterConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sửa nội quy / tài liệu và thông báo cho nhân viên' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: SaveStoreDocumentDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.documentsService.update(id, documentId, body, files);
  }

  @StoreOwnerOnly()
  @Patch(':id/documents/:documentId/status')
  @ApiOperation({ summary: 'Ngừng áp dụng hoặc áp dụng lại' })
  setStopped(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: SetStoreDocumentStoppedDto,
  ) {
    return this.documentsService.setStopped(id, documentId, body.stopped);
  }

  @StoreOwnerOnly()
  @Delete(':id/documents/:documentId')
  @ApiOperation({ summary: 'Xoá nội quy / tài liệu' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documentsService.remove(id, documentId);
  }
}
