import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resolveUploadedDocxPath } from './contract-template-file.utils';

describe('resolveUploadedDocxPath', () => {
  let base: string;
  let uploads: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'timeso-docx-')));
    uploads = path.join(base, 'uploads');
    fs.mkdirSync(uploads);
    fs.writeFileSync(path.join(uploads, 'template.docx'), 'x');
    fs.writeFileSync(path.join(base, 'secret.docx'), 'x');
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('resolves an uploaded file', () => {
    expect(resolveUploadedDocxPath('/uploads/template.docx', uploads)).toBe(
      path.join(uploads, 'template.docx'),
    );
  });

  it('accepts the bare file name the old handler also accepted', () => {
    expect(resolveUploadedDocxPath('template.docx', uploads)).toBe(
      path.join(uploads, 'template.docx'),
    );
  });

  it.each([
    '/uploads/../secret.docx',
    '/uploads/../../secret.docx',
    '../secret.docx',
    '/uploads/%2e%2e/secret.docx',
  ])('refuses %s with 404', (fileUrl) => {
    expect(() => resolveUploadedDocxPath(fileUrl, uploads)).toThrow(
      NotFoundException,
    );
  });

  it('refuses an absolute path outside uploads', () => {
    expect(() =>
      resolveUploadedDocxPath(path.join(base, 'secret.docx'), uploads),
    ).toThrow(NotFoundException);
  });

  it('refuses a symlink that points outside uploads', () => {
    fs.symlinkSync(path.join(base, 'secret.docx'), path.join(uploads, 'link.docx'));
    expect(() => resolveUploadedDocxPath('/uploads/link.docx', uploads)).toThrow(
      NotFoundException,
    );
  });

  it('404s a file that does not exist', () => {
    expect(() => resolveUploadedDocxPath('/uploads/missing.docx', uploads)).toThrow(
      NotFoundException,
    );
  });

  it.each([undefined, null, 42, '', '   ', {}, 'a'.repeat(600) + '.docx'])(
    'rejects an unusable body value (%p) with 400',
    (fileUrl) => {
      expect(() => resolveUploadedDocxPath(fileUrl, uploads)).toThrow(
        BadRequestException,
      );
    },
  );

  it('rejects anything that is not a .docx with 400', () => {
    expect(() => resolveUploadedDocxPath('/uploads/../../etc/passwd', uploads)).toThrow(
      BadRequestException,
    );
    expect(() => resolveUploadedDocxPath('/uploads/a.docx\0.png', uploads)).toThrow(
      BadRequestException,
    );
  });
});
