import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { Repository } from 'typeorm';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { RiskBand } from '../risk/dto/risk.dto';
import {
  RiskScore,
  RiskScoreDocument,
} from '../risk/schemas/risk-score.schema';
import { AdminDashboardResponse } from './dto/admin-dashboard.dto';

interface RiskCounts {
  _id: RiskBand;
  count: number;
}

@Injectable()
export class AdminDashboardService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Course) private readonly courses: Repository<Course>,
    @InjectRepository(Enrollment)
    private readonly enrollments: Repository<Enrollment>,
    @InjectModel(RiskScore.name)
    private readonly riskScores: Model<RiskScoreDocument>,
  ) {}

  async getDashboard(): Promise<AdminDashboardResponse> {
    const [userGroups, courseGroups, enrollmentStats, riskCounts] =
      await Promise.all([
        this.users
          .createQueryBuilder('user')
          .select('user.role', 'role')
          .addSelect('COUNT(*)', 'count')
          .groupBy('user.role')
          .getRawMany<{ role: UserRole; count: string }>(),
        this.courses
          .createQueryBuilder('course')
          .select('course.status', 'status')
          .addSelect('COUNT(*)', 'count')
          .groupBy('course.status')
          .getRawMany<{ status: CourseStatus; count: string }>(),
        this.enrollments
          .createQueryBuilder('enrollment')
          .select('COUNT(*)', 'total')
          .addSelect('COUNT(enrollment.completedAt)', 'completed')
          .getRawOne<{ total: string; completed: string }>(),
        this.riskScores
          .aggregate<RiskCounts>(this.latestRiskCountsPipeline())
          .exec(),
      ]);

    const users = Object.fromEntries(
      userGroups.map(({ role, count }) => [role, Number(count)]),
    ) as Partial<Record<UserRole, number>>;
    const courses = Object.fromEntries(
      courseGroups.map(({ status, count }) => [status, Number(count)]),
    ) as Partial<Record<CourseStatus, number>>;
    const enrollmentTotal = Number(enrollmentStats?.total ?? 0);
    const completed = Number(enrollmentStats?.completed ?? 0);
    const risks = Object.fromEntries(
      riskCounts.map(({ _id, count }) => [_id, count]),
    ) as Partial<Record<RiskBand, number>>;

    return {
      users: {
        total: Object.values(users).reduce(
          (total, count) => total + (count ?? 0),
          0,
        ),
        learners: users[UserRole.LEARNER] ?? 0,
        instructors: users[UserRole.INSTRUCTOR] ?? 0,
        admins: users[UserRole.ADMIN] ?? 0,
      },
      courses: {
        total: Object.values(courses).reduce(
          (total, count) => total + (count ?? 0),
          0,
        ),
        published: courses[CourseStatus.PUBLISHED] ?? 0,
        pending: courses[CourseStatus.PENDING] ?? 0,
      },
      enrollments: {
        total: enrollmentTotal,
        completed,
        completionRate:
          enrollmentTotal === 0 ? 0 : (completed / enrollmentTotal) * 100,
      },
      learningRisk: {
        scoredEnrollments: riskCounts.reduce(
          (total, item) => total + item.count,
          0,
        ),
        low: risks[RiskBand.LOW] ?? 0,
        medium: risks[RiskBand.MEDIUM] ?? 0,
        high: risks[RiskBand.HIGH] ?? 0,
      },
    };
  }

  private latestRiskCountsPipeline(): PipelineStage[] {
    return [
      { $sort: { learnerId: 1, courseId: 1, calculatedAt: -1 } },
      {
        $group: {
          _id: { learnerId: '$learnerId', courseId: '$courseId' },
          band: { $first: '$band' },
        },
      },
      { $group: { _id: '$band', count: { $sum: 1 } } },
    ];
  }
}
