import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Store } from './store.entity';

// --- ENUMS ---

export enum WeekDay {
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
  FRIDAY = 'FRIDAY',
  SATURDAY = 'SATURDAY',
  SUNDAY = 'SUNDAY',
  SATURDAY_SUNDAY = 'SATURDAY_SUNDAY', // Thứ 7 & Chủ nhật
}

export enum TimekeepingRequirement {
  LOCATION_QR_GPS_FACEID = 'LOCATION_QR_GPS_FACEID', // Có vị trí (QR + GPS + FaceID)
  GPS_ONLY = 'GPS_ONLY', // Chỉ GPS
  QR_ONLY = 'QR_ONLY', // Chỉ QR
}

// --- ENTITY ---

@Entity('store_shift_configs')
export class StoreShiftConfig extends BaseEntity {
  @Column({ name: 'store_id' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  // Ngày được nghỉ trong tuần (có thể chọn nhiều ngày)
  @Column({
    type: 'simple-array',
    name: 'days_off',
    default: 'SATURDAY,SUNDAY',
  })
  daysOff: WeekDay[];

  // Không duyệt nghỉ vào các ngày này
  @Column({
    type: 'simple-array',
    name: 'no_approval_days',
    default: 'SATURDAY,SUNDAY',
  })
  noApprovalDays: WeekDay[];

  // Điểm danh yêu cầu
  @Column({
    type: 'enum',
    enum: TimekeepingRequirement,
    name: 'timekeeping_requirement',
    default: TimekeepingRequirement.LOCATION_QR_GPS_FACEID,
  })
  timekeepingRequirement: TimekeepingRequirement;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
