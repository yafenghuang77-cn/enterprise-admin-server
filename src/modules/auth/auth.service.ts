import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {
  getUser() {
    return { id: 1, username: 'admin', name: '管理员' };
  }
}
