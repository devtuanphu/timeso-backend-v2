import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

/**
 * Tiến độ xem một bài của một nhân viên: viewed_parts / total_parts màn hình.
 * Chỉ tính khi `revision` trùng content_revision hiện tại của bài.
 */
@Entity('store_document_views')
@Index('uq_store_document_views_document_employee', ['documentId', 'employeeProfileId'], {
  unique: true,
})
export class StoreDocumentView extends BaseEntity {
  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @Column({ name: 'employee_profile_id', type: 'uuid' })
  employeeProfileId: string;

  @Column({ type: 'int' })
  revision: number;

  @Column({ name: 'viewed_parts', type: 'smallint' })
  viewedParts: number;

  @Column({ name: 'total_parts', type: 'smallint' })
  totalParts: number;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
