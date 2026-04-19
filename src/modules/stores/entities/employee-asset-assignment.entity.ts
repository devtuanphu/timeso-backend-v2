import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { EmployeeProfile } from './employee-profile.entity';
import { Asset } from './asset.entity';

export enum AssetAssignmentStatus {
  ASSIGNED = 'ASSIGNED',
  RETURNED = 'RETURNED',
  DAMAGED = 'DAMAGED',
  LOST = 'LOST',
}

@Entity('employee_asset_assignments')
export class EmployeeAssetAssignment extends BaseEntity {
  @Column({ name: 'employee_profile_id' })
  employeeProfileId: string;

  @ManyToOne(() => EmployeeProfile, (profile) => profile.assetAssignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_profile_id' })
  employeeProfile: EmployeeProfile;

  @Column({ name: 'asset_id' })
  assetId: string;

  @ManyToOne(() => Asset, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset: Asset;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({
    type: 'enum',
    enum: AssetAssignmentStatus,
    default: AssetAssignmentStatus.ASSIGNED,
  })
  status: AssetAssignmentStatus;

  @Column({ name: 'assigned_date', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  assignedDate: Date;

  @Column({ name: 'returned_date', type: 'timestamp', nullable: true })
  returnedDate: Date;

  @Column({ name: 'due_date', type: 'timestamp', nullable: true })
  dueDate: Date | null;

  @Column({ name: 'assigned_by_id', nullable: true })
  assignedById: string | null;

  @ManyToOne(() => EmployeeProfile, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by_id' })
  assignedBy: EmployeeProfile;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'return_note', type: 'text', nullable: true })
  returnNote: string | null;
}
