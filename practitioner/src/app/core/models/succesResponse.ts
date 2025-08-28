export interface SuccessResponse<T = unknown> {
  result: T;
  status: boolean;
  message?: string;
  errorCode?: string;
}
