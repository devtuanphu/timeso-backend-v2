import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { StoreLadder } from './store-ladder.entity';
import { StoreLadderRung } from './store-ladder-rung.entity';

/**
 * Cạnh có hướng của đồ thị lộ trình: đi được từ bậc nào tới bậc nào.
 *
 * Lộ trình được phép phân nhánh — Bánh tráng có thể lên Ca trưởng hoặc Thu
 * ngân — nên thứ tự bằng `level` là không đủ để mô tả đường đi. `fromRungId`
 * NULL nghĩa là điểm vào: người chưa đứng ở bậc nào của lộ trình này vào thẳng
 * bậc đó.
 */
@Entity('store_ladder_edges')
export class StoreLadderEdge extends BaseEntity {
  @Column({ name: 'ladder_id' })
  ladderId: string;

  @ManyToOne(() => StoreLadder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ladder_id' })
  ladder: StoreLadder;

  @Column({ name: 'from_rung_id', type: 'uuid', nullable: true })
  fromRungId: string | null;

  @ManyToOne(() => StoreLadderRung, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'from_rung_id' })
  fromRung: StoreLadderRung | null;

  @Column({ name: 'to_rung_id' })
  toRungId: string;

  @ManyToOne(() => StoreLadderRung, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'to_rung_id' })
  toRung: StoreLadderRung;
}
