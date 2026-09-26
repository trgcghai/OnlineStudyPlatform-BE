import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Workbook } from 'exceljs';
import { ExcelService } from './excel.service';

describe('ExcelService', () => {
  let service: ExcelService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExcelService],
    }).compile();

    service = module.get(ExcelService);
  });

  it('parses quiz metadata and questions in source order', async () => {
    const workbook = new Workbook();
    const quiz = workbook.addWorksheet('Quiz');
    quiz.addRow(['title', 'description', 'time_limit_minutes', 'pass_score']);
    quiz.addRow(['Imported quiz', 'Description', 30, 75]);
    const questions = workbook.addWorksheet('Questions');
    questions.addRow([
      'order',
      'type',
      'question',
      'option_a',
      'option_b',
      'correct_answers',
      'points',
    ]);
    questions.addRow([2, 'ESSAY', 'Explain NestJS', '', '', '', 3]);
    questions.addRow([1, 'MCQ', 'NestJS is?', 'Framework', 'Database', 'A', 2]);

    const result = await service.parseExcelImport(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );

    expect(result.quiz).toEqual({
      title: 'Imported quiz',
      description: 'Description',
      timeLimitMinutes: 30,
      passScore: 75,
    });
    expect(result.questions.map((question) => question.sourceOrder)).toEqual([
      1, 2,
    ]);
    expect(result.questions[0]).toMatchObject({
      type: 'MCQ',
      correctAnswers: [0],
      points: 2,
    });
  });

  it('rejects an invalid workbook with the existing response shape', async () => {
    await expect(
      service.parseExcelImport(Buffer.from('invalid')),
    ).rejects.toMatchObject({
      response: {
        message: 'Excel validation failed',
        details: ['File must be a valid .xlsx workbook'],
      },
    });
  });

  it('collects question validation errors', async () => {
    const workbook = new Workbook();
    const questions = workbook.addWorksheet('Questions');
    questions.addRow([
      'order',
      'type',
      'question',
      'option_a',
      'option_b',
      'correct_answers',
      'points',
    ]);
    questions.addRow([1, 'MCQ', 'Question', 'Only option', '', 'B', 0]);

    await expect(
      service.parseExcelImport(Buffer.from(await workbook.xlsx.writeBuffer())),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires quiz metadata only when the caller needs to create a quiz', () => {
    expect(() => service.requireQuizMetadata(null)).toThrow(
      BadRequestException,
    );
    expect(
      service.requireQuizMetadata({
        title: 'Quiz',
        description: '',
        timeLimitMinutes: null,
        passScore: null,
      }),
    ).toMatchObject({ title: 'Quiz' });
  });
});
