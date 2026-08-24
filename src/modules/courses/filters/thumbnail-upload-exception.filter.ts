import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { MulterError } from 'multer';

@Catch(MulterError)
export class ThumbnailUploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();

    const message =
      exception.code === 'LIMIT_FILE_SIZE'
        ? 'Course thumbnail must be at most 5 MB'
        : 'Invalid course thumbnail upload';

    response.status(HttpStatus.BAD_REQUEST).json({
      success: false,
      statusCode: HttpStatus.BAD_REQUEST,
      data: null,
      error: {
        code: HttpStatus.BAD_REQUEST,
        message,
        details: [message],
      },
      timestamp: new Date().toISOString(),
    });
  }
}
