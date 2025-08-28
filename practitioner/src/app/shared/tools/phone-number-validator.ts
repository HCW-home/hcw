import {
  ValidatorFn,
  AbstractControl,
  ValidationErrors
} from '@angular/forms';
import { PhoneNumberUtil } from 'google-libphonenumber';

export function phoneValidator(): ValidatorFn {
  const phoneUtil = PhoneNumberUtil.getInstance();

  return (control: AbstractControl): ValidationErrors | null => {
    if (!control.value) {
      return null;
    }

    try {
      const number = phoneUtil.parse(control.value);
      const isValid = phoneUtil.isValidNumber(number);
      return isValid ? null : { invalidPhoneNumber: true };
    } catch {
      return { invalidPhoneNumber: true };
    }
  };
}
