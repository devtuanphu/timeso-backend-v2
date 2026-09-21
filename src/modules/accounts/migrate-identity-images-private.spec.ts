/**
 * `scripts/migrate_identity_images_private.js`: the per-file step. When the
 * private copy already exists the public one must go (apply mode only), or it
 * stays served from /uploads.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { reconcileIdentityFile } = require('../../../scripts/migrate_identity_images_private.js');

const FROM = '/uploads/id.jpg';
const TO = '/uploads-private/identity/id.jpg';

function fakeFs(files: Record<string, string>) {
  return {
    existsSync: jest.fn((path: string) => path in files),
    readFileSync: jest.fn((path: string) => Buffer.from(files[path])),
    renameSync: jest.fn((from: string, to: string) => {
      files[to] = files[from];
      delete files[from];
    }),
    unlinkSync: jest.fn((path: string) => {
      delete files[path];
    }),
    files,
  };
}

describe('reconcileIdentityFile', () => {
  it('deletes the public copy when an identical private copy exists (apply)', () => {
    const fs = fakeFs({ [FROM]: 'scan', [TO]: 'scan' });
    expect(reconcileIdentityFile(FROM, TO, true, fs)).toBe('removed-public');
    expect(fs.unlinkSync).toHaveBeenCalledWith(FROM);
    expect(Object.keys(fs.files)).toEqual([TO]);
  });

  it('only reports it in a dry run', () => {
    const fs = fakeFs({ [FROM]: 'scan', [TO]: 'scan' });
    expect(reconcileIdentityFile(FROM, TO, false, fs)).toBe('would-remove-public');
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('keeps both copies when their bytes differ', () => {
    const fs = fakeFs({ [FROM]: 'new scan', [TO]: 'old scan' });
    expect(reconcileIdentityFile(FROM, TO, true, fs)).toBe('conflict');
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('still moves a file that has no private copy yet', () => {
    const fs = fakeFs({ [FROM]: 'scan' });
    expect(reconcileIdentityFile(FROM, TO, true, fs)).toBe('moved');
    expect(fs.renameSync).toHaveBeenCalledWith(FROM, TO);
    expect(reconcileIdentityFile(FROM, TO, true, fs)).toBe('already-private');
  });

  it('reports a file missing from both places', () => {
    expect(reconcileIdentityFile(FROM, TO, true, fakeFs({}))).toBe('missing');
  });
});
