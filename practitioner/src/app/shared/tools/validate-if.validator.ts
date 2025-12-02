import {
  AbstractControl,
  FormGroup,
  ValidatorFn,
  ValidationErrors
} from '@angular/forms';
import { distinctUntilChanged } from 'rxjs/operators';
import { Subscription } from 'rxjs';

/**
 * Conditionally applies a validator based on a predicate evaluated on the form group.
 */
export function validateIf(
  conditional: (formGroup: FormGroup) => boolean,
  validator: ValidatorFn | null,
  dependencyControlName?: string | string[]
): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const parent = control.parent as FormGroup | null;

    if (dependencyControlName && parent) {
      const deps = Array.isArray(dependencyControlName)
        ? dependencyControlName
        : [dependencyControlName];

      deps.forEach(dep => setupRevalidation(control, dep));
    }

    if (!parent || control.disabled) return null;

    return conditional(parent) ? (validator ? validator(control) : null) : null;
  };
}

/**
 * Sets up re-validation for the control when its parent FormGroup changes.
 */
const revalidationState = new WeakMap<AbstractControl, { setup: boolean; subscription?: Subscription }>();
function setupRevalidation(control: AbstractControl, dependencyControlName: string): Subscription | null {
  const parent = control.parent;
  if (!parent || revalidationState.has(control)) {
    return null;
  }

  revalidationState.set(control, { setup: true });

  const dependencyControl = parent.get(dependencyControlName);
  if (!dependencyControl) return null;

  const subscription = dependencyControl.valueChanges
    .pipe(distinctUntilChanged())
    .subscribe(() => {
      control.updateValueAndValidity({ onlySelf: true });
    });

  revalidationState.set(control, { setup: true, subscription });
  return subscription;
}

/**
 * Ensures at least one of the current control or another field has a value.
 */
export function conditionalValidator(otherField: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const parent = control.parent;
    if (!parent) return null;

    const thisValue = control.value;
    const otherValue = parent.get(otherField)?.value;

    return thisValue || otherValue
      ? null
      : { error: `This field or '${otherField}' is required` };
  };
}
