import { SetMetadata } from '@nestjs/common';

import { ROLES_KEY } from '../constants/auth.constant';
import { UserRole } from '../../modules/users/entities/user.entity';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
