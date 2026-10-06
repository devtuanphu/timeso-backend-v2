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
  /**
   * GPS + QR, không cần FaceID: nhân viên quét QR cửa hàng và có vị trí trong
   * bán kính là chấm công được, không chụp mặt. Không có ảnh thì QR + GPS
   * luôn bị kiểm tra chặt (attendance-enforcement.ts, evaluateFacelessAttendance).
   */
  GPS_QR = 'GPS_QR',
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

  // Giờ mở cửa / đóng cửa ("HH:mm:ss", giờ Việt Nam). Đóng ≤ mở: mở qua đêm.
  // Màn xem trước lịch ca cảnh báo khung giờ mở cửa chưa có nhân viên.
  @Column({ name: 'open_time', type: 'time', default: '06:00:00' })
  openTime: string;

  @Column({ name: 'close_time', type: 'time', default: '22:00:00' })
  closeTime: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
