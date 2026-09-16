import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('instructor_accounts')
@Unique('UQ_instructor_accounts_instructor_id', ['instructorId'])
export class InstructorAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'instructor_id', type: 'uuid' })
  instructorId!: string;

  @OneToOne(() => User, (user) => user.instructorAccount, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'instructor_id' })
  instructor!: User;

  @Column({ name: 'bank_name', type: 'varchar', length: 120 })
  bankName!: string;

  @Column({ name: 'bank_account_number', type: 'varchar', length: 120 })
  bankAccountNumber!: string;

  @Column({ name: 'account_holder_name', type: 'varchar', length: 120 })
  accountHolderName!: string;

  @Column({ name: 'bank_code', type: 'varchar', length: 120, nullable: true })
  bankCode!: string | null;

  @Column({ name: 'branch_name', type: 'varchar', length: 120, nullable: true })
  branchName!: string | null;

  @Column({
    name: 'phone_number',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  phoneNumber!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
