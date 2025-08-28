import { IUser } from '../../modules/user/models/user';

export interface IBodyLogin {
  email: string;
  password: string;
}

export interface IResponseLogin {
  access: string;
  refresh: string;
  user: IUser;
}

export interface IBodyForgotPassword {
  email: string;
}

export interface IBodySetPassword {
  uid: string;
  token: string;
  new_password1: string;
  new_password2: string;
}
