import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { MulterError } from 'multer';

@Catch(MulterError)
export class LessonUploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();

    let message = 'Invalid file upload';

    if (exception.code === 'LIMIT_FILE_SIZE') {
      message =
        'File is too large. Video must be at most 200 MB, material must be at most 20 MB';
    } else if (exception.code === 'LIMIT_UNEXPECTED_FILE') {
      message = 'Unexpected file field';
    }

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
