import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { ChatMessage } from '../modules/ai-chat/entities/chat-message.entity';
import { ChatSession } from '../modules/ai-chat/entities/chat-session.entity';
import { LessonSummary } from '../modules/ai-summary/entities/lesson-summary.entity';
import { CartItem } from '../modules/cart/entities/cart-item.entity';
import { Course } from '../modules/courses/entities/course.entity';
import { Enrollment } from '../modules/enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../modules/learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../modules/learning/entities/lesson-progress.entity';
import { LessonWatchEvent } from '../modules/learning/entities/lesson-watch-event.entity';
import { Lesson } from '../modules/lessons/entities/lesson.entity';
import { LessonImport } from '../modules/lessons/entities/lesson-import.entity';
import { Notification } from '../modules/notifications/entities/notification.entity';
import { OrderItem } from '../modules/orders/entities/order-item.entity';
import { Order } from '../modules/orders/entities/order.entity';
import { InstructorBalanceLedger } from '../modules/payments/entities/instructor-balance-ledger.entity';
import { PaymentAuditLog } from '../modules/payments/entities/payment-audit.entity';
import { PaymentProviderEvent } from '../modules/payments/entities/payment-provider-event.entity';
import { PaymentTransaction } from '../modules/payments/entities/payment-transaction.entity';
import { WithdrawRequest } from '../modules/payments/entities/withdraw-request.entity';
import { Question } from '../modules/quizzes/entities/question.entity';
import { QuizAttempt } from '../modules/quizzes/entities/quiz-attempt.entity';
import { Quiz } from '../modules/quizzes/entities/quiz.entity';
import { InstructorAccount } from '../modules/users/entities/instructor-account.entity';
import { User } from '../modules/users/entities/user.entity';

config();

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [
    ChatMessage,
    ChatSession,
    CartItem,
    Course,
    Enrollment,
    LearningAnalyticsEvent,
    LessonProgress,
    LessonWatchEvent,
    Lesson,
    LessonSummary,
    LessonImport,
    Notification,
    OrderItem,
    Order,
    InstructorBalanceLedger,
    PaymentAuditLog,
    PaymentProviderEvent,
    PaymentTransaction,
    WithdrawRequest,
    Question,
    QuizAttempt,
    Quiz,
    InstructorAccount,
    User,
  ],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});

export default dataSource;
