import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InstructorAccount } from './instructor-account.entity';

export enum UserRole {
  ADMIN = 'Admin',
  INSTRUCTOR = 'Instructor',
  LEARNER = 'Learner',
}

export enum UserStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
  PENDING_VERIFICATION = 'PendingVerification',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ length: 255, unique: true })
  email!: string;

  @Exclude()
  @Column()
  password!: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.LEARNER })
  role!: UserRole;

  @Column({ type: 'varchar', nullable: true })
  avatar!: string | null;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status!: UserStatus;

  @OneToOne(() => InstructorAccount, (account) => account.instructor)
  instructorAccount?: InstructorAccount;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
