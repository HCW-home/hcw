import {
  FormGroup,
  FormArray,
  FormControl,
  AbstractControl
} from '@angular/forms';
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ValidationService {
  private getControls(formGroup: FormGroup) {
    return formGroup.controls;
  }

  validateAllFormFields(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof FormControl) {
        control.markAsTouched({ onlySelf: true });
      } else if (control instanceof FormArray) {
        control.markAsTouched({ onlySelf: true });
        control.controls.forEach(cont => {
          if (cont instanceof FormGroup) {
            this.validateAllFormFields(cont);
          }
        });
      } else if (control instanceof FormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }

  showError(formGroup: FormGroup, fieldName: string) {
    return (
      this.getControls(formGroup)[fieldName]?.invalid &&
      (this.getControls(formGroup)[fieldName]?.touched ||
        this.getControls(formGroup)[fieldName]?.dirty)
    );
  }

  resetInputValidation(formGroup: FormGroup, fieldName: string) {
    const inputControl = this.getControls(formGroup)[fieldName];
    if (inputControl.errors && inputControl.errors['required']) {
      inputControl.markAsUntouched();
      inputControl.markAsPristine();
    }
  }

  atListOneValidator(abstractControl: AbstractControl) {
    if (!abstractControl.value.length) {
      return { atLeastOne: false };
    }
    return null;
  }
}
