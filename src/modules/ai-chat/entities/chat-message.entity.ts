import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChatSession } from './chat-session.entity';

export enum ChatMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @ManyToOne(() => ChatSession, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session!: ChatSession;

  @Column({ type: 'enum', enum: ChatMessageRole })
  role!: ChatMessageRole;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'in_scope', type: 'boolean', nullable: true })
  inScope!: boolean | null;

  @Column({ type: 'decimal', precision: 6, scale: 4, nullable: true })
  similarity!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  citations!: ChatCitationPayload[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

export interface ChatCitationPayload {
  lessonId: string | null;
  lessonTitle: string;
  excerpt: string;
}
