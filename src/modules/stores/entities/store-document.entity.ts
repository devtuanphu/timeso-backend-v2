import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum StoreDocumentKind {
  RULE = 'RULE',
  DOCUMENT = 'DOCUMENT',
}

export interface StoreDocumentFile {
  name: string;
  url: string;
  key?: string;
  type?: string;
  size?: number;
}

/**
 * Một bài nội quy hoặc tài liệu của cửa hàng.
 * Xem scripts/migration_store_documents.sql.
 */
@Entity('store_documents')
@Index('idx_store_documents_store', ['storeId', 'createdAt'], {
  where: '"deleted_at" IS NULL',
})
export class StoreDocument extends BaseEntity {
  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ type: 'varchar', length: 16 })
  kind: StoreDocumentKind;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  /** Văn bản có đánh dấu nhẹ, app hiển thị bằng documentMarkup. */
  @Column({ type: 'text', default: '' })
  content: string;

  /** Rỗng = tất cả nhân viên. */
  @Column({ name: 'department_ids', type: 'uuid', array: true, default: () => "'{}'" })
  departmentIds: string[];

  @Column({ name: 'valid_from', type: 'date' })
  validFrom: string;

  /** Null = còn hiệu lực. */
  @Column({ name: 'valid_to', type: 'date', nullable: true })
  validTo: string | null;

  /** Chủ bấm "Ngừng áp dụng"; nhân viên không còn thấy bài. */
  @Column({ name: 'stopped_at', type: 'timestamp', nullable: true })
  stoppedAt: Date | null;

  /** Tăng khi nội dung hoặc tệp đổi: tiến độ xem của bản cũ không còn tính. */
  @Column({ name: 'content_revision', type: 'int', default: 1 })
  contentRevision: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  files: StoreDocumentFile[];

  @Column({ name: 'created_by_account_id', type: 'uuid', nullable: true })
  createdByAccountId: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 255, nullable: true })
  createdByName: string | null;

  @Column({ name: 'client_request_id', type: 'varchar', length: 64, nullable: true })
  clientRequestId: string | null;

  @Column({ name: 'legacy_rule_id', type: 'uuid', nullable: true })
  legacyRuleId: string | null;
}
