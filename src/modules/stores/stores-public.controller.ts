import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StoresService } from './stores.service';

/**
 * Public controller for store resources that don't require authentication.
 * Useful for resources accessed via browser (e.g. QR download via Linking.openURL)
 */
@ApiTags('Cửa hàng - Public')
@Controller('stores')
export class StoresPublicController {
  constructor(private readonly storesService: StoresService) {}

  @Get(':id/qr-download')
  @ApiOperation({ summary: 'Tải mã QR cửa hàng dưới dạng ảnh PNG (public, không cần auth)' })
  async downloadStoreQR(
    @Param('id') id: string,
    @Res() res: any,
  ) {
    const store = await this.storesService.findById(id);
    if (!store || !store.qrCode) {
      throw new NotFoundException('QR code not found for this store');
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    const filePath = join(process.cwd(), store.qrCode);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('QR image file not found');
    }

    const fileName = `QR-${store.name || 'store'}.png`;
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }
}
