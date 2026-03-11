import { Entity, Column, OneToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { AccountIdentityDocument } from './account-identity-document.entity';
import { AccountFinance } from './account-finance.entity';
import { EmployeeProfile } from '../../stores/entities/employee-profile.entity';

export enum AccountStatus {
  ACTIVE = 'active',
  BLOCKED = 'blocked',
  UNVERIFIED = 'unverified',
}

@Entity('accounts')
export class Account extends BaseEntity {
  @Column({ name: 'full_name' })
  fullName: string;

  @Column({ nullable: true })
  avatar: string;

  @Column({ nullable: true })
  gender: string;

  @Column({ type: 'date', nullable: true })
  birthday: Date;

  @Column({ name: 'marital_status', nullable: true })
  maritalStatus: string;

  @Column({ unique: true })
  email: string;

  @Column({ unique: true })
  phone: string;

  @Column({ name: 'password_hash', select: false })
  passwordHash: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  district: string;

  @Column({
    type: 'enum',

    enum: AccountStatus,
    default: AccountStatus.UNVERIFIED,
  })
  status: AccountStatus;

  @Column({ name: 'last_login_at', nullable: true })
  lastLoginAt: Date;

  @OneToOne(() => AccountIdentityDocument, (doc) => doc.account)
  identityDocument: AccountIdentityDocument;

  @OneToOne(() => AccountFinance, (finance) => finance.account)
  finance: AccountFinance;

  @OneToMany(() => EmployeeProfile, (profile) => profile.account)
  employeeProfiles: EmployeeProfile[];
}
