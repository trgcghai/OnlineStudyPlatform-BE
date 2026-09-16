import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Course } from '../../modules/courses/entities/course.entity';
import { Lesson } from '../../modules/lessons/entities/lesson.entity';
import { Question } from '../../modules/quizzes/entities/question.entity';
import { Quiz } from '../../modules/quizzes/entities/quiz.entity';
import { User } from '../../modules/users/entities/user.entity';
import {
  BankCatalog,
  BankCatalogSchema,
} from '../../modules/users/schemas/bank-catalog.schema';
import { BankSeed } from './bank.seed';
import { LessonQuizSeed } from './lessonQuiz.seed';
import { SampleDataSeed } from './sampleData.seed';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Course, Lesson, Quiz, Question]),
    MongooseModule.forFeature([
      { name: BankCatalog.name, schema: BankCatalogSchema },
    ]),
  ],
  providers: [SampleDataSeed, LessonQuizSeed, BankSeed],
})
export class SeedsModule {}
