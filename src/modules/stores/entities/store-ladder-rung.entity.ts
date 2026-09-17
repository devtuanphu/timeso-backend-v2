import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { StoreLadder } from './store-ladder.entity';
import { StoreRungCriteria } from './store-rung-criteria.entity';

export enum RungApproval {
  /** Đủ điều kiện là thăng ngay, không cần ai bấm. */
  AUTO = 'auto',
  /** Đủ điều kiện thì báo chủ, chủ bấm duyệt. */
  OWNER = 'owner',
}

@Entity('store_ladder_rungs')
export class StoreLadderRung extends BaseEntity {
  @Column({ name: 'ladder_id' })
  ladderId: string;

  @ManyToOne(() => StoreLadder, (ladder) => ladder.rungs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ladder_id' })
  ladder: StoreLadder;

  /** Thứ tự hiển thị. Đường đi thật nằm ở store_ladder_edges, không ở đây. */
  @Column({ type: 'int', default: 0 })
  level: number;

  /**
   * Dòng trong danh mục ứng với `ladder.dimension` mà bậc này trao cho nhân
   * viên. Cố ý không có khoá ngoại vì bảng đích đổi theo dimension; ràng buộc
   * được giữ ở CareerLadderService.assertTargetExists.
   */
  @Column({ name: 'target_id', type: 'uuid' })
  targetId: string;

  @Column({ type: 'varchar', length: 16, default: RungApproval.OWNER })
  approval: RungApproval;

  /**
   * Mức lương gợi ý khi thăng lên bậc này. Chỉ để điền sẵn vào hợp đồng mới —
   * lương thật luôn là employee_contracts.salary_amount và không bao giờ bị
   * thăng bậc sửa trực tiếp.
   */
  @Column({
    name: 'suggested_salary',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  suggestedSalary: number | null;

  /**
   * Vào bậc này thì đẩy lộ trình được trỏ tới về bậc đầu của nó. Dùng cho
   * "thăng vị trí thì phải thử việc lại". NULL là không đụng lộ trình nào.
   */
  @Column({ name: 'resets_ladder_id', type: 'uuid', nullable: true })
  resetsLadderId: string | null;

  @OneToMany(() => StoreRungCriteria, (criteria) => criteria.rung)
  criteria: StoreRungCriteria[];
}
