import { BadRequestException, Injectable } from '@nestjs/common';
import { Workbook, Worksheet } from 'exceljs';

export interface ImportedQuizMetadata {
  title: string;
  description: string;
  timeLimitMinutes: number | null;
  passScore: number | null;
}

export interface ImportedQuestion {
  sourceOrder: number;
  type: 'MCQ' | 'ESSAY';
  content: string;
  options: string[];
  correctAnswers: number[];
  points: number;
}

export interface QuizExcelImport {
  quiz: ImportedQuizMetadata | null;
  questions: ImportedQuestion[];
}

@Injectable()
export class ExcelService {
  requireQuizMetadata(
    metadata: ImportedQuizMetadata | null,
  ): ImportedQuizMetadata {
    if (!metadata || !metadata.title) {
      throw this.invalidExcel([
        'Quiz!2 title is required when the lesson has no quiz',
      ]);
    }

    return metadata;
  }

  async parseExcelImport(buffer: Buffer): Promise<QuizExcelImport> {
    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(buffer as never);
    } catch {
      throw this.invalidExcel(['File must be a valid .xlsx workbook']);
    }

    const details: string[] = [];
    const questionsSheet = workbook.getWorksheet('Questions');
    if (!questionsSheet) {
      throw this.invalidExcel(['Missing required sheet: Questions']);
    }

    const quizSheet = workbook.getWorksheet('Quiz');
    const quiz = quizSheet
      ? this.parseQuizExcelSheet(quizSheet, details)
      : null;
    const questions = this.parseQuestionExcelSheet(questionsSheet, details);
    if (details.length > 0) throw this.invalidExcel(details);
    return { quiz, questions };
  }

  private parseQuizExcelSheet(
    sheet: Worksheet,
    details: string[],
  ): ImportedQuizMetadata {
    const columns = this.excelColumns(
      sheet,
      ['title', 'description', 'time_limit_minutes', 'pass_score'],
      details,
    );
    const row = sheet.getRow(2);
    const title = this.excelValue(row, columns.title).trim();
    const description = this.excelValue(row, columns.description).trim();
    if (title.length > 200)
      details.push('Quiz!2 title must be between 1 and 200 characters');
    if (description.length > 5000)
      details.push('Quiz!2 description must not exceed 5000 characters');
    return {
      title,
      description,
      timeLimitMinutes: this.excelInteger(
        this.excelValue(row, columns.time_limit_minutes),
        'Quiz!2 time_limit_minutes',
        0,
        1440,
        details,
      ),
      passScore: this.excelInteger(
        this.excelValue(row, columns.pass_score),
        'Quiz!2 pass_score',
        0,
        100,
        details,
      ),
    };
  }

  private parseQuestionExcelSheet(
    sheet: Worksheet,
    details: string[],
  ): ImportedQuestion[] {
    const columns = this.excelColumns(
      sheet,
      [
        'order',
        'type',
        'question',
        'option_a',
        'option_b',
        'correct_answers',
        'points',
      ],
      details,
    );
    const questions: ImportedQuestion[] = [];
    const usedOrders = new Set<number>();
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      if (
        Object.values(columns).every((column) => !this.excelValue(row, column))
      )
        continue;
      const prefix = `Questions!${rowNumber}`;
      const sourceOrder = this.requiredExcelInteger(
        this.excelValue(row, columns.order),
        `${prefix} order`,
        1,
        Number.MAX_SAFE_INTEGER,
        details,
      );
      if (sourceOrder !== null) {
        if (usedOrders.has(sourceOrder))
          details.push(`${prefix} order must be unique in this file`);
        usedOrders.add(sourceOrder);
      }
      const typeValue = this.excelValue(row, columns.type).trim().toUpperCase();
      const type =
        typeValue === 'MCQ'
          ? ('MCQ' as const)
          : typeValue === 'ESSAY'
            ? ('ESSAY' as const)
            : null;
      if (!type) details.push(`${prefix} type must be MCQ or ESSAY`);
      const content = this.excelValue(row, columns.question).trim();
      if (!content || content.length > 4000)
        details.push(
          `${prefix} question must be between 1 and 4000 characters`,
        );
      const points = this.requiredExcelInteger(
        this.excelValue(row, columns.points),
        `${prefix} points`,
        1,
        1000,
        details,
      );
      const options = [...'abcdefghij'].flatMap((letter) => {
        const value = this.excelValue(row, columns[`option_${letter}`]).trim();
        return value ? [value] : [];
      });
      const answers = this.excelAnswers(
        this.excelValue(row, columns.correct_answers),
        `${prefix} correct_answers`,
        details,
      );
      if (type === 'MCQ') {
        if (options.length < 2)
          details.push(`${prefix} MCQ requires at least 2 options`);
        if (answers.length === 0)
          details.push(`${prefix} MCQ requires at least one correct answer`);
        if (answers.some((answer) => answer >= options.length))
          details.push(
            `${prefix} correct_answers must reference a filled option`,
          );
      }
      if (type === 'ESSAY') {
        if (options.length > 0)
          details.push(`${prefix} essay cannot have options`);
        if (answers.length > 0)
          details.push(`${prefix} essay cannot have correct_answers`);
      }
      if (sourceOrder !== null && type && content && points !== null) {
        questions.push({
          sourceOrder,
          type,
          content,
          options: type === 'ESSAY' ? [] : options,
          correctAnswers: type === 'ESSAY' ? [] : answers,
          points,
        });
      }
    }
    if (!questions.length && !details.length)
      details.push('Questions!2 At least one question is required');
    return questions.sort((a, b) => a.sourceOrder - b.sourceOrder);
  }

  private excelColumns(
    sheet: Worksheet,
    expected: string[],
    details: string[],
  ): Record<string, number> {
    const columns: Record<string, number> = {};
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, index) => {
      const header = cell.text
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
      if (header) columns[header] = index;
    });
    expected.forEach((header) => {
      if (!columns[header])
        details.push(`${sheet.name}!1 Missing required column: ${header}`);
    });
    return columns;
  }

  private excelValue(
    row: ReturnType<Worksheet['getRow']>,
    column?: number,
  ): string {
    return column ? row.getCell(column).text : '';
  }

  private requiredExcelInteger(
    value: string,
    label: string,
    min: number,
    max: number,
    details: string[],
  ): number | null {
    if (!value.trim()) {
      details.push(`${label} is required`);
      return null;
    }
    return this.excelInteger(value, label, min, max, details);
  }

  private excelInteger(
    value: string,
    label: string,
    min: number,
    max: number,
    details: string[],
  ): number | null {
    if (!value.trim()) return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
      details.push(`${label} must be an integer between ${min} and ${max}`);
      return null;
    }
    return number;
  }

  private excelAnswers(
    value: string,
    label: string,
    details: string[],
  ): number[] {
    const unique = new Set<number>();
    for (const answer of value
      .split(',')
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)) {
      const index = 'ABCDEFGHIJ'.indexOf(answer);
      if (index < 0 || answer.length !== 1)
        details.push(
          `${label} must contain comma-separated option letters A-J`,
        );
      else if (unique.has(index))
        details.push(`${label} cannot repeat an answer`);
      else unique.add(index);
    }
    return [...unique];
  }

  private invalidExcel(details: string[]): BadRequestException {
    return new BadRequestException({
      message: 'Excel validation failed',
      details,
    });
  }
}
