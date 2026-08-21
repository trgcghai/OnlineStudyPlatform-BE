import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { MulterError } from 'multer';

@Catch(MulterError)
export class AvatarUploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();

    const message =
      exception.code === 'LIMIT_FILE_SIZE'
        ? 'Avatar image must be 5MB or smaller'
        : `Could not upload avatar: ${exception.code}`;

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
