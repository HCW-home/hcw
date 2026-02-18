import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IStep } from './stepper-models';
import { Svg } from '../../ui-components/svg/svg';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-stepper',
  imports: [CommonModule, Svg, TranslatePipe],
  templateUrl: './stepper.html',
  styleUrl: './stepper.scss',
})
export class Stepper {
  steps = input.required<IStep[]>();
  currentStep = input<number>(0);
  allowStepClick = input<boolean>(false);

  stepChange = output<number>();

  getStepState(index: number): 'completed' | 'active' | 'inactive' {
    const current = this.currentStep();
    if (index < current) {
      return 'completed';
    } else if (index === current) {
      return 'active';
    }
    return 'inactive';
  }

  isStepClickable(index: number): boolean {
    if (!this.allowStepClick()) return false;
    const step = this.steps()[index];
    return index < this.currentStep() || (step?.isCompleted ?? false);
  }

  onStepClick(index: number): void {
    if (this.isStepClickable(index)) {
      this.stepChange.emit(index);
    }
  }
}
