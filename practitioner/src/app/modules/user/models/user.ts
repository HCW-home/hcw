export interface IUser {
  pk: number;
  email: string;
  last_login: Date;
  last_name: string;
  first_name: string;
  encrypted: boolean;
  app_preferences: string;
}

