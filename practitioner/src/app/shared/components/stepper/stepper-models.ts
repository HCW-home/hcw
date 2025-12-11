export interface IStep {
  id: string;
  title: string;
  isOptional?: boolean;
  isCompleted?: boolean;
  isValid?: boolean;
}
